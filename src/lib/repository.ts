import type { Dispatch } from 'react';
import type {
  AppState, Lead, LeadAction, LeadStatus, MonthlyStat, MessageTemplate,
  ActionType, CalendarEvent, CommercialGoal, DefaultGoal, Commercial,
} from '../data/types';
import type { Action } from '../context/appReducer';
import { getInitialState as loadInitialState } from '../context/appReducer';
import { saveState } from './storage';
import { generateId } from './utils';
import { EMPTY_DEFAULT_GOAL } from '../data/constants';
import { createOutbox, OutboxFullError, type OutboxOp, type StorageLike } from './outbox';
import type { ImportPayload, ImportReport } from './importLeads';
import type { BackupEnvelope, RestoreReport } from './backup';

// Couche d'accès aux données (chantier migration, Lot 3) — LA COUTURE.
//
// Interface unique entre l'app et le stockage. Aujourd'hui une seule
// implémentation (localStorage, ci-dessous) adossée au reducer + saveState
// EXISTANTS : REFACTOR ISO-COMPORTEMENT, rien ne change côté métier. Au Lot 5,
// une 2e implémentation "API/base" satisfera le MÊME contrat (les mutations
// dispatcheront pour le cache optimiste ET appelleront le serveur ;
// getInitialState chargera depuis le backend ; persist deviendra sans objet).
//
// Invariants préservés (cf. docs/migration/02-plan-migration.md, Lot 3) :
//  - Le REDUCER reste la source des effets dérivés (jalons de dates, cascade
//    DELETE_LEAD, garde-fou min-1 templates, lastActionDate non-régressif) : ce
//    module ne fait que DISPATCHER, il ne réplique aucune de ces logiques.
//  - La PERSISTANCE reste un effet réactif sur le state entier (persist appelé
//    dans un useEffect([state]) côté AppProvider), pas par mutation.
//  - La génération d'ID reste CÔTÉ CLIENT (generateId), inchangée.
/**
 * Bootstrap d'hydratation (couture stockage), INDÉPENDANT de `dispatch` : sert
 * l'initialisation paresseuse de useReducer, qui a lieu AVANT que `dispatch`
 * n'existe. Même source que l'impl localStorage ci-dessous. Au Lot 5, l'init
 * asynchrone (fetch backend) sera gérée à part (état de chargement).
 */
export function getInitialCrmState(): AppState {
  return loadInitialState();
}

export interface CrmRepository {
  // — Hydratation & persistance (couture stockage) —
  getInitialState(): AppState;
  persist(state: AppState): void;
  // Hydratation ASYNCHRONE optionnelle (impl API, Lot 5) : charge l'état depuis
  // le serveur. Absente pour l'impl localStorage (hydratation synchrone via
  // getInitialState). AppProvider l'appelle au montage si présente (loading gate).
  hydrate?(): Promise<AppState>;
  // Contrôle de la synchro (impl API, correctif audit #3) : état de l'outbox,
  // retry manuel / abandon d'une op refusée, garde beforeunload. Absent en
  // mode localStorage (aucune synchro).
  sync?: RepositorySync;
  // Import en masse (impl API uniquement, chantier import/export, Étape 3) : POST
  // /api/import atomique HORS OUTBOX (action délibérée avec compte-rendu). Absent
  // en mode localStorage -> l'UI d'import est désactivée en flag off.
  bulkImport?(payload: ImportPayload): Promise<ImportReport>;
  // Restauration d'une sauvegarde (impl API uniquement, Étape 5) : POST
  // /api/restore, REMPLACEMENT TOTAL atomique HORS OUTBOX. Absent en localStorage.
  restore?(payload: BackupEnvelope): Promise<RestoreReport>;
  // Auth compte unique partagé (impl API uniquement, Lot 7 allégé). Absent en
  // localStorage (aucun login en flag off).
  checkSession?(): Promise<boolean>;
  login?(username: string, password: string): Promise<void>;
  logout?(): Promise<void>;

  // — Leads —
  addLead(lead: Omit<Lead, 'id'>): string;
  updateLead(id: string, data: Partial<Lead>): void;
  deleteLead(id: string): void;
  updateLeadStatus(id: string, status: LeadStatus): void;

  // — Actions —
  addAction(action: Omit<LeadAction, 'id'>): void;
  updateAction(id: string, data: Partial<LeadAction>): void;
  deleteAction(id: string): void;
  setNextAction(id: string, nextActionType: ActionType | '', nextActionDate: string, nextActionTime?: string, nextActionEndTime?: string): void;

  // — Commerciaux (entrent dans la surface ; étaient en dispatch brut) —
  addCommercial(commercial: Omit<Commercial, 'id'>): string;
  updateCommercial(id: string, data: Partial<Commercial>): void;
  toggleCommercial(id: string): void;

  // — Modèles de message —
  addTemplate(template: Omit<MessageTemplate, 'id'>): string;
  updateTemplate(id: string, data: Partial<MessageTemplate>): void;
  deleteTemplate(id: string): void;

  // — Événements d'agenda libres —
  addCalendarEvent(event: Omit<CalendarEvent, 'id'>): string;
  updateCalendarEvent(id: string, data: Partial<CalendarEvent>): void;
  deleteCalendarEvent(id: string): void;

  // — Enregistrements par lot —
  saveMonthlyStats(stats: MonthlyStat[]): void;
  saveGoals(goals: CommercialGoal[]): void;
  saveDefaultGoal(defaultGoal: DefaultGoal): void;
}

/**
 * Implémentation localStorage = comportement ACTUEL à l'identique. Les mutations
 * dispatchent EXACTEMENT les mêmes actions qu'avant (mêmes payloads), la
 * génération d'ID et la logique dérivée restent inchangées (reducer). `dispatch`
 * est fourni par AppProvider (issu de useReducer).
 */
export function createLocalStorageRepository(dispatch: Dispatch<Action>): CrmRepository {
  return {
    getInitialState: loadInitialState,
    persist: saveState,

    addLead: (lead) => {
      const id = generateId();
      dispatch({ type: 'ADD_LEAD', payload: { ...lead, id } as Lead });
      return id;
    },
    updateLead: (id, data) => dispatch({ type: 'UPDATE_LEAD', payload: { id, data } }),
    deleteLead: (id) => dispatch({ type: 'DELETE_LEAD', payload: id }),
    updateLeadStatus: (id, status) => dispatch({ type: 'UPDATE_LEAD_STATUS', payload: { id, status } }),

    addAction: (action) => dispatch({ type: 'ADD_ACTION', payload: { ...action, id: generateId() } }),
    updateAction: (id, data) => dispatch({ type: 'UPDATE_ACTION', payload: { id, data } }),
    deleteAction: (id) => dispatch({ type: 'DELETE_ACTION', payload: id }),
    setNextAction: (id, nextActionType, nextActionDate, nextActionTime, nextActionEndTime) =>
      dispatch({ type: 'SET_NEXT_ACTION', payload: { id, nextActionType, nextActionDate, nextActionTime, nextActionEndTime } }),

    addCommercial: (commercial) => {
      const id = generateId();
      dispatch({ type: 'ADD_COMMERCIAL', payload: { ...commercial, id } });
      return id;
    },
    updateCommercial: (id, data) => dispatch({ type: 'UPDATE_COMMERCIAL', payload: { id, data } }),
    toggleCommercial: (id) => dispatch({ type: 'TOGGLE_COMMERCIAL', payload: id }),

    addTemplate: (template) => {
      const id = generateId();
      dispatch({ type: 'ADD_TEMPLATE', payload: { ...template, id } });
      return id;
    },
    updateTemplate: (id, data) => dispatch({ type: 'UPDATE_TEMPLATE', payload: { id, data } }),
    deleteTemplate: (id) => dispatch({ type: 'DELETE_TEMPLATE', payload: id }),

    addCalendarEvent: (event) => {
      const id = generateId();
      dispatch({ type: 'ADD_CALENDAR_EVENT', payload: { ...event, id } });
      return id;
    },
    updateCalendarEvent: (id, data) => dispatch({ type: 'UPDATE_CALENDAR_EVENT', payload: { id, data } }),
    deleteCalendarEvent: (id) => dispatch({ type: 'DELETE_CALENDAR_EVENT', payload: id }),

    saveMonthlyStats: (stats) => dispatch({ type: 'SAVE_MONTHLY_STATS', payload: stats }),
    saveGoals: (goals) => dispatch({ type: 'SAVE_GOALS', payload: goals }),
    saveDefaultGoal: (defaultGoal) => dispatch({ type: 'SAVE_DEFAULT_GOAL', payload: defaultGoal }),
  };
}

// ===========================================================================
// Implémentation API (Lot 5, refondue au correctif audit #3 : OUTBOX persistante)
// ===========================================================================
//
// Chaque mutation est captée À LA SOURCE (méthode du repository) comme une
// INTENTION explicite (« créer lead X », « mettre à jour lead Y », « supprimer
// action Z »). Au tick réactif suivant (persist, branché sur useEffect[state]),
// chaque intention est FIGÉE en opération concrète (méthode/path/body) depuis
// l'état POST-REDUCER — les champs dérivés (jalons de dates, lastActionDate,
// side-effect d'ADD_ACTION sur le lead…) sont inclus SANS dupliquer la logique
// du reducer. Les opérations vont dans l'OUTBOX persistée (src/lib/outbox.ts,
// clé dédiée) ; le worker les envoie en FIFO strict, UNE à la fois, et ne les
// retire QUE sur confirmation serveur. Échec transitoire (réseau/5xx/timeout)
// -> retry auto avec backoff plafonné, puis 'failed' -> retry MANUEL (décision
// Q2). Échec définitif (4xx) -> 'failed' immédiat, file BLOQUÉE (jamais de saut
// silencieux), panneau utilisateur (Réessayer / Abandonner). Rien ne se perd :
// la file survit au rechargement (drainée avant l'hydratation).

/** AppState « vide » : état de départ (mode API) avant l'hydratation serveur. */
export function getEmptyState(): AppState {
  return {
    leads: [], actions: [], commercials: [], monthlyStats: [],
    templates: [], calendarEvents: [], goals: [], defaultGoal: EMPTY_DEFAULT_GOAL,
  };
}

// --- État de synchro exposé à l'UI (badge non-ratable, étape C) ---
export type SyncStatus = 'idle' | 'sending' | 'waiting' | 'offline' | 'failed';
export interface SyncInfo {
  status: SyncStatus;
  pending: number; // nb d'opérations pas encore confirmées par le serveur
  failed?: { seq: number; label: string; error?: string };
}
export interface RepositorySync {
  info(): SyncInfo;
  hasPending(): boolean;
  /** Relance l'op refusée (tentatives remises à zéro). */
  retryFailed(): void;
  /** Abandonne l'op refusée, vide le reste de la file puis réaligne l'écran sur le serveur. */
  abandonFailed(): Promise<void>;
}

// --- Intentions captées à la source (décision Q1) ---
type EntityName = 'leads' | 'actions' | 'commercials' | 'templates' | 'calendar-events';
type Intent =
  | { kind: 'create' | 'update' | 'delete'; entity: EntityName; id: string }
  | { kind: 'batch'; entity: 'goals' | 'monthly-stats' | 'default-goal' };

const COLLECTION: Record<EntityName, (s: AppState) => ReadonlyArray<{ id: string }>> = {
  leads: s => s.leads,
  actions: s => s.actions,
  commercials: s => s.commercials,
  templates: s => s.templates,
  'calendar-events': s => s.calendarEvents,
};

// Libellé humain d'une op (panneau d'échec) : « Lead Jean Test — création ».
const VERB: Record<'create' | 'update' | 'delete', string> = { create: 'création', update: 'modification', delete: 'suppression' };
function entityLabel(entity: EntityName, snapshot: Record<string, unknown> | undefined, id: string): string {
  const name =
    (snapshot && [snapshot.firstName, snapshot.lastName].filter(Boolean).join(' ').trim()) ||
    (snapshot?.title as string) || (snapshot?.name as string) || (snapshot?.type as string) || id;
  const noun = { leads: 'Lead', actions: 'Action', commercials: 'Commercial', templates: 'Modèle', 'calendar-events': 'Événement' }[entity];
  return `${noun} ${name}`;
}

// Fusionne les intentions d'un même tick (create+update -> create ; update+delete
// -> delete ; create+delete -> annulées ; batchs dédupliqués), ordre d'origine préservé.
function mergeIntents(intents: Intent[]): Intent[] {
  const merged: Intent[] = [];
  const idxOf = (i: Intent) => merged.findIndex(m =>
    m.entity === i.entity && (m.kind === 'batch' || i.kind === 'batch' ? i.kind === 'batch' && m.kind === 'batch' : m.id === i.id));
  for (const intent of intents) {
    const at = idxOf(intent);
    if (at === -1) { merged.push(intent); continue; }
    const prev = merged[at];
    if (intent.kind === 'batch') continue;                       // batch déjà noté
    if (prev.kind === 'create' && intent.kind === 'delete') merged.splice(at, 1);       // jamais existé côté serveur
    else if (prev.kind === 'create') { /* create + update -> create (payload = snapshot frais) */ }
    else if (intent.kind === 'delete') merged.splice(at, 1, intent);                    // update + delete -> delete
    // update + update -> une seule op (payload = snapshot frais)
  }
  return merged;
}

export interface ApiRepositoryOptions {
  dispatch: Dispatch<Action>;
  /** Notifié quand l'état de synchro change (badge UI, étape C). */
  onSync?: (info: SyncInfo) => void;
  baseUrl?: string;                 // défaut '/api' (même origine sur Vercel)
  onUnauthorized?: () => void;      // 401 (session expirée) -> l'app redemande le login
  fetchImpl?: typeof fetch;         // injectable pour le harnais (défaut : fetch global)
  storage?: StorageLike;            // stockage de l'outbox (défaut : localStorage)
  retryDelaysMs?: number[];         // backoff (défaut 2/5/15/30 s), injectable au harnais
  maxAttempts?: number;             // plafond de tentatives auto (décision Q2, défaut 5)
  timeoutMs?: number;               // timeout par appel (défaut 15 s)
}

// Échec HTTP porté avec son statut (départage transitoire 5xx / définitif 4xx).
// Champ déclaré explicitement (pas de "parameter property" : interdite par
// erasableSyntaxOnly du tsconfig app).
class SendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SendError';
    this.status = status;
  }
}

/**
 * Implémentation API : mutations = dispatch optimiste (réutilise l'impl
 * localStorage) + INTENTION captée à la source ; `persist` fige les intentions
 * en opérations d'outbox (payload post-reducer) ; worker FIFO avec retry.
 * Le reducer et l'impl localStorage NE SONT PAS modifiés.
 */
export function createApiRepository(opts: ApiRepositoryOptions): CrmRepository {
  const {
    dispatch, onSync, baseUrl = '/api', onUnauthorized, fetchImpl = fetch,
    storage, retryDelaysMs = [2_000, 5_000, 15_000, 30_000], maxAttempts = 5, timeoutMs = 15_000,
  } = opts;
  // Auth par COOKIE de session (Lot 7 allégé) : le cookie HttpOnly est envoyé
  // automatiquement (même origine). Un 401 = session expirée -> onUnauthorized
  // (l'app réaffiche le login). Plus AUCUN token dans le bundle.
  const CREDS: RequestCredentials = 'same-origin';
  const on401 = (status: number) => { if (status === 401) onUnauthorized?.(); };
  const base = createLocalStorageRepository(dispatch); // mutations = dispatch optimiste

  let inFlight = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const box = createOutbox({ ...(storage ? { storage } : {}), onChange: () => notify() });

  function currentInfo(): SyncInfo {
    const ops = box.ops();
    const failedOp = ops.find(o => o.status === 'failed');
    if (failedOp) return { status: 'failed', pending: ops.length, failed: { seq: failedOp.seq, label: failedOp.label, error: failedOp.lastError } };
    if (ops.length === 0) return { status: 'idle', pending: 0 };
    if (inFlight) return { status: 'sending', pending: ops.length };
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return { status: offline ? 'offline' : 'waiting', pending: ops.length };
  }
  const notify = () => onSync?.(currentInfo());

  // --- Intentions (captées par les mutations, figées au prochain persist) ---
  let intents: Intent[] = [];
  const remember = (i: Intent) => { intents.push(i); };

  // Fige une intention en opération concrète depuis l'état POST-REDUCER.
  function resolveIntent(intent: Intent, state: AppState): { op: Parameters<typeof box.enqueue>[0] } | null {
    if (intent.kind === 'batch') {
      const body = intent.entity === 'goals' ? state.goals
        : intent.entity === 'monthly-stats' ? state.monthlyStats
        : state.defaultGoal;
      const label = { goals: 'Objectifs', 'monthly-stats': 'Stats acquisition', 'default-goal': 'Objectifs par défaut' }[intent.entity];
      return { op: { method: 'PUT', path: `/${intent.entity}`, body, entity: intent.entity, label: `${label} — enregistrement` } };
    }
    if (intent.kind === 'delete') {
      return { op: { method: 'DELETE', path: `/${intent.entity}/${intent.id}`, entity: intent.entity, entityId: intent.id, label: `${entityLabel(intent.entity, undefined, intent.id)} — ${VERB.delete}` } };
    }
    const snapshot = COLLECTION[intent.entity](state).find(e => e.id === intent.id) as Record<string, unknown> | undefined;
    if (!snapshot) return null; // supprimée dans le même tick : l'intention delete s'en charge (ou rien à faire)
    const label = `${entityLabel(intent.entity, snapshot, intent.id)} — ${VERB[intent.kind]}`;
    return intent.kind === 'create'
      ? { op: { method: 'POST', path: `/${intent.entity}`, body: snapshot, entity: intent.entity, entityId: intent.id, label } }
      : { op: { method: 'PATCH', path: `/${intent.entity}/${intent.id}`, body: snapshot, entity: intent.entity, entityId: intent.id, label } };
  }

  const persist = (state: AppState): void => {
    if (intents.length === 0) return; // SET_STATE (hydratation/réalignement) : aucune intention -> aucune op
    const merged = mergeIntents(intents);
    intents = [];
    try {
      for (const intent of merged) {
        const resolved = resolveIntent(intent, state);
        if (resolved) box.enqueue(resolved.op);
      }
    } catch (e) {
      // File pleine (dégénéré) : refus BRUYANT — l'op n'est pas prise, l'utilisateur
      // est alerté via le badge (failed) et la console.
      console.error(e);
      if (e instanceof OutboxFullError) onSync?.({ status: 'failed', pending: box.size(), failed: { seq: -1, label: 'File de synchronisation pleine', error: e.message } });
    }
    kick();
  };

  // --- Worker d'envoi : FIFO strict, une op en vol, retrait sur confirmation ---
  async function send(op: OutboxOp): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { 'Content-Type': 'application/json' };
    try {
      const res = await fetchImpl(baseUrl + op.path, {
        method: op.method, headers, credentials: CREDS, signal: controller.signal,
        body: op.body === undefined ? undefined : JSON.stringify(op.body),
      });
      if (res.ok) return;
      // Idempotence du retry (succès dont la réponse s'est perdue) :
      if (res.status === 409 && op.method === 'POST' && op.entityId) {
        // déjà créé -> on convertit en mise à jour (même payload).
        const res2 = await fetchImpl(`${baseUrl}/${op.entity}/${op.entityId}`, {
          method: 'PATCH', headers, credentials: CREDS, signal: controller.signal, body: JSON.stringify(op.body),
        });
        if (res2.ok) return;
        on401(res2.status);
        throw new SendError(res2.status, `PATCH /${op.entity}/${op.entityId} -> ${res2.status}`);
      }
      if (res.status === 404 && op.method === 'DELETE') return; // déjà supprimé
      on401(res.status); // session expirée -> l'app réaffiche le login
      let detail = '';
      try { detail = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* corps non-JSON */ }
      throw new SendError(res.status, detail || `${op.method} ${op.path} -> ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const isDefinitive = (e: unknown) => e instanceof SendError && e.status >= 400 && e.status < 500;

  function kick(): void {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    void pump();
  }

  async function pump(): Promise<void> {
    if (inFlight) return;
    const op = box.head();
    if (!op || op.status === 'failed') { notify(); return; } // vide, ou BLOQUÉE sur une op refusée
    inFlight = true;
    box.setLockedSeq(op.seq);
    notify();
    try {
      await send(op);
      box.confirm(op.seq); // <- SEULE façon de sortir de la file : confirmation serveur
      inFlight = false;
      void pump();
    } catch (e) {
      inFlight = false;
      box.setLockedSeq(null);
      const status = box.recordFailure(op.seq, (e as Error).message, { definitive: isDefinitive(e), maxAttempts });
      if (status === 'pending') {
        const delay = retryDelaysMs[Math.min(op.attempts, retryDelaysMs.length - 1)];
        retryTimer = setTimeout(() => { retryTimer = null; void pump(); }, delay);
      }
      notify();
    }
  }

  // Retour du réseau : relance immédiate des ops PENDING (les 'failed' restent
  // en retry MANUEL — décision Q2).
  if (typeof window !== 'undefined') window.addEventListener('online', kick);

  // --- Hydratation : DRAINER la file d'abord (rien ne se perd), puis GET /state ---
  async function fetchState(): Promise<AppState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}/state`, { credentials: CREDS, signal: controller.signal });
      if (!res.ok) { on401(res.status); throw new SendError(res.status, `GET /state -> ${res.status}`); }
      return await res.json() as AppState;
    } finally {
      clearTimeout(timer);
    }
  }

  // Vide la file d'un trait ; échec EXPLICITE si elle ne peut pas l'être
  // (op refusée, ou réseau indisponible). Les ops restent persistées.
  async function drain(): Promise<void> {
    if (inFlight) throw new Error('Synchronisation déjà en cours');
    inFlight = true;
    try {
      for (let op = box.head(); op; op = box.head()) {
        if (op.status === 'failed') throw new Error(`Une modification en attente a été refusée (${op.label})`);
        box.setLockedSeq(op.seq);
        try {
          await send(op);
          box.confirm(op.seq);
        } catch (e) {
          box.setLockedSeq(null);
          box.recordFailure(op.seq, (e as Error).message, { definitive: isDefinitive(e), maxAttempts });
          throw new Error(`${box.size()} modification(s) en attente n'ont pas pu être synchronisées — vérifiez la connexion puis réessayez`);
        }
      }
    } finally {
      inFlight = false;
      notify();
    }
  }

  const hydrate = async (): Promise<AppState> => {
    if (box.hasPending()) await drain(); // les écritures en attente partent AVANT de lire
    return fetchState();
  };

  // Import en masse : appel DIRECT (hors outbox), atomique côté serveur. Timeout
  // large (un import peut porter des centaines de leads) et message d'erreur clair
  // (le serveur renvoie {error} ; la transaction garantit « rien à moitié »).
  const bulkImport = async (payload: ImportPayload): Promise<ImportReport> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetchImpl(`${baseUrl}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: CREDS,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        on401(res.status);
        let detail = '';
        try { detail = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* corps non-JSON */ }
        throw new Error(detail || `Import refusé (${res.status})`);
      }
      return await res.json() as ImportReport;
    } finally {
      clearTimeout(timer);
    }
  };

  // Restauration : appel DIRECT (hors outbox), REMPLACEMENT TOTAL atomique côté
  // serveur. Timeout large ; message d'erreur clair (transaction -> « rien à moitié »).
  const restore = async (payload: BackupEnvelope): Promise<RestoreReport> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetchImpl(`${baseUrl}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: CREDS,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        on401(res.status);
        let detail = '';
        try { detail = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* corps non-JSON */ }
        throw new Error(detail || `Restauration refusée (${res.status})`);
      }
      return await res.json() as RestoreReport;
    } finally {
      clearTimeout(timer);
    }
  };

  // --- Auth (compte unique partagé, Lot 7 allégé) ---
  const checkSession = async (): Promise<boolean> => {
    try {
      const res = await fetchImpl(`${baseUrl}/session`, { credentials: CREDS });
      return res.ok;
    } catch { return false; }
  };
  const login = async (username: string, password: string): Promise<void> => {
    const res = await fetchImpl(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: CREDS,
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* corps non-JSON */ }
      throw new Error(detail || (res.status === 401 ? 'Identifiants invalides' : `Connexion refusée (${res.status})`));
    }
  };
  const logout = async (): Promise<void> => {
    try { await fetchImpl(`${baseUrl}/logout`, { method: 'POST', credentials: CREDS }); } catch { /* best-effort */ }
  };

  // --- Contrôles UI (badge + panneau d'échec, étape C) ---
  const sync: RepositorySync = {
    info: currentInfo,
    hasPending: () => box.hasPending(),
    retryFailed() {
      const failedOp = box.ops().find(o => o.status === 'failed');
      if (!failedOp) return;
      box.retryFailed(failedOp.seq);
      kick();
    },
    async abandonFailed() {
      const failedOp = box.ops().find(o => o.status === 'failed');
      if (!failedOp) return;
      box.removeFailed(failedOp.seq);
      // On tente de vider le reste, puis on RÉALIGNE l'écran sur la vérité
      // serveur (seul cas de re-hydratation, et il est demandé par l'utilisateur).
      try { await drain(); } catch { return; } // file pas vidable : le badge continue d'informer
      const state = await fetchState();
      dispatch({ type: 'SET_STATE', payload: state });
    },
  };

  // --- Mutations : dispatch optimiste (base) + intention captée à la source ---
  return {
    getInitialState: getEmptyState,
    persist,
    hydrate,
    sync,
    bulkImport,
    restore,
    checkSession,
    login,
    logout,

    addLead: (lead) => { const id = base.addLead(lead); remember({ kind: 'create', entity: 'leads', id }); return id; },
    updateLead: (id, data) => { base.updateLead(id, data); remember({ kind: 'update', entity: 'leads', id }); },
    deleteLead: (id) => { base.deleteLead(id); remember({ kind: 'delete', entity: 'leads', id }); },
    updateLeadStatus: (id, status) => { base.updateLeadStatus(id, status); remember({ kind: 'update', entity: 'leads', id }); },
    setNextAction: (id, t, d, time, end) => { base.setNextAction(id, t, d, time, end); remember({ kind: 'update', entity: 'leads', id }); },

    // ADD_ACTION a un SIDE-EFFECT sur le lead (lastActionDate, statut, prochaine
    // action) : on capte les DEUX intentions — les payloads seront figés
    // post-reducer, donc exacts. L'id est généré ICI (base.addAction ne le
    // renvoie pas) : même dispatch, même payload qu'en base.
    addAction: (action) => {
      const id = generateId();
      dispatch({ type: 'ADD_ACTION', payload: { ...action, id } });
      remember({ kind: 'create', entity: 'actions', id });
      remember({ kind: 'update', entity: 'leads', id: action.leadId });
    },
    updateAction: (id, data) => { base.updateAction(id, data); remember({ kind: 'update', entity: 'actions', id }); },
    deleteAction: (id) => { base.deleteAction(id); remember({ kind: 'delete', entity: 'actions', id }); },

    addCommercial: (c) => { const id = base.addCommercial(c); remember({ kind: 'create', entity: 'commercials', id }); return id; },
    updateCommercial: (id, data) => { base.updateCommercial(id, data); remember({ kind: 'update', entity: 'commercials', id }); },
    toggleCommercial: (id) => { base.toggleCommercial(id); remember({ kind: 'update', entity: 'commercials', id }); },

    addTemplate: (t) => { const id = base.addTemplate(t); remember({ kind: 'create', entity: 'templates', id }); return id; },
    updateTemplate: (id, data) => { base.updateTemplate(id, data); remember({ kind: 'update', entity: 'templates', id }); },
    deleteTemplate: (id) => { base.deleteTemplate(id); remember({ kind: 'delete', entity: 'templates', id }); },

    addCalendarEvent: (e) => { const id = base.addCalendarEvent(e); remember({ kind: 'create', entity: 'calendar-events', id }); return id; },
    updateCalendarEvent: (id, data) => { base.updateCalendarEvent(id, data); remember({ kind: 'update', entity: 'calendar-events', id }); },
    deleteCalendarEvent: (id) => { base.deleteCalendarEvent(id); remember({ kind: 'delete', entity: 'calendar-events', id }); },

    saveMonthlyStats: (stats) => { base.saveMonthlyStats(stats); remember({ kind: 'batch', entity: 'monthly-stats' }); },
    saveGoals: (goals) => { base.saveGoals(goals); remember({ kind: 'batch', entity: 'goals' }); },
    saveDefaultGoal: (dg) => { base.saveDefaultGoal(dg); remember({ kind: 'batch', entity: 'default-goal' }); },
  };
}
