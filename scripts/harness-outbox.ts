/**
 * Harnais de l'outbox persistante (correctif audit #3, étape A).
 *
 * Exécution : npx tsx scripts/harness-outbox.ts
 *
 * Prouve le module PUR src/lib/outbox.ts (file d'opérations du mode API) :
 *  - persistance sur la clé DÉDIÉE (crm-nautisme-data JAMAIS touchée) ;
 *  - FIFO strict (seq monotone, poursuivi après rechargement) ;
 *  - coalescing PATCH même path (queue non verrouillée uniquement) ;
 *  - confirmation par seq = retrait ; échec = attempts++ puis 'failed'
 *    (définitif OU plafond de tentatives atteint) ;
 *  - retry manuel (failed -> pending, tentatives remises à zéro) ; abandon ;
 *  - survie au rechargement (nouvelle instance, même storage) ;
 *  - cap (refus BRUYANT au-delà, jamais silencieux).
 */
import { createOutbox, OutboxFullError, OUTBOX_STORAGE_KEY, type StorageLike } from '../src/lib/outbox';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

function makeStorage(): StorageLike & { keys(): string[] } {
  const map = new Map<string, string>();
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
    keys: () => [...map.keys()],
  };
}

const op = (n: number, over: Partial<Parameters<ReturnType<typeof createOutbox>['enqueue']>[0]> = {}) => ({
  method: 'POST' as const,
  path: `/leads/l${n}`,
  body: { id: `l${n}` },
  entity: 'leads',
  entityId: `l${n}`,
  label: `Lead l${n} — création`,
  ...over,
});

function main() {
  section('Persistance : clé DÉDIÉE, crm-nautisme-data intouchée');
  {
    const storage = makeStorage();
    const box = createOutbox({ storage });
    box.enqueue(op(1));
    check('la file est persistée sur la clé dédiée', storage.getItem(OUTBOX_STORAGE_KEY) !== null);
    check('clé = crm-nautisme-outbox', OUTBOX_STORAGE_KEY === 'crm-nautisme-outbox');
    check('AUCUNE écriture sur crm-nautisme-data', storage.keys().every(k => k !== 'crm-nautisme-data'));
    const persisted = JSON.parse(storage.getItem(OUTBOX_STORAGE_KEY)!);
    check('format versionné {version:1, ops:[...]}', persisted.version === 1 && Array.isArray(persisted.ops) && persisted.ops.length === 1);
  }

  section('FIFO : seq monotone, head = plus ancienne');
  {
    const box = createOutbox({ storage: makeStorage() });
    const a = box.enqueue(op(1));
    const b = box.enqueue(op(2, { method: 'DELETE', path: '/actions/a1', entity: 'actions', body: undefined }));
    const c = box.enqueue(op(3));
    check('seq strictement croissants', a.seq < b.seq && b.seq < c.seq);
    check('head = première op (FIFO)', box.head()?.seq === a.seq);
    check('size = 3', box.size() === 3);
  }

  section('Coalescing : PATCH même path -> body remplacé (queue seulement, jamais l\'op en vol)');
  {
    const box = createOutbox({ storage: makeStorage() });
    box.enqueue(op(1, { method: 'PATCH', path: '/leads/lx', body: { status: 'contacte' } }));
    box.enqueue(op(1, { method: 'PATCH', path: '/leads/lx', body: { status: 'qualifie' } }));
    check('2 PATCH même path -> 1 op', box.size() === 1);
    check('le body est le DERNIER', (box.head()?.body as { status: string }).status === 'qualifie');

    box.enqueue(op(2, { method: 'PATCH', path: '/leads/ly', body: { b: 1 } }));
    check('PATCH path différent -> pas de coalescing', box.size() === 2);

    // Op en vol verrouillée : un nouveau PATCH même path NE la modifie PAS.
    const boxB = createOutbox({ storage: makeStorage() });
    const inFlight = boxB.enqueue(op(3, { method: 'PATCH', path: '/leads/lz', body: { v: 1 } }));
    boxB.setLockedSeq(inFlight.seq);
    boxB.enqueue(op(3, { method: 'PATCH', path: '/leads/lz', body: { v: 2 } }));
    check('op verrouillée non coalescée (2 ops distinctes)', boxB.size() === 2);
    check('le body en vol reste intact', (boxB.head()?.body as { v: number }).v === 1);
  }

  section('Confirmation par seq = retrait + persistance');
  {
    const storage = makeStorage();
    const box = createOutbox({ storage });
    const a = box.enqueue(op(1));
    box.enqueue(op(2));
    box.confirm(a.seq);
    check('op confirmée retirée', box.size() === 1 && box.head()?.path === '/leads/l2');
    const persisted = JSON.parse(storage.getItem(OUTBOX_STORAGE_KEY)!);
    check('retrait persisté', persisted.ops.length === 1);
  }

  section('Échecs : transitoire (attempts++) puis failed au PLAFOND ; définitif immédiat');
  {
    const box = createOutbox({ storage: makeStorage() });
    const a = box.enqueue(op(1));
    let status = box.recordFailure(a.seq, 'réseau', { definitive: false, maxAttempts: 3 });
    check('échec 1/3 -> pending (re-tentable)', status === 'pending' && box.head()?.attempts === 1);
    status = box.recordFailure(a.seq, 'réseau', { definitive: false, maxAttempts: 3 });
    check('échec 2/3 -> pending', status === 'pending');
    status = box.recordFailure(a.seq, 'réseau', { definitive: false, maxAttempts: 3 });
    check('échec 3/3 -> FAILED (plafond atteint)', status === 'failed' && box.head()?.status === 'failed');
    check('lastError conservé', box.head()?.lastError === 'réseau');

    const b = box.enqueue(op(2));
    const st2 = box.recordFailure(b.seq, '400 payload invalide', { definitive: true, maxAttempts: 3 });
    check('échec DÉFINITIF (4xx) -> failed dès la 1re tentative', st2 === 'failed');
    check('l\'op failed RESTE en file (jamais retirée silencieusement)', box.size() === 2);
  }

  section('Retry manuel (failed -> pending, tentatives à zéro) + abandon explicite');
  {
    const box = createOutbox({ storage: makeStorage() });
    const a = box.enqueue(op(1));
    box.recordFailure(a.seq, 'boom', { definitive: true, maxAttempts: 3 });
    box.retryFailed(a.seq);
    check('retry manuel : pending, attempts remis à 0', box.head()?.status === 'pending' && box.head()?.attempts === 0);

    box.recordFailure(a.seq, 'boom', { definitive: true, maxAttempts: 3 });
    const removed = box.removeFailed(a.seq);
    check('abandon : op retirée et renvoyée (trace)', removed?.seq === a.seq && box.size() === 0);
    check('removeFailed refuse une op non-failed', box.removeFailed(999) === undefined);
  }

  section('Survie au rechargement : nouvelle instance, même storage');
  {
    const storage = makeStorage();
    const box1 = createOutbox({ storage });
    box1.enqueue(op(1));
    const b = box1.enqueue(op(2));
    box1.recordFailure(b.seq, 'réseau', { definitive: false, maxAttempts: 5 });

    const box2 = createOutbox({ storage }); // « rechargement d'onglet »
    check('file rechargée (2 ops)', box2.size() === 2);
    check('attempts/statuts préservés', box2.ops()[1].attempts === 1 && box2.ops()[1].status === 'pending');
    const c = box2.enqueue(op(3));
    check('seq poursuivi après rechargement (jamais réutilisé)', c.seq > b.seq);
  }

  section('Cap : refus BRUYANT au-delà (jamais de perte silencieuse)');
  {
    const box = createOutbox({ storage: makeStorage(), cap: 3 });
    box.enqueue(op(1)); box.enqueue(op(2)); box.enqueue(op(3));
    let threw = false;
    try { box.enqueue(op(4)); } catch (e) { threw = e instanceof OutboxFullError; }
    check('enqueue au-delà du cap -> OutboxFullError', threw);
    check('la file n\'a pas bougé', box.size() === 3);
  }

  section('onChange notifié à chaque changement (pilotera le badge UI)');
  {
    let calls = 0;
    const box = createOutbox({ storage: makeStorage(), onChange: () => { calls++; } });
    const a = box.enqueue(op(1));
    box.recordFailure(a.seq, 'x', { definitive: false, maxAttempts: 5 });
    box.confirm(a.seq);
    check('3 changements -> 3 notifications', calls === 3, `=${calls}`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais outbox : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  console.log(failed === 0 ? 'Tous les invariants tiennent. ✅' : 'ÉCHECS détectés. ❌');
  if (failed > 0) process.exit(1);
}

main();
