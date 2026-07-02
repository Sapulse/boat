// Outbox persistante (correctif audit #3) — MODULE PUR, sans React ni réseau.
//
// File d'opérations d'écriture du MODE API (flag on) : chaque mutation devient
// une opération explicite, persistée localement (clé DÉDIÉE, `crm-nautisme-data`
// jamais touchée), envoyée par le worker (repository) et retirée UNIQUEMENT sur
// confirmation serveur. Échec -> l'op reste en file, re-tentable. Rien ne se
// perd : la file survit au rechargement et à la fermeture d'onglet.
//
// Ce module ne fait QUE la file (modèle, ordre FIFO, coalescing, persistance,
// statuts). L'envoi (worker, retry/backoff, idempotence) vit dans le repository
// (étape B) ; l'affichage (badge, panneau d'échec) dans AppContext (étape C).
// Flag off : ce module n'est jamais importé par le chemin localStorage.

export const OUTBOX_STORAGE_KEY = 'crm-nautisme-outbox';
export const OUTBOX_CAP = 500; // garde-fou : au-delà, situation dégénérée -> refus bruyant

export interface OutboxOp {
  id: string;                    // uuid de l'op
  seq: number;                   // ordre FIFO strict (monotone croissant)
  createdAt: string;             // ISO — debug + affichage
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;                  // ex. '/leads/abc-123' (relatif au baseUrl)
  body?: unknown;                // payload FIGÉ (champs dérivés du reducer inclus)
  entity: string;                // 'leads' | 'actions' | … (affichage / coalescing)
  entityId?: string;
  label: string;                 // humain : « Lead Jean Test — création » (panneau d'échec)
  attempts: number;              // tentatives effectuées
  lastError?: string;            // dernier échec (détail technique)
  status: 'pending' | 'failed';  // pending = à (re)tenter ; failed = définitif -> action utilisateur
}

export type NewOp = Omit<OutboxOp, 'id' | 'seq' | 'createdAt' | 'attempts' | 'status'>;

// Sous-ensemble de l'API Storage (injectable au harnais).
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OutboxOptions {
  storage?: StorageLike;               // défaut : localStorage
  storageKey?: string;                 // défaut : OUTBOX_STORAGE_KEY
  cap?: number;                        // défaut : OUTBOX_CAP
  onChange?: (ops: readonly OutboxOp[]) => void; // notifié à CHAQUE changement de file
}

export class OutboxFullError extends Error {
  constructor(cap: number) {
    super(`Outbox pleine (${cap} opérations en attente) — synchronisation impossible depuis trop longtemps`);
    this.name = 'OutboxFullError';
  }
}

export interface Outbox {
  ops(): readonly OutboxOp[];
  size(): number;
  head(): OutboxOp | undefined;
  hasPending(): boolean;
  /** Ajoute une op (coalescing PATCH même path sur l'op de QUEUE non verrouillée). */
  enqueue(input: NewOp): OutboxOp;
  /** Verrouille l'op en vol (le worker envoie sa copie : son body ne doit plus être coalescé). */
  setLockedSeq(seq: number | null): void;
  /** Confirmation serveur : retire l'op (par seq, jamais « la tête » aveuglément). */
  confirm(seq: number): void;
  /** Échec d'envoi : attempts++, puis 'failed' si définitif ou plafond atteint. Renvoie le statut résultant. */
  recordFailure(seq: number, error: string, opts: { definitive: boolean; maxAttempts: number }): 'pending' | 'failed';
  /** Retry manuel d'une op 'failed' : repasse 'pending', tentatives remises à zéro. */
  retryFailed(seq: number): void;
  /** Abandon explicite d'une op 'failed' : retirée de la file (renvoyée pour trace). */
  removeFailed(seq: number): OutboxOp | undefined;
}

interface PersistedOutbox {
  version: 1;
  ops: OutboxOp[];
}

function safeLoad(storage: StorageLike, key: string): OutboxOp[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedOutbox;
    if (parsed?.version !== 1 || !Array.isArray(parsed.ops)) return [];
    return parsed.ops;
  } catch (e) {
    // File illisible (corruption) : on repart vide — mieux vaut perdre la file
    // qu'empêcher l'app de démarrer ; l'incident est loggé.
    console.error('Outbox illisible, réinitialisée :', e);
    return [];
  }
}

export function createOutbox(options: OutboxOptions = {}): Outbox {
  const storage = options.storage ?? localStorage;
  const key = options.storageKey ?? OUTBOX_STORAGE_KEY;
  const cap = options.cap ?? OUTBOX_CAP;

  let ops: OutboxOp[] = safeLoad(storage, key);
  // seq monotone, poursuivi après rechargement (jamais réutilisé).
  let nextSeq = ops.reduce((max, o) => Math.max(max, o.seq), 0) + 1;
  let lockedSeq: number | null = null;

  const persist = () => {
    // Même doctrine que saveState : un échec d'écriture (quota…) ne doit pas
    // faire planter l'action en cours — mais il est loggé.
    try {
      storage.setItem(key, JSON.stringify({ version: 1, ops } satisfies PersistedOutbox));
    } catch (e) {
      console.error("Échec d'écriture de l'outbox (quota plein ?) :", e);
    }
    options.onChange?.(ops);
  };

  const bySeq = (seq: number) => ops.find(o => o.seq === seq);

  return {
    ops: () => ops,
    size: () => ops.length,
    head: () => ops[0],
    hasPending: () => ops.length > 0,

    enqueue(input) {
      // Coalescing minimal : éditions rapides du même champ -> un PATCH du même
      // path remplace le body du DERNIER op identique, s'il n'est pas en vol
      // (une op verrouillée a déjà sérialisé son body côté worker).
      const tail = ops[ops.length - 1];
      if (
        input.method === 'PATCH' && tail &&
        tail.method === 'PATCH' && tail.path === input.path &&
        tail.status === 'pending' && tail.seq !== lockedSeq
      ) {
        ops = [...ops.slice(0, -1), { ...tail, body: input.body, createdAt: new Date().toISOString() }];
        persist();
        return ops[ops.length - 1];
      }
      if (ops.length >= cap) throw new OutboxFullError(cap);
      const op: OutboxOp = {
        ...input,
        id: crypto.randomUUID(),
        seq: nextSeq++,
        createdAt: new Date().toISOString(),
        attempts: 0,
        status: 'pending',
      };
      ops = [...ops, op];
      persist();
      return op;
    },

    setLockedSeq(seq) { lockedSeq = seq; },

    confirm(seq) {
      ops = ops.filter(o => o.seq !== seq);
      if (lockedSeq === seq) lockedSeq = null;
      persist();
    },

    recordFailure(seq, error, { definitive, maxAttempts }) {
      const op = bySeq(seq);
      if (!op) return 'pending'; // op disparue (abandon concurrent) : rien à faire
      const attempts = op.attempts + 1;
      const status: OutboxOp['status'] = definitive || attempts >= maxAttempts ? 'failed' : 'pending';
      ops = ops.map(o => (o.seq === seq ? { ...o, attempts, lastError: error, status } : o));
      if (lockedSeq === seq) lockedSeq = null;
      persist();
      return status;
    },

    retryFailed(seq) {
      ops = ops.map(o => (o.seq === seq && o.status === 'failed' ? { ...o, status: 'pending', attempts: 0 } : o));
      persist();
    },

    removeFailed(seq) {
      const op = bySeq(seq);
      if (!op || op.status !== 'failed') return undefined;
      ops = ops.filter(o => o.seq !== seq);
      persist();
      return op;
    },
  };
}
