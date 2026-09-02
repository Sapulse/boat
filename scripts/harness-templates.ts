/**
 * Harnais modeles de message (retour terrain BOB, 2026-09).
 *
 * Execution : npx tsx scripts/harness-templates.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre `sortTemplatesByNewest` (lib/templates) — l'ordre d'affichage de la
 * page Modeles : DERNIER CREE en premier. L'enjeu est l'ordre TOTAL : la page
 * melange des modeles dates (venus de la base, colonne d'audit exposee) et des
 * modeles SANS date (defauts localStorage, states d'avant ce lot). Un tri qui
 * bascule d'un rendu a l'autre serait pire que l'ordre d'origine.
 */

import { sortTemplatesByNewest } from '../src/lib/templates';
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
const ids = (list: MessageTemplate[]) => list.map(t => t.id).join(',');

// ---------------------------------------------------------------------------
section('Tri par date de creation — le plus recent en tete');
{
  const list = [
    tpl('a', '2026-01-10T09:00:00.000Z'),
    tpl('c', '2026-08-30T18:30:00.000Z'),
    tpl('b', '2026-05-02T12:00:00.000Z'),
  ];
  check('ordre decroissant', ids(sortTemplatesByNewest(list)) === 'c,b,a', ids(sortTemplatesByNewest(list)));
  check('entree NON mutee', ids(list) === 'a,c,b', ids(list));
  check('meme longueur (aucun modele perdu)', sortTemplatesByNewest(list).length === 3);
}

section('Modeles SANS date (defauts localStorage / state d\'avant le lot)');
{
  const list = [tpl('contact'), tpl('relance'), tpl('suivi')];
  // Aucune date nulle part : il ne reste que l'ordre d'insertion, INVERSE.
  check('sans aucune date -> insertion inversee', ids(sortTemplatesByNewest(list)) === 'suivi,relance,contact',
    ids(sortTemplatesByNewest(list)));
}
{
  // LE cas reel : les 3 defauts (sans date) + un modele cree ensuite.
  const list = [tpl('contact'), tpl('relance'), tpl('suivi'), tpl('neuf', '2026-09-01T10:00:00.000Z')];
  const out = sortTemplatesByNewest(list);
  check('le date passe DEVANT tous les sans-date', out[0].id === 'neuf', ids(out));
  check('les sans-date ferment la liste, insertion inversee', ids(out) === 'neuf,suivi,relance,contact', ids(out));
}

section('Ordre TOTAL : deterministe, jamais deux rendus differents');
{
  // Deux modeles a la MEME date (creation en rafale, ou re-datage par un restore).
  const same = '2026-07-30T08:00:00.000Z';
  const list = [tpl('x', same), tpl('y', same), tpl('z', '2026-07-29T08:00:00.000Z')];
  check('date egale -> insertion inversee (y avant x)', ids(sortTemplatesByNewest(list)) === 'y,x,z',
    ids(sortTemplatesByNewest(list)));
  // LA propriete dont depend le rendu : deux appels sur le MEME state donnent le
  // meme ordre. La page ne fait jamais rien d'autre (un useMemo sur state.templates).
  check('deterministe : deux appels sur le meme state -> meme ordre',
    ids(sortTemplatesByNewest(list)) === ids(sortTemplatesByNewest(list)));
  // Arete ASSUMEE et documentee (lib/templates) : le departage lit l'ordre
  // d'INSERTION, qui n'existe plus dans une liste deja triee. On la fige ici
  // pour qu'un futur appel en cascade se voie tout de suite.
  check('NON idempotent a date egale : ne jamais retrier une sortie',
    ids(sortTemplatesByNewest(sortTemplatesByNewest(list))) === 'x,y,z',
    ids(sortTemplatesByNewest(sortTemplatesByNewest(list))));
}
{
  check('liste vide -> liste vide', sortTemplatesByNewest([]).length === 0);
  check('un seul modele -> inchange', ids(sortTemplatesByNewest([tpl('seul')])) === 'seul');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais modeles : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
