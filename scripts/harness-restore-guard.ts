/**
 * Harnais du garde-fou de RESTAURATION (src/lib/restoreGuard.ts).
 *
 * Exécution : npx tsx scripts/harness-restore-guard.ts
 *
 * Cœur PUR, aucune base : on prouve la logique qui décide de la friction.
 * Le cas qui compte : deux bases de MÊME TAILLE mais aux ids disjoints. Un
 * garde-fou qui compare des nombres dirait « 300 -> 300, rien à perdre » alors
 * que la restauration efface 300 leads réels.
 */
import type { AppState, Lead } from '../src/data/types';
import {
  restorePreview, formatAge, STALE_DAYS, CONFIRM_WORD_SAFE,
} from '../src/lib/restoreGuard';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const lead = (id: string): Lead => ({
  id, createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
  firstName: 'X', lastName: 'Y', phone: '', email: '', boatType: 'Moteur',
  boatCondition: 'Neuf', boatInterest: '', brand: '', budget: null,
  status: 'contacte', contactDate: '', quoteAmount: null, probability: null,
  currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
  priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '',
  lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
} as Lead);

const state = (ids: string[]): AppState => ({
  leads: ids.map(lead), actions: [], commercials: [], monthlyStats: [],
  templates: [], calendarEvents: [], goals: [],
  defaultGoal: {
    prospectsCreated: null, coldCalls: null, followups: null,
    meetings: null, revenue: null, conversionRate: null,
  },
});

const NOW = new Date('2026-07-30T12:00:00Z');

section('Comparaison PAR ID, pas par nombre');
{
  // 3 leads d'un côté, 3 de l'autre, AUCUN en commun : le piège des comptes.
  const p = restorePreview(state(['a', 'b', 'c']), state(['x', 'y', 'z']), NOW.toISOString(), NOW);
  check('même nombre mais ids disjoints -> 3 leads réellement supprimés', p.leadsRemoved === 3, `removed=${p.leadsRemoved}`);
  check('3 leads ajoutés', p.leadsAdded === 3);
  check('0 conservé', p.leadsKept === 0);
  check('classé DESTRUCTIF malgré 3 -> 3', p.destructive);
}

section('Recouvrement partiel');
{
  const p = restorePreview(state(['a', 'b', 'c', 'd']), state(['c', 'd', 'e']), NOW.toISOString(), NOW);
  check('2 supprimés (a, b)', p.leadsRemoved === 2, `removed=${p.leadsRemoved}`);
  check('1 ajouté (e)', p.leadsAdded === 1);
  check('2 conservés (c, d)', p.leadsKept === 2);
  check('supprimés + conservés = base actuelle', p.leadsRemoved + p.leadsKept === 4);
}

section('Restauration NON destructive (le fichier est un sur-ensemble)');
{
  const p = restorePreview(state(['a', 'b']), state(['a', 'b', 'c']), NOW.toISOString(), NOW);
  check('aucun lead supprimé', p.leadsRemoved === 0);
  check('non destructif', !p.destructive);
  check(`mot à taper = ${CONFIRM_WORD_SAFE}`, p.confirmWord === CONFIRM_WORD_SAFE, p.confirmWord);
}

section('Escalade de la confirmation quand des leads disparaissent');
{
  const p = restorePreview(state(['a', 'b', 'c']), state(['a']), NOW.toISOString(), NOW);
  check('mot à taper = le NOMBRE de leads perdus', p.confirmWord === '2', p.confirmWord);
  check("l'étiquette annonce le nombre", p.confirmHint.includes('2'), p.confirmHint);
  check('le mot n\'est PAS le mot générique', p.confirmWord !== CONFIRM_WORD_SAFE);
}

section('Base vide, fichier vide : cas limites');
{
  const p1 = restorePreview(state([]), state(['a']), NOW.toISOString(), NOW);
  check('base vide -> rien à perdre, non destructif', !p1.destructive && p1.leadsRemoved === 0);

  const p2 = restorePreview(state(['a', 'b']), state([]), NOW.toISOString(), NOW);
  check('fichier VIDE sur base peuplée -> destructif, 2 perdus', p2.destructive && p2.leadsRemoved === 2);
  check('fichier vide -> il faut taper « 2 »', p2.confirmWord === '2');

  const p3 = restorePreview(state([]), state([]), NOW.toISOString(), NOW);
  check('les deux vides -> non destructif', !p3.destructive);
}

section('Âge du fichier');
{
  const same = restorePreview(state([]), state([]), NOW.toISOString(), NOW);
  check("exporté à l'instant -> 0 jour, pas ancien", same.ageDays === 0 && !same.stale);

  const old = restorePreview(state([]), state([]), '2026-07-11T12:00:00Z', NOW);
  check('exporté 19 jours avant -> ageDays = 19', old.ageDays === 19, String(old.ageDays));
  check(`> ${STALE_DAYS} jours -> signalé ancien`, old.stale);

  const edge = restorePreview(state([]), state([]), '2026-07-23T12:00:00Z', NOW);
  check(`exactement ${STALE_DAYS} jours -> PAS encore ancien`, edge.ageDays === 7 && !edge.stale);

  const none = restorePreview(state([]), state([]), undefined, NOW);
  check('aucune date -> âge inconnu ET signalé (suspect, pas rassurant)', none.ageDays === null && none.stale);

  const bad = restorePreview(state([]), state([]), 'pas-une-date', NOW);
  check('date illisible -> âge inconnu ET signalé', bad.ageDays === null && bad.stale);

  const future = restorePreview(state([]), state([]), '2026-08-15T12:00:00Z', NOW);
  check('date FUTURE (horloge fausse) -> âge inconnu, pas de négatif affiché', future.ageDays === null && future.stale);
}

section('Tableau récapitulatif avant/après');
{
  const cur = state(['a', 'b', 'c']);
  const inc = state(['a']);
  const p = restorePreview(cur, inc, NOW.toISOString(), NOW);
  const leads = p.rows.find(r => r.label === 'Leads');
  check('ligne Leads : 3 -> 1', leads?.before === 3 && leads?.after === 1);
  check('toutes les entités de AppState sont couvertes', p.rows.length === 7, `${p.rows.length} lignes`);
  check('aucune ligne sans libellé', p.rows.every(r => r.label.length > 0));
}

section('formatAge — libellés humains');
{
  check('0 jour', formatAge(0) === "aujourd'hui", formatAge(0));
  check('1 jour au singulier', formatAge(1) === 'il y a 1 jour', formatAge(1));
  check('pluriel', formatAge(19) === 'il y a 19 jours', formatAge(19));
  check('null -> date inconnue', formatAge(null) === 'date inconnue', formatAge(null));
}

console.log(`\n${passed} OK, ${failed} KO`);
if (failed > 0) process.exit(1);
