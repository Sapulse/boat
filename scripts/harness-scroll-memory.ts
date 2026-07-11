/**
 * Harnais du store de restauration de scroll (lot frictions UX, A2).
 *
 * Execution : npx tsx scripts/harness-scroll-memory.ts
 * (hors tsc -b et hors bundle Vite : ce fichier n'est importe par aucun fichier
 * de l'app et scripts/ n'est dans aucun tsconfig.)
 *
 * Couvre les invariants du coeur PUR (src/lib/scrollMemory.ts) :
 *  - cle inconnue -> 0 (page jamais visitee = EN HAUT) ;
 *  - save/restore par cle, y compris la position 0 explicite ;
 *  - re-save ecrase ET rajeunit la cle (pas evincee en premier) ;
 *  - plafond : au-dela de la limite, la cle la moins recemment SAUVEGARDEE sort.
 */

import { createScrollMemory } from '../src/lib/scrollMemory';

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
section('Base : save / restore / clé inconnue');

{
  const m = createScrollMemory();
  check('clé inconnue -> 0 (page neuve en haut)', m.restore('/leads') === 0);
  m.save('/leads', 540);
  check('position restaurée', m.restore('/leads') === 540);
  check('autre clé toujours 0', m.restore('/pipeline') === 0);
  m.save('/leads', 0);
  check('position 0 explicite sauvegardée (retour en haut volontaire)', m.restore('/leads') === 0);
}

// ---------------------------------------------------------------------------
section('Écrasement : la dernière sauvegarde gagne');

{
  const m = createScrollMemory();
  m.save('/leads', 100);
  m.save('/leads', 875);
  check('dernière valeur restaurée', m.restore('/leads') === 875);
  check('une seule entrée pour la clé', m.size() === 1);
}

// ---------------------------------------------------------------------------
section('Plafond : éviction de la clé la moins récemment sauvegardée');

{
  const m = createScrollMemory(3);
  m.save('/a', 1);
  m.save('/b', 2);
  m.save('/c', 3);
  m.save('/d', 4); // dépasse la limite -> '/a' (la plus ancienne) sort
  check('taille bornée à 3', m.size() === 3);
  check("'/a' évincée -> 0", m.restore('/a') === 0);
  check("'/b', '/c', '/d' conservées", m.restore('/b') === 2 && m.restore('/c') === 3 && m.restore('/d') === 4);
}

// ---------------------------------------------------------------------------
section('Rajeunissement : re-save protège de l\'éviction');

{
  const m = createScrollMemory(3);
  m.save('/a', 1);
  m.save('/b', 2);
  m.save('/c', 3);
  m.save('/a', 11); // '/a' redevient la plus récente
  m.save('/d', 4);  // l'éviction doit sortir '/b' (désormais la plus ancienne)
  check("'/a' rajeunie conservée (11)", m.restore('/a') === 11);
  check("'/b' évincée -> 0", m.restore('/b') === 0);
  check('taille toujours bornée', m.size() === 3);
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`Harnais scroll-memory : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  console.error('Des invariants sont violés. ❌');
  process.exit(1);
}
console.log('Tous les invariants tiennent. ✅');
