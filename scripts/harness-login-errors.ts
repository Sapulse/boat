/**
 * Harnais du mapping des erreurs de connexion (lot frictions UX, B4).
 *
 * Execution : npx tsx scripts/harness-login-errors.ts
 * (hors tsc -b et hors bundle Vite : ce fichier n'est importe par aucun fichier
 * de l'app et scripts/ n'est dans aucun tsconfig.)
 *
 * Couvre le coeur PUR (src/lib/loginErrors.ts) :
 *  - 401 -> "Mot de passe incorrect." (la cause probable, sans jargon HTTP) ;
 *  - autres statuts HTTP (4xx/5xx) -> message "serveur", ton rassurant ;
 *  - echec sans reponse HTTP (fetch rejette : reseau coupe, timeout) ->
 *    message "verifiez votre connexion" ;
 *  - aucun message technique brut ("Failed to fetch", "HTTP 500") ne fuit.
 */

import { LoginError, loginErrorMessage } from '../src/lib/loginErrors';

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

// ---------------------------------------------------------------------------
section('401 — mot de passe incorrect');
{
  const msg = loginErrorMessage(new LoginError(401, 'Identifiants invalides'));
  console.log(`    « ${msg} »`);
  check('message dedie', msg === 'Mot de passe incorrect.');
}

// ---------------------------------------------------------------------------
section('Erreurs serveur (autres statuts HTTP)');
{
  for (const status of [400, 500, 502, 503]) {
    const msg = loginErrorMessage(new LoginError(status, `Connexion refusée (${status})`));
    check(`${status} -> message serveur rassurant`, msg === 'Le serveur ne répond pas correctement — réessayez dans un instant.', `=${msg}`);
  }
}

// ---------------------------------------------------------------------------
section('Échec réseau (fetch rejette, pas de réponse HTTP)');
{
  const cases: [string, unknown][] = [
    ['TypeError Failed to fetch', new TypeError('Failed to fetch')],
    ['AbortError (timeout)', new DOMException('The operation was aborted', 'AbortError')],
    ['erreur inattendue', new Error('boom')],
  ];
  for (const [label, err] of cases) {
    const msg = loginErrorMessage(err);
    check(`${label} -> message connexion`, msg === 'Connexion impossible — vérifiez votre connexion internet.', `=${msg}`);
  }
}

// ---------------------------------------------------------------------------
section('Aucune fuite de message technique');
{
  const all = [
    loginErrorMessage(new LoginError(401, 'Identifiants invalides')),
    loginErrorMessage(new LoginError(500, 'Connexion refusée (500)')),
    loginErrorMessage(new TypeError('Failed to fetch')),
  ];
  check('pas de "HTTP", "fetch", ni code de statut a l\'ecran',
    all.every(m => !/HTTP|fetch|[45]\d\d/i.test(m)), all.join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`Harnais login-errors : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  console.error('Des invariants sont violés. ❌');
  process.exit(1);
}
console.log('Tous les invariants tiennent. ✅');
