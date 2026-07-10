/**
 * Harnais du verrou anti-double-soumission (correctif audit #2).
 *
 * Exécution : npx tsx scripts/harness-submit-guard.ts
 *
 * Prouve le cœur PUR src/lib/submitGuard.ts : un 2e appel (double-clic) est
 * IGNORÉ tant que le 1er n'est pas relâché -> une création = UNE entité.
 */
import { createSubmitGuard } from '../src/lib/submitGuard';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

async function main() {
  section('Synchrone : double-clic -> UNE seule exécution');
  {
    let runs = 0, locks = 0, unlocks = 0;
    const pending: Array<() => void> = [];
    const g = createSubmitGuard(v => { if (v) locks++; else unlocks++; });
    const schedule = (open: () => void) => { pending.push(open); }; // relâche différé manuel

    const ok1 = g.run(() => { runs++; }, schedule);      // 1er clic
    const ok2 = g.run(() => { runs++; }, schedule);      // 2e clic (verrouillé)
    check('1er clic exécuté (true)', ok1 === true);
    check('2e clic IGNORÉ (false)', ok2 === false);
    check('fn exécutée UNE seule fois', runs === 1);
    check('verrou posé une fois', locks === 1);
    check('toujours verrouillé (pas encore relâché)', g.isBusy() === true);

    pending.forEach(o => o());                            // fin de la fenêtre anti-double-clic
    check('relâché -> plus verrouillé', g.isBusy() === false && unlocks === 1);

    const ok3 = g.run(() => { runs++; }, schedule);      // clic ultérieur légitime
    check('clic ultérieur autorisé', ok3 === true && runs === 2);
  }

  section('Asynchrone : relâché au règlement de la promesse');
  {
    let runs = 0;
    let resolveFn!: () => void;
    const g = createSubmitGuard();
    const p = new Promise<void>(res => { resolveFn = res; });
    const ok1 = g.run(() => { runs++; return p; }, () => {});
    const ok2 = g.run(() => { runs++; return p; }, () => {}); // bloqué pendant l'async
    check('1er appel exécuté', ok1 === true && runs === 1);
    check('2e appel bloqué pendant l\'async', ok2 === false && runs === 1);
    check('verrouillé tant que la promesse pend', g.isBusy() === true);
    resolveFn();
    await Promise.resolve(); await Promise.resolve();
    check('promesse réglée -> relâché', g.isBusy() === false);
  }

  section('fn qui jette : le verrou est relâché (pas de blocage définitif)');
  {
    const g = createSubmitGuard();
    let threw = false;
    try { g.run(() => { throw new Error('boom'); }, () => {}); } catch { threw = true; }
    check('l\'erreur est propagée', threw === true);
    check('verrou relâché malgré l\'erreur', g.isBusy() === false);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais submit-guard : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exitCode = 1;
  else console.log('Tous les invariants tiennent. ✅');
}

main();
