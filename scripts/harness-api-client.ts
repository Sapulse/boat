/**
 * Harnais de l'implémentation API du repository (Lot 5, refondu au correctif
 * audit #3 : OUTBOX persistante + worker d'envoi).
 *
 * Exécution : npx tsx scripts/harness-api-client.ts
 *
 * Prouve, SANS serveur ni navigateur (fetch simulé, storage mocké, délais de
 * retry injectés, VRAI reducer pour le cache) :
 *  - mutation -> intention à la source -> op FIGÉE post-reducer (champs dérivés
 *    inclus) -> envoi FIFO -> retrait UNIQUEMENT sur confirmation serveur ;
 *  - side-effect d'ADD_ACTION sur le lead capté (2 ops) ;
 *  - échec transitoire -> op PRÉSERVÉE (persistée), cache INTACT (pas de
 *    SET_STATE), retry auto -> livrée (« rien ne se perd ») ;
 *  - réseau coupé sur plusieurs écritures -> reprise DANS L'ORDRE ;
 *  - rechargement d'onglet -> la file repart (drain AVANT hydratation) ;
 *  - hydratation hors ligne -> échec EXPLICITE, ops préservées ;
 *  - échec définitif (4xx) -> failed, file BLOQUÉE, retry manuel / abandon
 *    (réalignement serveur UNIQUEMENT sur abandon explicite) ;
 *  - idempotence du retry : POST->409->PATCH ; DELETE->404 = succès ;
 *  - timeout (requête qui pend) -> abort -> retry ;
 *  - fusion des intentions d'un même tick (update+update -> 1 op).
 */

// Mock localStorage global AVANT les imports (storage.ts y accède à l'appel).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

import { createApiRepository, getEmptyState, type SyncInfo } from '../src/lib/repository';
import { OUTBOX_STORAGE_KEY, type StorageLike } from '../src/lib/outbox';
import { reducer } from '../src/context/appReducer';
import type { Action } from '../src/context/appReducer';
import type { AppState, Lead } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }
const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

function makeLead(over: Partial<Lead> = {}): Omit<Lead, 'id'> {
  return {
    createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
    firstName: 'Jean', lastName: 'Test', phone: '0600000000', email: 'j@test.fr',
    boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
    budget: 50000, status: 'contacte', contactDate: '', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
    priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '',
    lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
  };
}

function makeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
  };
}
const outboxSize = (storage: StorageLike): number => {
  const raw = storage.getItem(OUTBOX_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { ops: unknown[] }).ops.length : 0;
};

// --- mini-serveur programmable ---
interface Received { method: string; path: string; body?: unknown }
function makeServer(serverState: AppState) {
  const received: Received[] = [];
  const srv = {
    received,
    networkDown: false,
    hang: false,
    respondWith: null as ((method: string, path: string) => { status: number; json?: unknown } | null) | null,
    // Hook appelé PENDANT le traitement d'un GET /state (avant de répondre) :
    // permet de simuler une écriture qui démarre au milieu d'une lecture (test de course).
    onGet: null as (null | (() => void | Promise<void>)),
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url);
      if (srv.hang) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }) as Promise<Response>;
      }
      if (srv.networkDown) throw new TypeError('Failed to fetch');
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      received.push({ method, path, body });
      const custom = srv.respondWith?.(method, path);
      if (custom) return { ok: custom.status < 400, status: custom.status, json: async () => custom.json ?? { error: 'refusé' } } as Response;
      if (method === 'GET') {
        if (srv.onGet) await srv.onGet();
        return { ok: true, status: 200, json: async () => serverState } as Response;
      }
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch,
  };
  return srv;
}

function makeRepo(srv: ReturnType<typeof makeServer>, storage: StorageLike, over: { maxAttempts?: number; timeoutMs?: number } = {}) {
  let cache = getEmptyState();
  const dispatch = (a: Action) => { cache = reducer(cache, a); };
  const syncEvents: SyncInfo[] = [];
  const repo = createApiRepository({
    dispatch,
    fetchImpl: srv.fetchImpl,
    baseUrl: '/api',
    storage,
    retryDelaysMs: [5, 5, 5],
    maxAttempts: over.maxAttempts ?? 3,
    timeoutMs: over.timeoutMs ?? 200,
    onSync: i => { syncEvents.push(i); },
  });
  return { repo, cache: () => cache, syncEvents, persist: () => repo.persist(cache) };
}

async function main() {
  section('Mutation -> op FIGÉE post-reducer -> envoi FIFO -> retrait sur confirmation');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, persist } = makeRepo(srv, storage);

    repo.addCommercial({ name: 'Fred', active: true });
    const fredId = cache().commercials[0].id;
    // Lead créé DIRECTEMENT en 'signe' avec dates vides : le reducer pose les
    // jalons (signedAt/contactDate) -> l'op doit porter ces champs DÉRIVÉS.
    repo.addLead(makeLead({ commercialId: fredId, status: 'signe' }));
    persist();
    await wait(20);

    const posts = srv.received.filter(r => r.method === 'POST');
    check('2 ops envoyées (commercial puis lead)', posts.length === 2);
    check('FIFO : commercial AVANT lead', posts[0]?.path === '/api/commercials' && posts[1]?.path === '/api/leads');
    check('payload FIGÉ post-reducer : signedAt dérivé inclus', (posts[1]?.body as Lead)?.signedAt === '2026-06-01', JSON.stringify((posts[1]?.body as Lead)?.signedAt));
    check('file vide après confirmations (retrait sur succès)', outboxSize(storage) === 0);
  }

  section('ADD_ACTION : side-effect sur le lead capté (2 ops, action puis lead)');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, persist } = makeRepo(srv, storage);
    repo.addCommercial({ name: 'Fred', active: true });
    repo.addLead(makeLead({ commercialId: cache().commercials[0].id }));
    persist(); await wait(20);
    const leadId = cache().leads[0].id;

    srv.received.length = 0;
    repo.addAction({ leadId, type: 'appel', date: '2026-06-10', result: 'OK', notes: '', authorId: cache().commercials[0].id });
    persist(); await wait(20);

    check('POST /api/actions émis', srv.received.some(r => r.method === 'POST' && r.path === '/api/actions'));
    const leadPatch = srv.received.find(r => r.method === 'PATCH' && r.path === `/api/leads/${leadId}`);
    check('PATCH /api/leads/:id émis (side-effect)', !!leadPatch);
    check('le PATCH porte lastActionDate dérivé par le reducer', (leadPatch?.body as Lead)?.lastActionDate === '2026-06-10');
    check('file vide', outboxSize(storage) === 0);
  }

  section('Échec transitoire : op PRÉSERVÉE, cache INTACT, retry auto -> LIVRÉE');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, persist, syncEvents } = makeRepo(srv, storage, { maxAttempts: 99 });

    srv.networkDown = true;
    repo.addCommercial({ name: 'Ghost', active: true });
    persist();
    await wait(15);

    check('cache INTACT pendant l\'échec (Ghost toujours affiché)', cache().commercials.some(c => c.name === 'Ghost'));
    check('op PRÉSERVÉE en file (persistée)', outboxSize(storage) === 1);
    check('état de synchro signalé (waiting/offline)', syncEvents.some(e => e.status === 'waiting' || e.status === 'offline'));
    check('rien reçu côté serveur', srv.received.length === 0);

    srv.networkDown = false;
    await wait(30); // le backoff (5 ms) relance
    check('retry auto : op LIVRÉE au retour du réseau', srv.received.some(r => r.method === 'POST' && r.path === '/api/commercials'));
    check('file vidée après confirmation', outboxSize(storage) === 0);
    check('Ghost toujours dans le cache (conservé ET livré — plus jamais écarté)', cache().commercials.some(c => c.name === 'Ghost'));
  }

  section('Réseau coupé sur PLUSIEURS écritures -> reprise DANS L\'ORDRE, rien perdu');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, persist } = makeRepo(srv, storage, { maxAttempts: 99 });
    repo.addCommercial({ name: 'Fred', active: true });
    persist(); await wait(20);

    srv.networkDown = true;
    srv.received.length = 0;
    repo.addLead(makeLead({ commercialId: cache().commercials[0].id }));
    persist();
    const leadId = cache().leads[0].id;
    repo.addAction({ leadId, type: 'rdv', date: '2026-06-12', result: '', notes: '', authorId: cache().commercials[0].id });
    persist();
    await wait(15);
    check('3 ops en attente (lead + action + patch lead)', outboxSize(storage) === 3, `=${outboxSize(storage)}`);

    srv.networkDown = false;
    await wait(60);
    const idxLead = srv.received.findIndex(r => r.method === 'POST' && r.path === '/api/leads');
    const idxAction = srv.received.findIndex(r => r.method === 'POST' && r.path === '/api/actions');
    check('reprise : lead envoyé AVANT son action (FIFO, FK respectée)', idxLead !== -1 && idxAction !== -1 && idxLead < idxAction);
    check('rien perdu : file vide', outboxSize(storage) === 0);
  }

  section('Rechargement d\'onglet : la file REPART (drain avant hydratation)');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const first = makeRepo(srv, storage, { maxAttempts: 99 });
    srv.networkDown = true;
    first.repo.addCommercial({ name: 'Fred', active: true });
    first.persist();
    await wait(15);
    check('op en attente au moment de la « fermeture »', outboxSize(storage) === 1);

    // « Rechargement » : NOUVELLE instance, même storage, réseau revenu.
    srv.networkDown = false;
    srv.received.length = 0;
    const second = makeRepo(srv, storage, { maxAttempts: 99 });
    const state = await second.repo.hydrate!();
    const idxPost = srv.received.findIndex(r => r.method === 'POST' && r.path === '/api/commercials');
    const idxGet = srv.received.findIndex(r => r.method === 'GET' && r.path === '/api/state');
    check('drain AVANT hydratation (POST avant GET /state)', idxPost !== -1 && idxGet !== -1 && idxPost < idxGet);
    check('file vidée, hydratation rendue', outboxSize(storage) === 0 && Array.isArray(state.leads));
  }

  section('Hydratation HORS LIGNE avec ops en attente : échec EXPLICITE, ops préservées');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const first = makeRepo(srv, storage, { maxAttempts: 99 });
    srv.networkDown = true;
    first.repo.addCommercial({ name: 'Fred', active: true });
    first.persist();
    await wait(15);

    const second = makeRepo(srv, storage, { maxAttempts: 99 });
    let message = '';
    try { await second.repo.hydrate!(); } catch (e) { message = (e as Error).message; }
    check('hydrate échoue EXPLICITEMENT (pas d\'app vide trompeuse)', message.includes('en attente'), message);
    check('les ops restent persistées (rien perdu)', outboxSize(storage) >= 1);
  }

  section('Échec DÉFINITIF (400) : failed, file BLOQUÉE, retry manuel, abandon = réalignement');
  {
    const truth: AppState = { ...getEmptyState(), commercials: [{ id: 'fred', name: 'Fred', active: true }] };
    const srv = makeServer(truth);
    const storage = makeStorage();
    const { repo, cache, persist, syncEvents } = makeRepo(srv, storage);

    srv.respondWith = (m, p) => (m === 'POST' && p === '/api/leads' ? { status: 400, json: { error: 'lead invalide' } } : null);
    repo.addLead(makeLead({ commercialId: 'fred' }));
    persist(); await wait(15);
    repo.addCalendarEvent({ title: 'Réunion', date: '2026-06-20' });
    persist(); await wait(15);

    const failedEvt = syncEvents.find(e => e.status === 'failed');
    check('op refusée -> statut failed signalé, avec label humain', !!failedEvt && (failedEvt.failed?.label ?? '').startsWith('Lead'), JSON.stringify(failedEvt?.failed));
    check('file BLOQUÉE : l\'événement suivant n\'est PAS envoyé', !srv.received.some(r => r.path === '/api/calendar-events'));
    check('les 2 ops restent en file', outboxSize(storage) === 2);

    // Retry manuel après correction côté serveur.
    srv.respondWith = null;
    repo.sync!.retryFailed();
    await wait(30);
    check('retry manuel : les 2 ops livrées dans l\'ordre', srv.received.some(r => r.path === '/api/leads') && srv.received.some(r => r.path === '/api/calendar-events'));
    check('file vide', outboxSize(storage) === 0);

    // Abandon : nouvelle op refusée -> abandonFailed -> réalignement serveur.
    srv.respondWith = (m, p) => (m === 'POST' && p === '/api/leads' ? { status: 400 } : null);
    repo.addLead(makeLead({ commercialId: 'fred', firstName: 'Fantome' }));
    persist(); await wait(15);
    check('cache contient l\'op optimiste avant abandon', cache().leads.some(l => l.firstName === 'Fantome'));
    await repo.sync!.abandonFailed();
    check('abandon : op retirée, file vide', outboxSize(storage) === 0);
    check('réalignement DEMANDÉ : cache = vérité serveur (Fantome retiré)', !cache().leads.some(l => l.firstName === 'Fantome') && cache().commercials.length === 1);
  }

  section('Idempotence du retry : POST->409 converti en PATCH ; DELETE->404 = succès');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, persist } = makeRepo(srv, storage);
    repo.addCommercial({ name: 'Fred', active: true });
    persist(); await wait(15);

    srv.respondWith = (m, p) => (m === 'POST' && p === '/api/leads' ? { status: 409 } : null);
    repo.addLead(makeLead({ commercialId: cache().commercials[0].id }));
    persist(); await wait(20);
    const leadId = cache().leads[0].id;
    check('POST->409 converti en PATCH (même payload)', srv.received.some(r => r.method === 'PATCH' && r.path === `/api/leads/${leadId}`));
    check('op confirmée (file vide)', outboxSize(storage) === 0);

    srv.respondWith = (m) => (m === 'DELETE' ? { status: 404 } : null);
    repo.deleteLead(leadId);
    persist(); await wait(15);
    check('DELETE->404 traité comme succès (déjà supprimé)', outboxSize(storage) === 0);
  }

  section('404 sur PATCH : op OBSOLÈTE retirée (file NON bloquée, correctif 4.1)');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, syncEvents, persist } = makeRepo(srv, storage);
    repo.addCommercial({ name: 'Fred', active: true });
    const fredId = cache().commercials[0].id;
    const leadId = repo.addLead(makeLead({ commercialId: fredId }));
    persist();
    await wait(30);
    check('lead créé + confirmé (file vide)', outboxSize(storage) === 0);

    // Le serveur renvoie 404 sur le PATCH (entité « disparue » côté serveur).
    srv.respondWith = (m) => (m === 'PATCH' ? { status: 404 } : null);
    repo.updateLead(leadId, { status: 'perdu' });
    persist();
    await wait(30);
    check('PATCH->404 traité comme succès : op RETIRÉE (pas failed)', outboxSize(storage) === 0);
    check('AUCUN événement failed (file non bloquée)', !syncEvents.some(e => e.status === 'failed'));

    // File NON bloquée : l'op SUIVANTE (serveur OK) part bien.
    srv.respondWith = null;
    const before = srv.received.length;
    repo.updateLead(leadId, { status: 'contacte' });
    persist();
    await wait(30);
    check('op suivante ENVOYÉE (file non bloquée)', srv.received.length > before && outboxSize(storage) === 0);
  }

  section('Timeout (requête qui pend) : abort -> échec transitoire -> retry livre');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, persist } = makeRepo(srv, storage, { maxAttempts: 99, timeoutMs: 20 });
    srv.hang = true;
    repo.addCommercial({ name: 'Lent', active: true });
    persist();
    await wait(40); // > timeout -> abort -> échec transitoire
    check('op toujours en file après timeout (pas de blocage infini)', outboxSize(storage) === 1);
    srv.hang = false;
    await wait(40);
    check('retry après timeout : livrée', srv.received.some(r => r.method === 'POST' && r.path === '/api/commercials'));
    check('file vide', outboxSize(storage) === 0);
  }

  section('Fusion des intentions d\'un même tick : update+update -> UNE op (payload final)');
  {
    const srv = makeServer(getEmptyState());
    const storage = makeStorage();
    const { repo, cache, persist } = makeRepo(srv, storage);
    repo.addCommercial({ name: 'Fred', active: true });
    repo.addLead(makeLead({ commercialId: cache().commercials[0].id }));
    persist(); await wait(20);
    const leadId = cache().leads[0].id;

    srv.received.length = 0;
    repo.updateLead(leadId, { status: 'qualifie' });
    repo.updateLead(leadId, { temperature: 'chaud' });
    persist(); await wait(20);
    const patches = srv.received.filter(r => r.method === 'PATCH' && r.path === `/api/leads/${leadId}`);
    check('2 updates même tick -> 1 seul PATCH', patches.length === 1, `=${patches.length}`);
    check('le PATCH porte les DEUX changements', (patches[0]?.body as Lead)?.status === 'qualifie' && (patches[0]?.body as Lead)?.temperature === 'chaud');
  }

  section('Re-hydratation v2 (refresh) — double-garde outbox (correctif #3, anti-bug v1)');
  {
    // (c) SYNCHRO OK quand l'outbox est VIDE : refresh applique l'état serveur.
    const storage = makeStorage();
    const srvLead = { ...makeLead({ firstName: 'Serveur' }), id: 'srv1' } as Lead;
    const srv = makeServer({ ...getEmptyState(), leads: [srvLead] });
    const { repo, cache } = makeRepo(srv, storage);
    await repo.sync!.refresh();
    check('(c) outbox vide : refresh applique l\'état serveur', cache().leads.length === 1 && cache().leads[0].id === 'srv1');
    check('(c) un GET /state a bien eu lieu', srv.received.some(r => r.method === 'GET'));
  }
  {
    // (a) ÉCRITURE EN ATTENTE jamais écrasée : op pending -> refresh ne lit/applique PAS (garde 1).
    const storage = makeStorage();
    const srvLead = { ...makeLead({ firstName: 'Serveur' }), id: 'srv1' } as Lead;
    const srv = makeServer({ ...getEmptyState(), leads: [srvLead] });
    const { repo, cache, persist } = makeRepo(srv, storage);
    srv.networkDown = true;                 // l'envoi de l'op échoue -> op reste PENDING
    const localId = repo.addLead(makeLead({ firstName: 'Local' }));
    persist();
    await wait(30);
    srv.networkDown = false;
    srv.received.length = 0;                 // on oublie les tentatives d'envoi
    await repo.sync!.refresh();
    check('(a) op en attente : AUCUN GET /state (garde 1)', !srv.received.some(r => r.method === 'GET'));
    check('(a) l\'écriture locale est INTACTE (pas d\'écrasement)', cache().leads.some(l => l.id === localId));
    check('(a) l\'état serveur n\'a PAS été appliqué', !cache().leads.some(l => l.id === 'srv1'));
  }
  {
    // (a-RACE) LE test clé : une écriture DÉMARRE PENDANT le fetch -> jamais écrasée (garde 2).
    // Pendant le GET, on enfile une écriture ET on fait PENDRE son envoi -> à la
    // reprise du refresh, hasPending/inFlight sont vrais -> la lecture est JETÉE.
    const storage = makeStorage();
    const srvLead = { ...makeLead({ firstName: 'Serveur' }), id: 'srv1' } as Lead;
    const srv = makeServer({ ...getEmptyState(), leads: [srvLead] });
    const { repo, cache, persist } = makeRepo(srv, storage);
    let raced = false;
    srv.onGet = () => {
      if (raced) return;
      raced = true;
      srv.hang = true;                       // l'envoi (POST) de l'écriture va PENDRE -> op en vol
      repo.addLead(makeLead({ firstName: 'Course' }));
      persist();                             // kick -> pump -> POST qui pend -> inFlight reste vrai
    };
    await repo.sync!.refresh();
    check('(a-RACE) écriture pendant le fetch : état serveur NON appliqué (garde 2)', !cache().leads.some(l => l.id === 'srv1'));
    check('(a-RACE) l\'écriture de course est PRÉSERVÉE', cache().leads.some(l => l.firstName === 'Course'));
    srv.hang = false;                        // laisse l'op se draîner proprement (évite un timer pendant)
    await wait(30);
  }
  {
    // Échec réseau : refresh est SILENCIEUX (ne throw pas), garde l'état courant.
    const storage = makeStorage();
    const srv = makeServer({ ...getEmptyState(), leads: [{ ...makeLead(), id: 'srv1' } as Lead] });
    const { repo, cache } = makeRepo(srv, storage);
    srv.networkDown = true;
    let threw = false;
    try { await repo.sync!.refresh(); } catch { threw = true; }
    check('échec réseau : refresh NE throw PAS (silencieux)', !threw);
    check('échec réseau : l\'état serveur n\'est PAS appliqué', !cache().leads.some(l => l.id === 'srv1'));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais API client : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  console.log(failed === 0 ? 'Tous les invariants tiennent. ✅' : 'ÉCHECS détectés. ❌');
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Harnais API client — erreur fatale :', e); process.exit(1); });
