/**
 * Harnais de la garde de re-hydratation (correctif audit #3, v2).
 *
 * Exécution : npx tsx scripts/harness-refresh-guard.ts
 *
 * Prouve la fonction PURE src/lib/refreshGuard.ts : la re-hydratation SAUTE
 * en contexte de saisie (modale ouverte OU champ éditable focalisé) -> ce que
 * l'utilisateur tape n'est jamais écrasé par un réalignement serveur.
 */
import { isEditing } from '../src/lib/refreshGuard';

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

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais refresh-guard : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exitCode = 1;
  else console.log('Tous les invariants tiennent. ✅');
}

main();
