/**
 * Harnais lot 2, arrêt 3 — agenda des actions programmées (src/lib/agenda.ts).
 *
 * Exécution : npx tsx scripts/harness-agenda-planned.ts
 *
 * Couvre les décisions de l'arrêt 3 :
 *  - faite = grisée À SA DATE, annulée = absente, à faire passée = en retard À SA DATE
 *    (hors Signé / Perdu) ;
 *  - multi-personnes : visible chez chacun (filtre et colonnes Journée), « Autres » sinon ;
 *  - création sur la grille : leads sans action à faire, hors Signé / Perdu, SANS fenêtre A ;
 *  - « Fait » : fenêtre selon le type, ligne réalisée (objectifs, dernière action),
 *    action grisée, puis fenêtre A non fermable ; « Reporter » : trace, pas de fenêtre A ;
 *  - pastille : nombre d'actions en retard.
 */
import {
  buildPlannedAgendaItems, plannedItemsFor, splitByPersonColumns, getPlannableLeads,
  doneFlowFor, buildDoneAction, doneResultLabel,
} from '../src/lib/agenda';
import { countOverdue, isValidCallNote, nextActionDecision } from '../src/lib/plannedActions';
import { countActions } from '../src/lib/goals';
import { reducer } from '../src/context/appReducer';
import type { AppState, Commercial, Lead, PlannedAction } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const TODAY = '2026-09-16';
const COMMERCIALS: Commercial[] = [
  { id: 'tom', name: 'Tom', active: true },
  { id: 'fred', name: 'Fred', active: true },
  { id: 'ancien', name: 'Ancien', active: false },
];

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', createdAt: '2026-08-01', source: 'LBC', commercialId: 'tom', firstName: 'Jean', lastName: 'Test',
    phone: '', email: 'j@t.fr', boatType: '', boatCondition: '', boatInterest: '', brand: '', budget: null,
    status: 'contacte', contactDate: '', quoteAmount: null, probability: null, currentBoat: '', comments: '',
    deliveryDate: '', temperature: 'neutre', priority: 'normale', nextActionType: '', nextActionDate: '',
    lastActionDate: '2026-09-10', lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
  };
}
function pa(over: Partial<PlannedAction> = {}): PlannedAction {
  return {
    id: 'p1', leadId: 'l1', type: 'appel', customLabel: '', date: '2026-09-20', originalDate: '2026-09-20',
    note: '', status: 'a_faire', people: [{ commercialId: 'tom', role: 'responsable' }], ...over,
  };
}
function state(over: Partial<AppState> = {}): AppState {
  return {
    leads: [lead()], actions: [], commercials: COMMERCIALS, monthlyStats: [], templates: [], calendarEvents: [],
    goals: [], defaultGoal: { prospectsCreated: null, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null },
    plannedActions: [], ...over,
  };
}

section('Éléments d\'agenda : faite grisée, annulée absente, retard à sa date');
{
  const leads = [lead(), lead({ id: 'l2', firstName: 'Anne', lastName: 'Perdue', status: 'perdu' }), lead({ id: 'l3', status: 'reporte' })];
  const planned = [
    pa({ id: 'future' }),
    pa({ id: 'retard', date: '2026-09-10', time: '10:00', endTime: '10:30' }),
    pa({ id: 'faite', date: '2026-09-09', status: 'faite', doneActionId: 'a1' }),
    pa({ id: 'annulee', status: 'annulee' }),
    pa({ id: 'perdu', leadId: 'l2', date: '2026-09-01' }),
    pa({ id: 'reporte', leadId: 'l3', date: '2026-09-02' }),
    pa({ id: 'orpheline', leadId: 'supprime' }),
    pa({ id: 'autre', type: 'autre', customLabel: 'Essai en mer', date: '2026-09-18' }),
  ];
  const items = buildPlannedAgendaItems(planned, leads, TODAY);
  const by = (id: string) => items.find(i => i.id === id);
  check('annulée et lead supprimé : absents', !by('annulee') && !by('orpheline') && items.length === 6);
  check('faite : présente, grisée, jamais en retard, à SA date', by('faite')?.done === true && by('faite')?.overdue === false && by('faite')?.date === '2026-09-09');
  check('à faire passée : en retard, reste à SA date (pas déplacée à aujourd\'hui)', by('retard')?.overdue === true && by('retard')?.date === '2026-09-10' && by('retard')?.time === '10:00');
  check('future : ni faite ni en retard', by('future')?.done === false && by('future')?.overdue === false);
  check('lead Perdu : pas en retard ; lead Reporté : en retard', by('perdu')?.overdue === false && by('reporte')?.overdue === true);
  check('libellé « Autre » = texte libre, nom du lead', by('autre')?.label === 'Essai en mer' && by('future')?.leadName === 'Jean Test');
  check('pastille = nombre d\'actions en retard (2 : retard + reporté)', countOverdue(planned, leads, TODAY) === 2);
}

section('Plusieurs personnes : visible chez chacun');
{
  const items = buildPlannedAgendaItems([
    pa({ id: 'duo', people: [{ commercialId: 'fred', role: 'participant' }, { commercialId: 'tom', role: 'responsable' }] }),
    pa({ id: 'solo', people: [{ commercialId: 'fred', role: 'responsable' }] }),
    pa({ id: 'ancien', people: [{ commercialId: 'ancien', role: 'responsable' }] }),
  ], [lead()], TODAY);
  check('couleur = premier RESPONSABLE (pas le premier de la liste)', items.find(i => i.id === 'duo')?.colorCommercialId === 'tom');
  check('filtre Tom : l\'action à deux', plannedItemsFor(items, 'tom').map(i => i.id).join() === 'duo');
  check('filtre Fred : responsable ET participant', plannedItemsFor(items, 'fred').map(i => i.id).join() === 'duo,solo');
  check('sans filtre : tout', plannedItemsFor(items).length === 3);
  const { byColumn, orphans } = splitByPersonColumns(items, ['tom', 'fred']);
  check('Journée : l\'action à deux dans la colonne de CHACUN', byColumn.get('tom')!.some(i => i.id === 'duo') && byColumn.get('fred')!.some(i => i.id === 'duo'));
  check('Journée : personne sans colonne -> « Autres » (rien de masqué)', orphans.map(i => i.id).join() === 'ancien');
  const dup = splitByPersonColumns([items[0]], ['tom']);
  check('une personne en double dans la liste : une seule fois par colonne', dup.byColumn.get('tom')!.length === 1);
}

section('Création sur la grille : leads sans action à faire, sans fenêtre A');
{
  const leads = [
    lead({ id: 'libre' }),
    lead({ id: 'occupe' }),
    lead({ id: 'fait' }),
    lead({ id: 'signe', status: 'signe' }),
    lead({ id: 'perdu', status: 'perdu' }),
    lead({ id: 'reporte', status: 'reporte' }),
  ];
  const planned = [pa({ leadId: 'occupe' }), pa({ id: 'x', leadId: 'fait', status: 'faite' })];
  check('proposés : libre, action faite seulement, reporté', getPlannableLeads(leads, planned).map(l => l.id).join() === 'libre,fait,reporte');
  check('créer sur la grille -> PAS de fenêtre A', nextActionDecision({ kind: 'agenda_creer' }).prompt === null);
  check('reporter (bouton, glisser) -> PAS de fenêtre A', nextActionDecision({ kind: 'agenda_reporter' }).prompt === null);
}

section('« Fait » : fenêtre selon le type, ligne réalisée, puis fenêtre A non fermable');
{
  check('appel -> puces', doneFlowFor('appel') === 'appel');
  check('email / SMS / WhatsApp -> confirmation d\'envoi', doneFlowFor('email') === 'message' && doneFlowFor('sms') === 'message' && doneFlowFor('whatsapp') === 'message');
  check('RDV, visite, devis, Autre -> compte rendu', (['rdv', 'visite', 'devis', 'autre', 'relance'] as const).every(t => doneFlowFor(t) === 'compte_rendu'));
  check('compte rendu : 2 mots / 10 caractères', !isValidCallNote('RAS') && isValidCallNote('Visite faite, devis demandé'));
  check('libellé : « Rendez-vous — fait » / texte libre', doneResultLabel({ type: 'rdv', customLabel: '' }) === 'Rendez-vous — fait' && doneResultLabel({ type: 'autre', customLabel: 'Essai en mer' }) === 'Essai en mer — fait');

  const rdv = pa({ id: 'rdv', type: 'rdv', people: [{ commercialId: 'fred', role: 'participant' }, { commercialId: 'tom', role: 'responsable' }] });
  const act = buildDoneAction(rdv, lead({ commercialId: 'fred' }), { result: doneResultLabel(rdv), notes: 'Visite faite, devis demandé', today: TODAY });
  check('auteur = premier responsable (objectifs)', act.authorId === 'tom' && act.type === 'rdv' && act.date === TODAY);

  let s = state({ plannedActions: [rdv] });
  s = reducer(s, { type: 'COMPLETE_PLANNED_ACTION', payload: { plannedId: 'rdv', action: { ...act, id: 'h1' }, doneAt: '2026-09-16T10:00:00Z' } });
  check('action grisée (faite), liée à l\'historique', s.plannedActions[0].status === 'faite' && s.plannedActions[0].doneActionId === 'h1');
  check('ligne RÉALISÉE : dernière action + objectifs', s.actions[0].kind === 'realisee' && s.leads[0].lastActionDate === TODAY && countActions(s.actions, 'tom', 2026, 9, ['rdv']) === 1);
  const items = buildPlannedAgendaItems(s.plannedActions, s.leads, TODAY);
  check('après « Fait » : toujours sur la grille, grisée', items.length === 1 && items[0].done);
  check('après « Fait » : lead à planifier -> proposé à la création', getPlannableLeads(s.leads, s.plannedActions).length === 1);
  const next = nextActionDecision({ kind: 'action_enregistree', currentStatus: 'contacte' }).prompt;
  check('puis fenêtre A NON fermable', next?.closable === false && next.mode === 'obligatoire');

  // « Reporter » : trace, action toujours à faire, plus en retard si la nouvelle date est future.
  let r = state({ plannedActions: [pa({ id: 'late', date: '2026-09-10' })] });
  r = reducer(r, { type: 'RESCHEDULE_PLANNED_ACTION', payload: { plannedId: 'late', date: '2026-09-18', time: '14:00', authorId: 'tom', today: TODAY, reportEntryId: 'rep' } });
  check('Reporter : trace « report », dernière action inchangée', r.actions[0]?.kind === 'report' && r.leads[0].lastActionDate === '2026-09-10');
  check('Reporter : plus en retard, à la nouvelle date', (() => { const it = buildPlannedAgendaItems(r.plannedActions, r.leads, TODAY)[0]; return it.date === '2026-09-18' && !it.overdue && it.time === '14:00'; })());
  check('« Pas fait » = rien : l\'action reste en retard', buildPlannedAgendaItems([pa({ date: '2026-09-10' })], [lead()], TODAY)[0].overdue);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais agenda (actions programmées) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
