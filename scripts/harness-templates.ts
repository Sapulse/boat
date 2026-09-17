/**
 * Harnais modeles de message (retour terrain BOB, 2026-09).
 *
 * Execution : npx tsx scripts/harness-templates.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre `templatePreview` (lib/templates). Le tri « dernier cree en premier »
 * (1cd4bbf) est remplace au lot 3 par l'ordre manuel par categorie
 * (lib/templateLayout, scripts/harness-template-layout.ts).
 */

import { templatePreview } from '../src/lib/templates';
import type { MessageTemplate } from '../src/data/types';

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

function tpl(id: string, createdAt?: string): MessageTemplate {
  return { id, type: 'email', title: id, subject: '', body: '', createdAt };
}

// L'ORDRE des modeles (lot 3 : categories + ordre manuel, depart « plus recent
// d'abord ») est couvert par scripts/harness-template-layout.ts.

section("Apercu d'un modele replie");
{
  const email = { ...tpl('e'), subject: '  Votre projet bateau  ', body: 'Bonjour\nBonjour encore' };
  check('email : le SUJET (rogne)', templatePreview(email) === 'Votre projet bateau', templatePreview(email));

  const noSubject = { ...tpl('e2'), subject: '   ', body: 'Bonjour {{prenom}},\n\nSuite a votre demande' };
  check('email sans sujet -> repli sur le corps, aplati sur une ligne',
    templatePreview(noSubject) === 'Bonjour {{prenom}}, Suite a votre demande', templatePreview(noSubject));

  const sms: MessageTemplate = { ...tpl('s'), type: 'sms', subject: '', body: 'Coucou\t{{prenom}}' };
  check('sms : le corps (pas de sujet)', templatePreview(sms) === 'Coucou {{prenom}}', templatePreview(sms));

  check('modele vide -> chaine vide (aucun blanc affiche)',
    templatePreview({ ...tpl('v'), subject: '', body: '' }) === '');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais modeles : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
