/**
 * Harnais de la garde de re-hydratation (correctif audit #3, v2).
 *
 * Exécution : npx tsx scripts/harness-refresh-guard.ts
 *
 * Prouve la fonction PURE src/lib/refreshGuard.ts : la re-hydratation SAUTE
 * en contexte de saisie (modale ouverte OU champ éditable focalisé) -> ce que
 * l'utilisateur tape n'est jamais écrasé par un réalignement serveur.
 */
import { isEditing, shouldRefreshNow } from '../src/lib/refreshGuard';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

function main() {
  section('SAUTE en saisie : modale ouverte -> toujours editing (formulaires en modale)');
  check('modale ouverte, aucun focus -> true', isEditing(null, true) === true);
  check('modale ouverte + focus body -> true', isEditing({ tagName: 'BODY' }, true) === true);

  section('SAUTE en saisie : champ éditable focalisé (hors modale)');
  check('INPUT focalisé -> true', isEditing({ tagName: 'INPUT' }, false) === true);
  check('TEXTAREA focalisé -> true', isEditing({ tagName: 'TEXTAREA' }, false) === true);
  check('SELECT focalisé -> true', isEditing({ tagName: 'SELECT' }, false) === true);
  check('contentEditable focalisé -> true', isEditing({ tagName: 'DIV', isContentEditable: true }, false) === true);

  section('AUTORISE le refresh : aucune saisie active');
  check('aucun élément actif -> false', isEditing(null, false) === false);
  check('activeElement = BODY -> false', isEditing({ tagName: 'BODY' }, false) === false);
  check('bouton focalisé (BUTTON) -> false', isEditing({ tagName: 'BUTTON' }, false) === false);
  check('lien focalisé (A) -> false', isEditing({ tagName: 'A' }, false) === false);
  check('DIV non éditable focalisé -> false', isEditing({ tagName: 'DIV', isContentEditable: false }, false) === false);
  check('activeElement undefined -> false', isEditing(undefined, false) === false);

  section('shouldRefreshNow (POLLING) : visible + pas de saisie + espacement min');
  const SP = 3000; // min-spacing (comme AppContext)
  const base = { visible: true, editing: false, now: 100000, lastRun: 0, minSpacingMs: SP };
  check('visible + pas de saisie + espacé -> true', shouldRefreshNow(base) === true);
  check('onglet caché -> false (pause arrière-plan)', shouldRefreshNow({ ...base, visible: false }) === false);
  check('saisie active -> false (frappe protégée)', shouldRefreshNow({ ...base, editing: true }) === false);

  section('shouldRefreshNow : espacement minimal (déduplique focus+poll)');
  check('dans le min-spacing (2999 ms) -> false', shouldRefreshNow({ ...base, now: 2999, lastRun: 0 }) === false);
  check('pile au min-spacing (3000 ms) -> true', shouldRefreshNow({ ...base, now: 3000, lastRun: 0 }) === true);
  check('poll 5 s passe le min-spacing 3 s -> true', shouldRefreshNow({ ...base, now: 5000, lastRun: 0 }) === true);
  check('focus 1 s après un poll -> false (pas de double)', shouldRefreshNow({ ...base, now: 6000, lastRun: 5000 }) === false);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais refresh-guard : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exitCode = 1;
  else console.log('Tous les invariants tiennent. ✅');
}

main();
