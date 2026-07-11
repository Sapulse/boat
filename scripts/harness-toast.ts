/**
 * Harnais du reducer de toasts (lot confort de navigation, B3).
 *
 * Execution : npx tsx scripts/harness-toast.ts
 * (hors tsc -b et hors bundle Vite : ce fichier n'est importe par aucun fichier
 * de l'app et scripts/ n'est dans aucun tsconfig.)
 *
 * Couvre les invariants du coeur PUR (src/context/toastReducer.ts) :
 *  - PUSH empile en fin (le plus recent en bas de pile) ;
 *  - plafond TOAST_LIMIT : au-dela, les plus ANCIENS sortent ;
 *  - dedoublonnage kind+message : re-push remplace (remonte en fin, nouvel id),
 *    jamais deux toasts identiques a l'ecran ;
 *  - meme message mais kind different = deux toasts distincts ;
 *  - DISMISS ne retire QUE la cible ; id inconnu -> MEME reference (pas de
 *    re-render) — c'est le contrat du timer orphelin apres remplacement ;
 *  - purete : l'etat d'entree n'est jamais mute ;
 *  - durees : une erreur reste affichee plus longtemps qu'une confirmation.
 */

import { toastReducer, toastDuration, TOAST_LIMIT } from '../src/context/toastReducer';
import type { Toast, ToastKind } from '../src/context/toastReducer';

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

function makeToast(id: string, message: string, kind: ToastKind = 'success'): Toast {
  return { id, kind, message };
}

function push(state: Toast[], toast: Toast): Toast[] {
  return toastReducer(state, { type: 'PUSH', toast });
}

function dismiss(state: Toast[], id: string): Toast[] {
  return toastReducer(state, { type: 'DISMISS', id });
}

// ---------------------------------------------------------------------------
section('PUSH : empilement ordonné');

let s: Toast[] = [];
s = push(s, makeToast('t1', 'Lead créé'));
s = push(s, makeToast('t2', 'Action ajoutée'));
check('2 push -> 2 toasts', s.length === 2);
check('ordre chronologique (le plus récent en fin)', s[0].id === 't1' && s[1].id === 't2');

// ---------------------------------------------------------------------------
section(`Plafond TOAST_LIMIT (${TOAST_LIMIT}) : les plus anciens sortent`);

s = [];
for (let i = 1; i <= TOAST_LIMIT + 2; i++) {
  s = push(s, makeToast(`t${i}`, `Message ${i}`));
}
check(`jamais plus de ${TOAST_LIMIT} toasts`, s.length === TOAST_LIMIT);
check('les plus anciens sont sortis', !s.some(t => t.id === 't1') && !s.some(t => t.id === 't2'));
check('les plus récents sont conservés, ordre préservé',
  s.map(t => t.id).join(',') === `t3,t4,t5`,
  `obtenu : ${s.map(t => t.id).join(',')}`);

// ---------------------------------------------------------------------------
section('Dédoublonnage kind+message : re-push remplace au lieu d\'empiler');

s = [];
s = push(s, makeToast('t1', 'Action ajoutée'));
s = push(s, makeToast('t2', 'Lead mis à jour'));
s = push(s, makeToast('t3', 'Action ajoutée'));
check('pas de doublon à l\'écran', s.filter(t => t.message === 'Action ajoutée').length === 1);
check('le doublon a pris le NOUVEL id (nouveau timer)', s.some(t => t.id === 't3') && !s.some(t => t.id === 't1'));
check('le doublon est remonté en fin de pile (le plus récent)', s[s.length - 1].id === 't3');
check('les autres toasts sont intacts', s.some(t => t.id === 't2') && s.length === 2);

const sameMsgOtherKind = push(s, makeToast('t4', 'Action ajoutée', 'error'));
check('même message mais kind différent = toast distinct',
  sameMsgOtherKind.filter(t => t.message === 'Action ajoutée').length === 2);

// ---------------------------------------------------------------------------
section('DISMISS : retrait ciblé, no-op sur id inconnu');

s = [];
s = push(s, makeToast('t1', 'Un'));
s = push(s, makeToast('t2', 'Deux'));
s = push(s, makeToast('t3', 'Trois'));
const afterDismiss = dismiss(s, 't2');
check('seule la cible est retirée', afterDismiss.length === 2 && !afterDismiss.some(t => t.id === 't2'));
check('l\'ordre des autres est préservé', afterDismiss[0].id === 't1' && afterDismiss[1].id === 't3');

const afterUnknown = dismiss(s, 'toast-fantome');
check('id inconnu (timer orphelin) -> MÊME référence, pas de re-render', afterUnknown === s);

// ---------------------------------------------------------------------------
section('Pureté : l\'état d\'entrée n\'est jamais muté');

const frozen: Toast[] = Object.freeze([
  makeToast('t1', 'Un'),
  makeToast('t2', 'Deux'),
]) as Toast[];
let threw = false;
try {
  push(frozen, makeToast('t3', 'Trois'));
  dismiss(frozen, 't1');
  dismiss(frozen, 'inconnu');
} catch {
  threw = true;
}
check('PUSH/DISMISS sur un état gelé ne jettent pas (aucune mutation)', !threw);
check('l\'état gelé est inchangé', frozen.length === 2 && frozen[0].id === 't1');

// ---------------------------------------------------------------------------
section('Durées d\'affichage');

check('une erreur reste plus longtemps qu\'une confirmation', toastDuration('error') > toastDuration('success'));
check('success et info partagent la durée courte', toastDuration('success') === toastDuration('info'));
check('durées strictement positives', toastDuration('error') > 0 && toastDuration('success') > 0);

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`Harnais toast : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  console.error('Des invariants sont violés. ❌');
  process.exit(1);
}
console.log('Tous les invariants tiennent. ✅');
