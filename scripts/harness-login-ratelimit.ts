/**
 * Harnais du cœur pur du rate-limit login (durcissement auth, commit 2).
 *
 * Execution : npx tsx scripts/harness-login-ratelimit.ts
 * (hors tsc -b et hors bundle Vite : importe par aucun fichier de l'app.)
 *
 * Couvre api/_lib/loginRateLimit.ts (PUR — l'upsert atomique en base est
 * couvert separement par le test d'integrite sur base jetable) :
 *  - extraction de l'IP (x-forwarded-for multi-proxy, x-real-ip, repli) ;
 *  - fenetrage fixe (bucket monotone, meme bucket dans la fenetre, bucket
 *    suivant a la tranche d'apres) ;
 *  - decision de blocage au (MAX+1)e essai.
 */

import {
  clientIp, windowBucket, windowStartSec, attemptKey, isRateLimited,
  RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC,
} from '../api/_lib/loginRateLimit';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

// ---------------------------------------------------------------------------
section('Extraction IP');
{
  check('x-forwarded-for simple', clientIp({ 'x-forwarded-for': '203.0.113.7' }) === '203.0.113.7');
  check('x-forwarded-for multi-proxy -> 1er (client réel)',
    clientIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }) === '203.0.113.7');
  check('en-tête tableau -> 1er élément', clientIp({ 'x-forwarded-for': ['198.51.100.9', 'x'] }) === '198.51.100.9');
  check('repli sur x-real-ip', clientIp({ 'x-real-ip': '192.0.2.5' }) === '192.0.2.5');
  check('aucun en-tête -> "unknown" (rate-limit s\'applique quand même)', clientIp({}) === 'unknown');
}

// ---------------------------------------------------------------------------
section('Fenêtrage fixe');
{
  const w = RATE_LIMIT_WINDOW_SEC;
  const b0 = windowBucket(1_000_000_000, w);
  const start = windowStartSec(b0, w); // instant ALIGNÉ sur le début de la tranche
  check('début de tranche -> bucket b0', windowBucket(start, w) === b0);
  check('début + (fenêtre-1)s -> même bucket', windowBucket(start + w - 1, w) === b0);
  check('début + fenêtre s -> bucket suivant', windowBucket(start + w, w) === b0 + 1);
  check('instant NON aligné (mi-tranche) reste dans b0', windowBucket(start + 100, w) === b0);
  check('windowStart aligné sur la tranche', start === b0 * w);
  check('clé distincte par IP', attemptKey('1.1.1.1', b0) !== attemptKey('2.2.2.2', b0));
  check('clé distincte par fenêtre', attemptKey('1.1.1.1', b0) !== attemptKey('1.1.1.1', b0 + 1));
}

// ---------------------------------------------------------------------------
section('Décision de blocage (compteur post-incrément)');
{
  // MAX = 5 : essais 1..5 passent, le 6e (count=6) est bloqué.
  for (let c = 1; c <= RATE_LIMIT_MAX; c++) {
    check(`essai ${c}/${RATE_LIMIT_MAX} autorisé`, !isRateLimited(c));
  }
  check(`essai ${RATE_LIMIT_MAX + 1} bloqué (429)`, isRateLimited(RATE_LIMIT_MAX + 1));
  check('reste bloqué au-delà', isRateLimited(RATE_LIMIT_MAX + 50));
  check('seuil custom respecté', isRateLimited(3, 2) && !isRateLimited(2, 2));
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`Harnais login-ratelimit : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) { console.error('Des invariants sont violés. ❌'); process.exit(1); }
console.log('Tous les invariants tiennent. ✅');
