/**
 * Harnais de l'implémentation API du repository (chantier migration, Lot 5).
 *
 * Exécution : npx tsx scripts/harness-api-client.ts
 *
 * Prouve createApiRepository (bascule flag ON) SANS serveur ni navigateur :
 * `fetch` est SIMULÉ (mini-serveur en mémoire), le cache est piloté par le VRAI
 * reducer (comme AppProvider). Couvre :
 *  - hydrate() : GET /api/state -> état serveur ;
 *  - mutation OPTIMISTE : dispatch immédiat (cache) puis, au persist réactif,
 *    l'appel API par entité (bonne URL/méthode/corps AVEC champs dérivés) ;
 *  - diff-sync : persist sans changement = aucun appel ; suppression de lead =
 *    DELETE lead sans DELETE des actions cascadées ;
 *  - échec d'un appel -> onError + re-hydratation (GET /state -> SET_STATE).
 */

// localStorage mock (repository.ts importe storage.ts ; saveState/loadState ne
// sont jamais appelés par l'impl API, mais on protège l'import defensivement).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

import { createApiRepository, getEmptyState } from '../src/lib/repository';
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
const tick = () => new Promise(res => setTimeout(res, 0)); // laisse la file d'appels se vider

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
    firstName: 'Jean', lastName: 'Test', phone: '0600000000', email: 'j@test.fr',
    boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
    budget: 50000, status: 'contacte', contactDate: '2026-06-02', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
    priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '2026-06-05',
    lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
  };
}

// --- mini-serveur simulé (fetch) ---
interface Recorded { method: string; path: string; body?: unknown }
function makeServer(serverState: AppState) {
  const recorded: Recorded[] = [];
  let failNextWrite = false;
  const fetchImpl = (async (url: string | URL, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const path = String(url);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    recorded.push({ method, path, body });
    if (method !== 'GET' && failNextWrite) {
      failNextWrite = false;
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response;
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => serverState } as Response;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return {
    fetchImpl, recorded,
    failWriteOnce: () => { failNextWrite = true; },
    writes: () => recorded.filter(r => r.method !== 'GET'),
    gets: () => recorded.filter(r => r.method === 'GET'),
  };
}

async function main() {
  section('hydrate() : GET /api/state -> état serveur');
  {
    const serverState: AppState = { ...getEmptyState(), commercials: [{ id: 'fred', name: 'Fred', active: true }] };
    const srv = makeServer(serverState);
    let cache = getEmptyState();
    const dispatch = (a: Action) => { cache = reducer(cache, a); };
    const repo = createApiRepository({ dispatch, onError: () => {}, baseUrl: '/api', token: 't', fetchImpl: srv.fetchImpl });

    const s = await repo.hydrate!();
    check('hydrate renvoie l\'état serveur', s.commercials.length === 1 && s.commercials[0].id === 'fred');
    check('un GET /api/state a été émis', srv.gets().length === 1 && srv.gets()[0].path === '/api/state');
    // Après hydratation, persist(serverState) ne doit RIEN émettre (serveur vs serveur).
    repo.persist(s); await tick();
    check('persist(état serveur) après hydrate = aucun appel', srv.writes().length === 0);
  }

  section('Mutation OPTIMISTE + diff-sync : dispatch immédiat puis POST au persist');
  {
    const srv = makeServer(getEmptyState());
    let cache = getEmptyState();
    const dispatch = (a: Action) => { cache = reducer(cache, a); };
    const repo = createApiRepository({ dispatch, onError: () => {}, baseUrl: '/api', token: 't', fetchImpl: srv.fetchImpl });
    await repo.hydrate!(); // lastSynced = vide

    // Pré-requis : un commercial (le lead y référence commercialId 'fred').
    repo.addCommercial({ name: 'Fred', active: true });
    check('addCommercial : cache MAJ immédiate (optimiste)', cache.commercials.length === 1);
    const fredId = cache.commercials[0].id;

    repo.addLead(makeLead({ id: undefined as unknown as string, commercialId: fredId }));
    check('addLead : cache MAJ immédiate (optimiste)', cache.leads.length === 1);
    const lead = cache.leads[0];

    // Simule l'effet réactif AppProvider : persist(state) après le batch.
    repo.persist(cache); await tick();
    const writes = srv.writes();
    const postLead = writes.find(w => w.path === '/api/leads' && w.method === 'POST');
    check('POST /api/leads émis', !!postLead);
    check('le POST porte les CHAMPS DÉRIVÉS du reducer (contactDate posée)',
      !!postLead && (postLead.body as Lead).contactDate !== '', JSON.stringify((postLead?.body as Lead)?.contactDate));
    check('POST /api/commercials émis avant', writes.some(w => w.path === '/api/commercials' && w.method === 'POST'));

    // persist sans changement -> aucun nouvel appel.
    const before = srv.writes().length;
    repo.persist(cache); await tick();
    check('persist sans changement = aucun nouvel appel', srv.writes().length === before);

    // Modif -> PATCH ; suppression -> DELETE.
    repo.updateLead(lead.id, { status: 'devis_envoye' }); repo.persist(cache); await tick();
    check('PATCH /api/leads/:id sur modification', srv.writes().some(w => w.method === 'PATCH' && w.path === `/api/leads/${lead.id}`));
    repo.deleteLead(lead.id); repo.persist(cache); await tick();
    check('DELETE /api/leads/:id sur suppression', srv.writes().some(w => w.method === 'DELETE' && w.path === `/api/leads/${lead.id}`));
  }

  section('Cascade : supprimer un lead avec action -> DELETE lead SANS DELETE action');
  {
    const srv = makeServer(getEmptyState());
    let cache = getEmptyState();
    const dispatch = (a: Action) => { cache = reducer(cache, a); };
    const repo = createApiRepository({ dispatch, onError: () => {}, baseUrl: '/api', token: 't', fetchImpl: srv.fetchImpl });
    await repo.hydrate!();
    repo.addCommercial({ name: 'Fred', active: true });
    repo.addLead(makeLead({ id: undefined as unknown as string, commercialId: cache.commercials[0].id }));
    const leadId = cache.leads[0].id;
    repo.addAction({ leadId, type: 'appel', date: '2026-06-06', result: 'ok', notes: '', authorId: cache.commercials[0].id });
    repo.persist(cache); await tick();
    const actionId = cache.actions[0].id;

    repo.deleteLead(leadId); repo.persist(cache); await tick();
    check('DELETE /api/leads/:id émis', srv.writes().some(w => w.method === 'DELETE' && w.path === `/api/leads/${leadId}`));
    check('AUCUN DELETE /api/actions/:id (cascade serveur)', !srv.writes().some(w => w.method === 'DELETE' && w.path === `/api/actions/${actionId}`));
  }

  section('Échec d\'un appel -> onError + re-hydratation (SET_STATE)');
  {
    // Le serveur renverra un état "vérité" lors de la re-sync.
    const truth: AppState = { ...getEmptyState(), commercials: [{ id: 'fred', name: 'Fred', active: true }] };
    const srv = makeServer(truth);
    let cache = getEmptyState();
    const dispatch = (a: Action) => { cache = reducer(cache, a); };
    let errMsg: string | null = null;
    const repo = createApiRepository({ dispatch, onError: (m) => { errMsg = m; }, baseUrl: '/api', token: 't', fetchImpl: srv.fetchImpl });
    await repo.hydrate!();

    srv.failWriteOnce(); // le prochain write échoue
    repo.addCommercial({ name: 'Ghost', active: true }); // optimiste : cache a 'Ghost'
    check('cache optimiste contient Ghost avant échec', cache.commercials.some(c => c.name === 'Ghost'));
    repo.persist(cache); await tick(); await tick();

    check('onError notifié', errMsg !== null);
    check('re-hydratation : un 2e GET /api/state émis', srv.gets().length >= 2);
    check('cache RÉALIGNÉ sur la vérité serveur (Ghost écarté)', !cache.commercials.some(c => c.name === 'Ghost') && cache.commercials.length === 1);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais API client : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  console.log(failed === 0 ? 'Tous les invariants tiennent. ✅' : 'ÉCHECS détectés. ❌');
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Harnais API client — erreur fatale :', e); process.exit(1); });
