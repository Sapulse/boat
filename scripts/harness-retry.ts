/**
 * Harnais retryWithBackoff (lot robustesse 2.1 — hydratation auto-réparante).
 *
 * Exécution : npx tsx scripts/harness-retry.ts
 *
 * Couvre le helper PUR src/lib/retry.ts (sleep injecté -> déterministe) :
 *  - succès immédiat (aucun sleep) ;
 *  - succès après N échecs (délais consommés dans l'ordre) ;
 *  - échec de TOUS les essais -> relance la dernière erreur, délais respectés ;
 *  - nombre de tentatives = delays.length + 1.
 */
import { retryWithBackoff } from '../src/lib/retry';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

// sleep instantané qui ENREGISTRE les délais demandés (pas d'attente réelle).
function fakeSleep() {
  const delays: number[] = [];
  return { fn: (ms: number) => { delays.push(ms); return Promise.resolve(); }, delays };
}

async function main() {
  section('Succès immédiat -> aucune reprise');
  {
    const s = fakeSleep();
    let calls = 0;
    const r = await retryWithBackoff(async () => { calls++; return 'ok'; }, [10, 20, 30], s.fn);
    check('renvoie la valeur', r === 'ok');
    check('1 seul appel, 0 sleep', calls === 1 && s.delays.length === 0);
  }

  section('Succès au 2e essai -> 1 reprise (1er délai consommé)');
  {
    const s = fakeSleep();
    let calls = 0;
    const r = await retryWithBackoff(async () => { calls++; if (calls < 2) throw new Error('boom'); return 42; }, [10, 20, 30], s.fn);
    check('renvoie la valeur après reprise', r === 42);
    check('2 appels, 1 sleep = premier délai', calls === 2 && s.delays.length === 1 && s.delays[0] === 10);
  }

  section('Tous les essais échouent -> relance la DERNIÈRE erreur');
  {
    const s = fakeSleep();
    let calls = 0;
    let caught: Error | null = null;
    try {
      await retryWithBackoff(async () => { calls++; throw new Error(`échec ${calls}`); }, [10, 20, 30], s.fn);
    } catch (e) { caught = e as Error; }
    check('rejette après épuisement', caught !== null);
    check('tentatives = delays.length + 1 (=4)', calls === 4);
    check('sleeps = delays.length (=3), dans l\'ordre', s.delays.length === 3 && s.delays.join(',') === '10,20,30');
    check('erreur relancée = la DERNIÈRE', caught?.message === 'échec 4', caught?.message);
  }

  section('Liste de délais vide -> 1 seule tentative, pas de reprise');
  {
    const s = fakeSleep();
    let calls = 0;
    let caught = false;
    try { await retryWithBackoff(async () => { calls++; throw new Error('x'); }, [], s.fn); }
    catch { caught = true; }
    check('1 tentative, 0 sleep, rejette', calls === 1 && s.delays.length === 0 && caught);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais retry : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exitCode = 1;
  else console.log('Tous les invariants tiennent. ✅');
}

main();
