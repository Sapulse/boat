/**
 * Harnais buildYearRange (lot fix/dates-horizon).
 *
 * Execution : npx tsx scripts/harness-dates.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre la fonction pure de generation de plage d'annees (selecteurs d'annee) :
 *  - borne basse = current - back, borne haute = current + forward (incluses) ;
 *  - longueur = back + forward + 1, strictement croissante, sans trou ;
 *  - l'annee courante injectee est toujours dans la plage ;
 *  - amplitude par defaut (constants) = large vers le futur (>= +50) -> aucune
 *    saisie future plafonnee ;
 *  - horizon RELATIF : pour current = current+1 la plage glisse d'exactement 1 an
 *    (aucune annee codee en dur).
 */

import { buildYearRange } from '../src/lib/utils';
import { YEAR_RANGE_BACK, YEAR_RANGE_FORWARD } from '../src/data/constants';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n— ${title}`);
}

section('Bornes relatives a `current` injecte');
{
  const r = buildYearRange(5, 50, 2026);
  check('borne basse = current - back', r[0] === 2021, `got ${r[0]}`);
  check('borne haute = current + forward', r[r.length - 1] === 2076, `got ${r[r.length - 1]}`);
  check('longueur = back + forward + 1', r.length === 56, `got ${r.length}`);
  check('annee courante presente', r.includes(2026));
  check('strictement croissante, sans trou',
    r.every((y, i) => i === 0 || y === r[i - 1] + 1));
}

section('Horizon glissant (aucune annee en dur)');
{
  const a = buildYearRange(5, 50, 2026);
  const b = buildYearRange(5, 50, 2027);
  check('+1 an sur current -> plage decalee de +1 (basse)', b[0] === a[0] + 1);
  check('+1 an sur current -> plage decalee de +1 (haute)',
    b[b.length - 1] === a[a.length - 1] + 1);
  check('plafond futur recule chaque annee', b[b.length - 1] === 2077);
}

section('Amplitudes variees');
{
  check('back=0/forward=0 -> [current] seul', JSON.stringify(buildYearRange(0, 0, 2030)) === '[2030]');
  const r = buildYearRange(2, 3, 2000);
  check('back=2/forward=3 -> 2 ans avant inclus', r[0] === 1998);
  check('back=2/forward=3 -> 3 ans apres inclus', r[r.length - 1] === 2003);
}

section('Defauts (constants) — horizon large vers le futur');
{
  const def = buildYearRange(undefined, undefined, 2026);
  check('back par defaut applique', def[0] === 2026 - YEAR_RANGE_BACK);
  check('forward par defaut applique', def[def.length - 1] === 2026 + YEAR_RANGE_FORWARD);
  check('futur large (forward >= 50) -> jamais de plafond de saisie', YEAR_RANGE_FORWARD >= 50);
}

// ---------------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais dates : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
