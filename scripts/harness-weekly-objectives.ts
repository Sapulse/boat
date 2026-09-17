/**
 * Harnais lot 4 — objectifs de la semaine : logique PURE (src/lib/weeklyObjectives.ts)
 * + VRAI reducer.
 *
 * Exécution : npx tsx scripts/harness-weekly-objectives.ts
 *
 * Décisions du 17/09 : objectifs COMMUNS, 5 actifs max par semaine, porteur
 * facultatif (« Non attribué » exclu), jamais de suppression, historique,
 * préparation de la semaine suivante, « Reprendre la semaine suivante », trace
 * des modifications après la fin de semaine.
 */
import {
  weekStartOf, isMonday, addWeeksISO, isWeekEnded, weekRangeLabel, parisTodayISO, objectivesOfWeek, activeCount,
  canAddToWeek, isValidOwner, ownerChoices, validateObjective, newObjective, applyObjectivePatch, carryOverTarget,
  carryOverRefusal, carryOverObjective, historyWeeks, weekScore, serverMergeObjective, MAX_ACTIVE_OBJECTIVES,
} from '../src/lib/weeklyObjectives';
import { reducer } from '../src/context/appReducer';
import type { AppState, Commercial, WeeklyObjective } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const TODAY = '2026-09-17';            // jeudi
const WEEK = '2026-09-14';             // lundi de la semaine en cours
const NEXT = '2026-09-21';
const PREV = '2026-09-07';
const NOW = '2026-09-17T10:00:00.000Z';

const COMMERCIALS: Commercial[] = [
  { id: 'tom', name: 'Tom', active: true },
  { id: 'fred', name: 'Fred', active: true },
  { id: 'ancien', name: 'Ancien', active: false },
  { id: 'na', name: 'Non attribué', active: true },
];

function obj(id: string, over: Partial<WeeklyObjective> = {}): WeeklyObjective {
  return {
    id, weekStart: WEEK, position: 1, text: `Objectif ${id}`, ownerId: null, done: false, doneAt: null, active: true,
    copiedFromId: null, modifiedAfterWeekAt: null, createdAt: '2026-09-14T08:00:00.000Z', updatedAt: '2026-09-14T08:00:00.000Z', ...over,
  };
}

section('Semaines');
check('lundi de la semaine : jeudi 17/09 -> 14/09', weekStartOf(TODAY) === WEEK);
check('dimanche 20/09 -> 14/09 ; lundi 14/09 -> 14/09', weekStartOf('2026-09-20') === WEEK && weekStartOf(WEEK) === WEEK);
check('changement d\'année : jeudi 1/1/2026 -> lundi 29/12/2025', weekStartOf('2026-01-01') === '2025-12-29');
check('isMonday', isMonday(WEEK) && !isMonday(TODAY) && !isMonday('2026-02-30'));
check('semaine suivante / précédente', addWeeksISO(WEEK, 1) === NEXT && addWeeksISO(WEEK, -1) === PREV);
check('fin de semaine : dimanche pas fini, lundi suivant fini', !isWeekEnded(WEEK, '2026-09-20') && isWeekEnded(WEEK, NEXT));
check('libellés', weekRangeLabel(WEEK) === 'du 14 au 20 septembre 2026' && weekRangeLabel('2026-09-28') === 'du 28 septembre au 4 octobre 2026' && weekRangeLabel('2026-12-28') === 'du 28 décembre 2026 au 3 janvier 2027', weekRangeLabel('2026-09-28'));
check('date de Paris : dimanche 23h30 UTC = lundi à Paris', parisTodayISO(new Date('2026-09-20T22:30:00Z')) === '2026-09-21');
check('date de Paris : hiver (UTC+1)', parisTodayISO(new Date('2026-12-31T23:30:00Z')) === '2027-01-01' && parisTodayISO(new Date('2026-12-31T22:30:00Z')) === '2026-12-31');

section('5 actifs au plus, retirés et porteur');
const five = [1, 2, 3, 4, 5].map(i => obj(`o${i}`, { position: i }));
check('5 actifs : semaine pleine', !canAddToWeek(five, WEEK) && activeCount(five, WEEK) === 5);
check('un retiré libère une place', canAddToWeek([...five.slice(0, 4), obj('o5', { active: false })], WEEK));
check('autre semaine indépendante', canAddToWeek(five, NEXT));
check('validation : 6e actif refusé', validateObjective(obj('o6'), five, COMMERCIALS).includes('semaine-pleine'));
check('validation : modifier le 5e n\'est pas « semaine pleine »', validateObjective(five[4], five, COMMERCIALS).length === 0);
check('réactiver un retiré dans une semaine pleine : refusé', validateObjective(obj('o6', { active: true }), [...five, obj('o6', { active: false })], COMMERCIALS).includes('semaine-pleine'));
check('texte vide / 201 caractères refusés, 200 accepté', validateObjective(obj('x', { text: '  ' }), [], COMMERCIALS).includes('texte-vide')
  && validateObjective(obj('x', { text: 'a'.repeat(201) }), [], COMMERCIALS).includes('texte-trop-long')
  && validateObjective(obj('x', { text: 'a'.repeat(200) }), [], COMMERCIALS).length === 0);
check('semaine qui n\'est pas un lundi refusée', validateObjective(obj('x', { weekStart: TODAY }), [], COMMERCIALS).includes('semaine-invalide'));
check('porteur : aucun, Tom, ancien (connu) acceptés', isValidOwner(null, COMMERCIALS) && isValidOwner('tom', COMMERCIALS) && isValidOwner('ancien', COMMERCIALS));
check('porteur : « Non attribué » et inconnu refusés', !isValidOwner('na', COMMERCIALS) && !isValidOwner('zzz', COMMERCIALS));
check('choix de porteur : actifs hors Non attribué ; porteur désactivé gardé', ownerChoices(COMMERCIALS).map(c => c.id).join() === 'tom,fred' && ownerChoices(COMMERCIALS, 'ancien').map(c => c.id).join() === 'tom,fred,ancien');
check('ordre : position puis création', objectivesOfWeek([obj('b', { position: 2 }), obj('a', { position: 1 }), obj('r', { position: 0, active: false })], WEEK).map(o => o.id).join() === 'a,b');
check('retirés visibles sur demande', objectivesOfWeek([obj('a'), obj('r', { active: false })], WEEK, { includeInactive: true }).length === 2);

section('Création et modification');
const created = newObjective({ id: 'n1', weekStart: NEXT, text: '  Préparer le salon  ', ownerId: 'tom', list: five, todayISO: TODAY, nowISO: NOW });
check('création : texte nettoyé, en dernier, pas de trace', created.text === 'Préparer le salon' && created.position === 1 && created.modifiedAfterWeekAt === null && created.active && !created.done);
check('création : position = max + 1 dans la semaine', newObjective({ id: 'n2', weekStart: WEEK, text: 'x', list: five, todayISO: TODAY, nowISO: NOW }).position === 6);
const doneO = applyObjectivePatch(five[0], { done: true }, TODAY, NOW);
check('cocher atteint : doneAt posé, pas de trace (semaine en cours)', doneO.done && doneO.doneAt === NOW && doneO.modifiedAfterWeekAt === null && doneO.updatedAt === NOW);
check('décocher : doneAt effacé', applyObjectivePatch(doneO, { done: false }, TODAY, NOW).doneAt === null);
check('rien ne change : même référence', applyObjectivePatch(five[0], { text: 'Objectif o1 ', done: false }, TODAY, NOW) === five[0]);
const past = obj('p1', { weekStart: PREV });
const late = applyObjectivePatch(past, { done: true }, TODAY, NOW);
check('semaine finie : modification tracée (modifiedAfterWeekAt)', late.modifiedAfterWeekAt === NOW);
check('semaine finie : retirer est tracé aussi', applyObjectivePatch(past, { active: false }, TODAY, NOW).modifiedAfterWeekAt === NOW);
check('porteur « » -> null', applyObjectivePatch(obj('x', { ownerId: 'tom' }), { ownerId: '' }, TODAY, NOW).ownerId === null);

section('Reprendre la semaine suivante');
check('cible : semaine suivante de l\'objectif', carryOverTarget(obj('x'), TODAY) === NEXT);
check('cible : objectif d\'une semaine ancienne -> semaine en cours', carryOverTarget(obj('x', { weekStart: '2026-08-31' }), TODAY) === WEEK);
const list1 = [obj('c1', { ownerId: 'fred' })];
const r1 = carryOverObjective(list1, 'c1', 'c1-copie', TODAY, NOW);
check('copie : même texte, porteur, liée, semaine suivante', !!r1 && 'objective' in r1 && r1.objective.text === 'Objectif c1' && r1.objective.ownerId === 'fred' && r1.objective.copiedFromId === 'c1' && r1.objective.weekStart === NEXT);
const list2 = r1 && 'objective' in r1 ? [...list1, r1.objective] : list1;
check('original inchangé', list2[0] === list1[0]);
check('une seule fois (même si la copie est retirée)', carryOverRefusal(list2, list2[0], TODAY) === 'deja-repris' && carryOverRefusal([list1[0], { ...list2[1], active: false }], list1[0], TODAY) === 'deja-repris');
check('objectif atteint / retiré : pas de reprise', carryOverRefusal([], obj('d', { done: true }), TODAY) === 'deja-fait' && carryOverRefusal([], obj('r', { active: false }), TODAY) === 'retire');
check('semaine suivante pleine : refus', carryOverRefusal([...[1, 2, 3, 4, 5].map(i => obj(`s${i}`, { weekStart: NEXT })), obj('c')], obj('c'), TODAY) === 'semaine-pleine');
check('objectif introuvable : null', carryOverObjective([], 'zz', 'n', TODAY, NOW) === null);

section('Historique et bilan');
const hist = [obj('h1', { weekStart: '2026-08-31' }), obj('h2', { weekStart: PREV, done: true }), obj('h3', { weekStart: PREV }), obj('h4', { weekStart: PREV, active: false, done: true }), obj('c'), obj('n', { weekStart: NEXT })];
check('semaines passées, plus récente d\'abord (en cours et suivante exclues)', historyWeeks(hist, TODAY).join() === `${PREV},2026-08-31`);
check('bilan : retirés exclus (1 / 2)', JSON.stringify(weekScore(hist, PREV)) === JSON.stringify({ done: 1, total: 2 }));

section('Fusion serveur : trace et dates décidées par le serveur');
const s1 = serverMergeObjective(undefined, obj('s', { weekStart: WEEK, modifiedAfterWeekAt: '2020-01-01T00:00:00Z' }), TODAY, NOW);
check('création semaine en cours : trace envoyée par le client ignorée', s1.modifiedAfterWeekAt === null);
check('création dans une semaine finie : tracée', serverMergeObjective(undefined, obj('s', { weekStart: PREV }), TODAY, NOW).modifiedAfterWeekAt === NOW);
const existingPast = obj('e', { weekStart: PREV, modifiedAfterWeekAt: null });
check('semaine finie, contenu identique : pas de trace (rejeu idempotent)', serverMergeObjective(existingPast, { ...existingPast, updatedAt: NOW }, TODAY, NOW).modifiedAfterWeekAt === null);
check('semaine finie, contenu modifié : tracé', serverMergeObjective(existingPast, { ...existingPast, text: 'Autre' }, TODAY, NOW).modifiedAfterWeekAt === NOW);
check('le client ne peut pas effacer une trace', serverMergeObjective({ ...existingPast, modifiedAfterWeekAt: '2026-09-15T09:00:00Z' }, { ...existingPast, modifiedAfterWeekAt: null }, TODAY, NOW).modifiedAfterWeekAt === '2026-09-15T09:00:00Z');
check('semaine et lien de reprise figés', (() => { const m = serverMergeObjective(existingPast, { ...existingPast, weekStart: NEXT, copiedFromId: 'x' }, TODAY, NOW); return m.weekStart === PREV && m.copiedFromId === null; })());
check('doneAt : gardé si done inchangé, posé si coché, effacé si décoché', (() => {
  const d = obj('d', { done: true, doneAt: '2026-09-15T08:00:00Z' });
  return serverMergeObjective(d, { ...d, doneAt: null }, TODAY, NOW).doneAt === '2026-09-15T08:00:00Z'
    && serverMergeObjective(obj('d'), { ...obj('d'), done: true, doneAt: null }, TODAY, NOW).doneAt === NOW
    && serverMergeObjective(d, { ...d, done: false }, TODAY, NOW).doneAt === null;
})());

section('Reducer (vrai) : ajout, modification, reprise — jamais de suppression');
function state(weeklyObjectives: WeeklyObjective[]): AppState {
  return {
    leads: [], actions: [], commercials: COMMERCIALS, monthlyStats: [], templates: [], calendarEvents: [], goals: [],
    defaultGoal: { prospectsCreated: null, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null },
    plannedActions: [], weeklyObjectives,
  };
}
const st0 = state(five);
const add6 = reducer(st0, { type: 'ADD_WEEKLY_OBJECTIVE', payload: { id: 'o6', weekStart: WEEK, text: 'Sixième', ownerId: null, todayISO: TODAY, nowISO: NOW } });
check('6e ajout refusé par le reducer (état inchangé)', add6 === st0);
const addNext = reducer(st0, { type: 'ADD_WEEKLY_OBJECTIVE', payload: { id: 'n1', weekStart: NEXT, text: 'Préparer', ownerId: 'tom', todayISO: TODAY, nowISO: NOW } });
check('ajout semaine suivante accepté', addNext.weeklyObjectives?.length === 6 && addNext.weeklyObjectives?.[5].ownerId === 'tom');
check('porteur « Non attribué » refusé par le reducer', reducer(st0, { type: 'ADD_WEEKLY_OBJECTIVE', payload: { id: 'n2', weekStart: NEXT, text: 'x', ownerId: 'na', todayISO: TODAY, nowISO: NOW } }) === st0);
const retire = reducer(st0, { type: 'UPDATE_WEEKLY_OBJECTIVE', payload: { id: 'o2', patch: { active: false }, todayISO: TODAY, nowISO: NOW } });
check('retirer : toujours présent, active=false', retire.weeklyObjectives?.length === 5 && retire.weeklyObjectives?.find(o => o.id === 'o2')?.active === false);
const reactivate = reducer({ ...retire, weeklyObjectives: [...retire.weeklyObjectives!, obj('o7')] }, { type: 'UPDATE_WEEKLY_OBJECTIVE', payload: { id: 'o2', patch: { active: true }, todayISO: TODAY, nowISO: NOW } });
check('réactiver dans une semaine repleine : refusé', reactivate.weeklyObjectives?.find(o => o.id === 'o2')?.active === false);
const carried = reducer(st0, { type: 'CARRY_OVER_WEEKLY_OBJECTIVE', payload: { id: 'o1', newId: 'o1-s', todayISO: TODAY, nowISO: NOW } });
check('reprise : copie ajoutée semaine suivante', carried.weeklyObjectives?.find(o => o.id === 'o1-s')?.weekStart === NEXT);
check('reprise rejouée : refusée', reducer(carried, { type: 'CARRY_OVER_WEEKLY_OBJECTIVE', payload: { id: 'o1', newId: 'o1-t', todayISO: TODAY, nowISO: NOW } }) === carried);
const hydrated = reducer(state([]), { type: 'SET_STATE', payload: { ...state([]), weeklyObjectives: undefined } as unknown as AppState });
check('hydratation d\'un ancien état sans objectifs : []', Array.isArray(hydrated.weeklyObjectives) && hydrated.weeklyObjectives.length === 0);
check(`constante : ${MAX_ACTIVE_OBJECTIVES} objectifs`, MAX_ACTIVE_OBJECTIVES === 5);

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais objectifs de la semaine : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
