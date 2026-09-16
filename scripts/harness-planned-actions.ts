/**
 * Harnais lot 2 — actions programmées : logique PURE (src/lib/plannedActions.ts)
 * + règles d'alerte (proposition A) + objectifs + VRAI reducer.
 *
 * Exécution : npx tsx scripts/harness-planned-actions.ts
 *
 * Couvre les décisions validées le 2026-09-16 :
 *  - une seule action « à faire » par lead ; reprogrammer = même action, trace
 *    « report » seulement si la DATE change ; résumé nextAction* recalculé ;
 *  - retard : à faire + date passée, hors Signé / Perdu (Reporté INCLUS) ;
 *  - « Aucune prochaine action » : motif, expire à la programmation, proposition A ;
 *  - fenêtre : après toute action ; changement de statut (règle 4) ;
 *  - personnes : « Non attribué » et inactifs exclus ; un responsable au moins ;
 *  - reprise des prochaines actions existantes : idempotente, sans perte ;
 *  - traces report / sans suite : ni dernière action, ni objectifs.
 */
import { addDays } from 'date-fns';
import {
  eligibleCommercials, defaultPeople, normalizePeople, concernsCommercial, isUnassignedCommercial,
  pendingActionOf, summarizeNextAction, withNextActionSummary, isPlannedActionOverdue, countOverdue,
  needsPlanning, hasExplicitNoNextAction, buildReportEntry, isRealizedAction, planNextAction,
  reschedulePlannedAction, completePlannedAction, cancelPendingAction, migrateLegacyNextActions, legacyPlannedId,
  windowAfterAction, windowAfterStatusChange, validateNextActionChoice, isValidCallNote,
  resolveNoNextActionReason, plannedActionLabel, nextActionDecision, type PlanInput, type NextActionChoice,
  CALL_RESULTS, validateCallEntry, callResultLabel,
} from '../src/lib/plannedActions';
import { buildCommunicationAction } from '../src/lib/communication';
import { getAlertLevel, getLeadRisks, toISODate } from '../src/lib/utils';
import { countActions } from '../src/lib/goals';
import { reducer } from '../src/context/appReducer';
import { LEAD_STATUSES, NO_NEXT_ACTION_REASONS } from '../src/data/constants';
import type { AppState, Commercial, Lead, LeadAction, LeadStatus, PlannedAction } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const TODAY = '2026-09-16';
const now = new Date();
const d = (off: number) => toISODate(addDays(now, off)); // relatif à AUJOURD'HUI (règles d'alerte)

const COMMERCIALS: Commercial[] = [
  { id: 'tom', name: 'Tom', active: true },
  { id: 'fred', name: 'Fred', active: true },
  { id: 'nicolas', name: 'Nicolas', active: true },
  { id: 'ancien', name: 'Ancien', active: false },
  { id: 'na', name: 'Non attribué', active: true },
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
    id: 'pa1', leadId: 'l1', type: 'appel', customLabel: '', date: '2026-09-20', originalDate: '2026-09-20',
    note: '', status: 'a_faire', people: [{ commercialId: 'tom', role: 'responsable' }], ...over,
  };
}
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  type: 'appel', customLabel: '', date: '2026-09-20', note: '', people: [{ commercialId: 'tom', role: 'responsable' }], ...over,
});
function state(over: Partial<AppState> = {}): AppState {
  return {
    leads: [lead()], actions: [], commercials: COMMERCIALS, monthlyStats: [], templates: [], calendarEvents: [],
    goals: [], defaultGoal: { prospectsCreated: null, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null },
    plannedActions: [], ...over,
  };
}

section('Personnes : Équipe uniquement, « Non attribué » et inactifs exclus');
{
  check('« Non attribué » reconnu (casse, accents)', isUnassignedCommercial({ name: ' NON ATTRIBUE ' }) && !isUnassignedCommercial({ name: 'Nicolas' }));
  check('éligibles = actifs hors Non attribué', eligibleCommercials(COMMERCIALS).map(c => c.id).join() === 'tom,fred,nicolas');
  check('défaut = commercial du lead en responsable', JSON.stringify(defaultPeople({ commercialId: 'fred' }, COMMERCIALS)) === JSON.stringify([{ commercialId: 'fred', role: 'responsable' }]));
  check('lead « Non attribué » -> aucun défaut (responsable obligatoire)', defaultPeople({ commercialId: 'na' }, COMMERCIALS).length === 0);
  check('commercial inactif -> aucun défaut', defaultPeople({ commercialId: 'ancien' }, COMMERCIALS).length === 0);
  const norm = normalizePeople([{ commercialId: 'tom', role: 'participant' }, { commercialId: 'tom', role: 'responsable' }, { commercialId: 'fred', role: 'participant' }, { commercialId: 'fred', role: 'participant' }]);
  check('dédoublonnage : responsable l\'emporte, une ligne par personne', norm.length === 2 && norm.find(p => p.commercialId === 'tom')?.role === 'responsable');
  check('concerne responsable ET participant (agenda de chacun)', concernsCommercial(pa({ people: [{ commercialId: 'tom', role: 'responsable' }, { commercialId: 'fred', role: 'participant' }] }), 'fred'));
}

section('Action à faire et résumé sur le lead');
{
  const list = [pa({ id: 'b', date: '2026-09-22' }), pa({ id: 'a', date: '2026-09-21', time: '09:00' }), pa({ id: 'c', date: '2026-09-01', status: 'faite' })];
  check('à faire = la plus proche parmi les « a_faire »', pendingActionOf('l1', list)?.id === 'a');
  check('rien à faire -> undefined', pendingActionOf('l1', [pa({ status: 'faite' }), pa({ status: 'annulee' })]) === undefined);
  const s = summarizeNextAction(pa({ date: '2026-09-21', time: '09:00', endTime: '09:30', type: 'rdv' }));
  check('résumé = type, date, heures', s.nextActionType === 'rdv' && s.nextActionDate === '2026-09-21' && s.nextActionTime === '09:00' && s.nextActionEndTime === '09:30');
  check('résumé vide sans action', summarizeNextAction(undefined).nextActionDate === '' && summarizeNextAction(undefined).nextActionType === '');
  const l = lead({ nextActionType: 'appel', nextActionDate: '2026-09-20' });
  check('résumé inchangé -> MÊME référence (pas de re-rendu)', withNextActionSummary(l, [pa()]) === l);
  const withReason = lead({ noNextActionReason: 'A acheté ailleurs', noNextActionAt: '2026-09-01T10:00:00Z' });
  const synced = withNextActionSummary(withReason, [pa()]);
  check('programmer une action EFFACE le motif « Aucune » (il expire)', synced.noNextActionReason === '' && synced.noNextActionAt === '' && synced.nextActionDate === '2026-09-20');
  check('sans action, le motif reste', withNextActionSummary(withReason, []).noNextActionReason === 'A acheté ailleurs');
  check('libellé : type, ou texte libre pour « Autre »', plannedActionLabel(pa()) === 'Appel' && plannedActionLabel(pa({ type: 'autre', customLabel: 'Essai en mer' })) === 'Essai en mer');
}

section('Retard : à faire, date passée, hors Signé / Perdu — Reporté INCLUS');
{
  const past = pa({ date: '2026-09-15' });
  check('date d\'hier -> en retard', isPlannedActionOverdue(past, lead(), TODAY));
  check('aujourd\'hui -> pas en retard', !isPlannedActionOverdue(pa({ date: TODAY }), lead(), TODAY));
  check('faite -> jamais en retard (grisée)', !isPlannedActionOverdue(pa({ date: '2026-09-01', status: 'faite' }), lead(), TODAY));
  check('annulée -> jamais en retard', !isPlannedActionOverdue(pa({ date: '2026-09-01', status: 'annulee' }), lead(), TODAY));
  check('lead Perdu / Signé -> pas en retard', !isPlannedActionOverdue(past, lead({ status: 'perdu' }), TODAY) && !isPlannedActionOverdue(past, lead({ status: 'signe' }), TODAY));
  check('lead Reporté -> EN retard (date de reprise oubliée)', isPlannedActionOverdue(past, lead({ status: 'reporte' }), TODAY));
  const leads = [lead({ id: 'l1' }), lead({ id: 'l2', status: 'perdu' }), lead({ id: 'l3' })];
  const planned = [
    pa({ id: 'x1', leadId: 'l1', date: '2026-09-10' }),
    pa({ id: 'x2', leadId: 'l2', date: '2026-09-10' }),
    pa({ id: 'x3', leadId: 'l3', date: '2026-09-10', people: [{ commercialId: 'fred', role: 'responsable' }, { commercialId: 'tom', role: 'participant' }] }),
    pa({ id: 'x4', leadId: 'l3', date: '2026-09-30' }),
  ];
  check('compteur global = 2 (perdu exclu, future exclue)', countOverdue(planned, leads, TODAY) === 2);
  check('compteur de Tom = 2 (responsable ET participant)', countOverdue(planned, leads, TODAY, 'tom') === 2);
  check('compteur de Fred = 1', countOverdue(planned, leads, TODAY, 'fred') === 1);
}

section('À planifier et « Aucune prochaine action »');
{
  check('actif sans action ni motif -> à planifier', needsPlanning(lead()));
  check('avec action -> non', !needsPlanning(lead({ nextActionDate: '2026-09-20' })));
  check('avec motif -> non', !needsPlanning(lead({ noNextActionReason: 'Projet abandonné / plus de projet' })));
  check('Signé / Perdu -> non', !needsPlanning(lead({ status: 'signe' })) && !needsPlanning(lead({ status: 'perdu' })));
  check('Reporté sans date -> OUI (reprise à planifier)', needsPlanning(lead({ status: 'reporte' })));
  check('motif valable seulement sans action', hasExplicitNoNextAction(lead({ noNextActionReason: 'X' })) && !hasExplicitNoNextAction(lead({ noNextActionReason: 'X', nextActionDate: '2026-09-20' })));
  check('motif « Autre » -> texte libre', resolveNoNextActionReason('Autre', '  Salon nautique  ') === 'Salon nautique' && resolveNoNextActionReason('A acheté ailleurs', 'ignoré') === 'A acheté ailleurs');
  check('liste des motifs validée (9, dont Autre)', NO_NEXT_ACTION_REASONS.length === 9 && NO_NEXT_ACTION_REASONS.includes('Autre'));
}

section('Proposition A : alertes d\'un lead « Aucune prochaine action »');
{
  const chaudSansAction = lead({ temperature: 'chaud', lastActionDate: d(0) });
  check('chaud sans action, SANS motif -> rouge (inchangé)', getAlertLevel(chaudSansAction) === 'red');
  check('chaud sans action, AVEC motif -> plus rouge', getAlertLevel({ ...chaudSansAction, noNextActionReason: 'A acheté ailleurs' }) === 'none');
  const risks = getLeadRisks({ ...chaudSansAction, noNextActionReason: 'A acheté ailleurs' });
  check('motif -> plus de risque « Aucune prochaine action planifiée »', !risks.some(r => r.label.includes('Aucune prochaine action')));
  check('sans motif -> le risque est là (inchangé)', getLeadRisks(chaudSansAction).some(r => r.label.includes('Aucune prochaine action')));
  const inactif15 = lead({ lastActionDate: d(-15), noNextActionReason: 'Le client doit revenir vers nous' });
  check('motif MAIS 15 j sans action -> rouge d\'inactivité GARDÉ', getAlertLevel(inactif15) === 'red');
  check('motif MAIS 8 j sans action -> orange GARDÉ', getAlertLevel(lead({ lastActionDate: d(-8), noNextActionReason: 'X' })) === 'orange');
  check('motif : risque d\'inactivité gardé', getLeadRisks(inactif15).some(r => r.label.includes('Aucune action depuis')));
  check('chaud inactif > 3 j : risque gardé malgré le motif', getLeadRisks(lead({ temperature: 'chaud', lastActionDate: d(-5), noNextActionReason: 'X' })).some(r => r.label.includes('chaud inactif')));
}

section('Fenêtre « Prochaine action » : après une action, après un changement de statut (règle 4)');
{
  check('après une action sans changement de statut -> obligatoire', windowAfterAction(undefined, 'contacte') === 'obligatoire');
  check('après une action qui passe en Reporté -> reprise', windowAfterAction('reporte', 'contacte') === 'reprise');
  check('après une action sur un lead déjà Reporté -> reprise', windowAfterAction(undefined, 'reporte') === 'reprise');
  check('après une action qui passe en Signé / Perdu -> passable', windowAfterAction('signe', 'negociation') === 'passable' && windowAfterAction('perdu', 'contacte') === 'passable');
  for (const s of LEAD_STATUSES.map(x => x.value) as LeadStatus[]) {
    const withPending = windowAfterStatusChange(s, true);
    const without = windowAfterStatusChange(s, false);
    if (s === 'reporte') check('statut -> Reporté : reprise, action en cours ou non', withPending === 'reprise' && without === 'reprise');
    else if (s === 'signe' || s === 'perdu') check(`statut -> ${s} : passable, action en cours ou non`, withPending === 'passable' && without === 'passable');
    else check(`statut -> ${s} : obligatoire SEULEMENT sans action à faire`, withPending === null && without === 'obligatoire', `${withPending}/${without}`);
  }
}

section('Validation du choix dans la fenêtre');
{
  const plan = (over: Partial<PlanInput> = {}): NextActionChoice => ({ kind: 'planifier', ...input(over) });
  const aucune = (reason: string, customReason = ''): NextActionChoice => ({ kind: 'aucune', reason, customReason });
  check('planification complète -> valide', validateNextActionChoice(plan(), 'obligatoire', COMMERCIALS).length === 0);
  check('« Autre » sans texte -> refus', validateNextActionChoice(plan({ type: 'autre' }), 'obligatoire', COMMERCIALS).some(e => e.includes('Précisez le type')));
  check('« Autre » avec texte -> valide', validateNextActionChoice(plan({ type: 'autre', customLabel: 'Essai en mer' }), 'obligatoire', COMMERCIALS).length === 0);
  check('sans date -> refus', validateNextActionChoice(plan({ date: '' }), 'obligatoire', COMMERCIALS).length > 0);
  check('Reporté sans date -> message « date de reprise »', validateNextActionChoice(plan({ date: '' }), 'reprise', COMMERCIALS).some(e => e.includes('reprise')));
  check('heure invalide -> refus', validateNextActionChoice(plan({ time: '25:00' }), 'obligatoire', COMMERCIALS).length > 0);
  check('fin sans début -> refus', validateNextActionChoice(plan({ endTime: '10:00' }), 'obligatoire', COMMERCIALS).length > 0);
  check('fin avant début -> refus', validateNextActionChoice(plan({ time: '10:00', endTime: '09:30' }), 'obligatoire', COMMERCIALS).length > 0);
  check('sans responsable (participant seul) -> refus', validateNextActionChoice(plan({ people: [{ commercialId: 'tom', role: 'participant' }] }), 'obligatoire', COMMERCIALS).some(e => e.includes('responsable')));
  check('« Non attribué » choisi -> refus', validateNextActionChoice(plan({ people: [{ commercialId: 'na', role: 'responsable' }] }), 'obligatoire', COMMERCIALS).some(e => e.includes('Non attribué')));
  check('commercial inactif -> refus', validateNextActionChoice(plan({ people: [{ commercialId: 'ancien', role: 'responsable' }] }), 'obligatoire', COMMERCIALS).length > 0);
  check('plusieurs responsables + participant -> valide', validateNextActionChoice(plan({ people: [{ commercialId: 'tom', role: 'responsable' }, { commercialId: 'fred', role: 'responsable' }, { commercialId: 'nicolas', role: 'participant' }] }), 'obligatoire', COMMERCIALS).length === 0);
  check('« Aucune » avec motif -> valide', validateNextActionChoice(aucune('A acheté ailleurs'), 'obligatoire', COMMERCIALS).length === 0);
  check('« Aucune » sans motif -> refus', validateNextActionChoice(aucune(''), 'obligatoire', COMMERCIALS).length > 0);
  check('« Aucune » motif hors liste -> refus', validateNextActionChoice(aucune('Parce que'), 'obligatoire', COMMERCIALS).length > 0);
  check('« Aucune » / Autre sans texte -> refus', validateNextActionChoice(aucune('Autre', '  '), 'obligatoire', COMMERCIALS).some(e => e.includes('Précisez')));
  check('« Aucune » INTERDITE pour un Reporté', validateNextActionChoice(aucune('A acheté ailleurs'), 'reprise', COMMERCIALS).some(e => e.includes('Reporté')));
  check('« Aucune » permise pour Signé / Perdu', validateNextActionChoice(aucune('A acheté ailleurs'), 'passable', COMMERCIALS).length === 0);
  check('« Passer » seulement Signé / Perdu', validateNextActionChoice({ kind: 'passer' }, 'passable', COMMERCIALS).length === 0
    && validateNextActionChoice({ kind: 'passer' }, 'obligatoire', COMMERCIALS).length > 0
    && validateNextActionChoice({ kind: 'passer' }, 'reprise', COMMERCIALS).length > 0);
  check('note d\'appel : 2 mots et 10 caractères', isValidCallNote('Client intéressé') && !isValidCallNote('OK') && !isValidCallNote('Rappeler.') && !isValidCallNote('Intéressééé') && !isValidCallNote('   '));
}

section('Programmer / reporter / réaliser / annuler (fonctions pures)');
{
  const ctx = { authorId: 'tom', today: TODAY };
  const created = planNextAction([], 'l1', input({ time: '10:00', endTime: '10:30' }), { plannedId: 'n1', reportEntryId: 'r1' }, ctx);
  const c = created.planned[0];
  check('création : id fourni, originalDate = date, à faire', c.id === 'n1' && c.originalDate === '2026-09-20' && c.status === 'a_faire' && !created.report);
  const sameDay = planNextAction(created.planned, 'l1', input({ time: '15:00', note: 'Heure changée' }), { plannedId: 'n2', reportEntryId: 'r2' }, ctx);
  check('reprogrammer le même jour : même id, PAS de trace', sameDay.planned.length === 1 && sameDay.planned[0].id === 'n1' && !sameDay.report && sameDay.planned[0].time === '15:00');
  const moved = planNextAction(created.planned, 'l1', input({ date: '2026-09-25', type: 'rdv' }), { plannedId: 'n3', reportEntryId: 'r3' }, ctx);
  check('nouvelle date : même action, originalDate CONSERVÉE', moved.planned.length === 1 && moved.planned[0].id === 'n1' && moved.planned[0].originalDate === '2026-09-20' && moved.planned[0].date === '2026-09-25');
  check('nouvelle date : trace « report » produite', moved.report?.kind === 'report' && moved.report.id === 'r3' && moved.report.plannedActionId === 'n1');
  check('texte de la trace : « prévu le X à H, reporté au Y »', moved.report?.result === 'Appel prévu le 20/09 à 10:00, reporté au 25/09', moved.report?.result);
  check('customLabel vidé hors « Autre »', planNextAction([], 'l1', input({ customLabel: 'ignoré' }), { plannedId: 'z', reportEntryId: 'zz' }, ctx).planned[0].customLabel === '');
  check('fin ignorée sans heure de début', planNextAction([], 'l1', input({ endTime: '11:00' }), { plannedId: 'z', reportEntryId: 'zz' }, ctx).planned[0].endTime === undefined);
  const faite = [pa({ id: 'old', status: 'faite', date: '2026-09-01' })];
  const afterDone = planNextAction(faite, 'l1', input(), { plannedId: 'new', reportEntryId: 'rr' }, ctx);
  check('une action FAITE ne bloque pas : nouvelle action créée, l\'ancienne intacte', afterDone.planned.length === 2 && afterDone.planned[0].status === 'faite' && afterDone.planned[1].id === 'new');

  const r = reschedulePlannedAction(created.planned, 'n1', { date: '2026-09-22', time: '08:00' }, { reportEntryId: 'rep' }, ctx);
  check('glisser-déposer / Reporter : nouvelle date + trace', r.planned[0].date === '2026-09-22' && r.report?.result === 'Appel prévu le 20/09 à 10:00, reporté au 22/09 à 08:00');
  check('changer seulement l\'heure : pas de trace', !reschedulePlannedAction(created.planned, 'n1', { date: '2026-09-20', time: '16:00' }, { reportEntryId: 'rep' }, ctx).report);
  check('reporter une action faite : ignoré', reschedulePlannedAction(faite, 'old', { date: '2026-09-30' }, { reportEntryId: 'x' }, ctx).planned === faite);

  const done = completePlannedAction(created.planned, 'n1', { doneAt: '2026-09-20T10:05:00Z', doneActionId: 'act1' });
  check('« Fait » : status faite, lien vers l\'historique', done[0].status === 'faite' && done[0].doneActionId === 'act1');
  check('« Fait » deux fois : sans effet', completePlannedAction(done, 'n1', { doneAt: 'x', doneActionId: 'act2' })[0].doneActionId === 'act1');
  const cancelled = cancelPendingAction([...created.planned, pa({ id: 'other', leadId: 'l2' })], 'l1');
  check('annuler : status annulee, JAMAIS supprimée, autres leads intacts', cancelled.length === 2 && cancelled[0].status === 'annulee' && cancelled[1].status === 'a_faire');
}

section('Reprise des prochaines actions existantes (idempotente, sans perte)');
{
  const leads = [
    lead({ id: 'a', commercialId: 'tom', nextActionType: 'appel', nextActionDate: '2026-09-02' }),
    lead({ id: 'b', commercialId: 'na', nextActionType: 'devis', nextActionDate: '2026-09-30', nextActionTime: '10:00', nextActionEndTime: '11:00' }),
    lead({ id: 'c' }), // pas de prochaine action
    lead({ id: 'd', nextActionType: 'relance', nextActionDate: '2026-09-05' }), // déjà repris
  ];
  const existing = [pa({ id: 'pa-reprise-d', leadId: 'd' })];
  const out = migrateLegacyNextActions(leads, existing);
  check('2 reprises (lead sans action et lead déjà repris ignorés)', out.length === 2 && out.map(p => p.leadId).join() === 'a,b');
  check('id déterministe', out[0].id === legacyPlannedId('a') && out[0].id === 'pa-reprise-a');
  check('champs repris à l\'identique (type, date, heures, originalDate)', out[1].type === 'devis' && out[1].date === '2026-09-30' && out[1].time === '10:00' && out[1].endTime === '11:00' && out[1].originalDate === '2026-09-30');
  check('responsable = commercial du lead, tel quel (même « Non attribué »)', out[1].people.length === 1 && out[1].people[0].commercialId === 'na' && out[1].people[0].role === 'responsable');
  check('à faire', out.every(p => p.status === 'a_faire'));
  check('rejouer la reprise ne crée rien', migrateLegacyNextActions(leads, [...existing, ...out]).length === 0);
  check('résumé recalculé = champs d\'origine (aucune perte)', leads.slice(0, 2).every(l => {
    const s = withNextActionSummary(l, out);
    return s === l; // même référence : rien ne change sur le lead
  }));
}

section('Traces : ni dernière action, ni objectifs');
{
  const report = buildReportEntry({ id: 'r', previous: pa(), newDate: '2026-09-21', authorId: 'tom', today: TODAY });
  check('trace report -> non réalisée', !isRealizedAction(report) && isRealizedAction({}) && isRealizedAction({ kind: 'realisee' }));
  const actions: LeadAction[] = [
    { id: '1', leadId: 'l1', type: 'appel', date: '2026-09-10', result: '', notes: '', authorId: 'tom' },
    { ...report, type: 'appel', date: '2026-09-11' },
    { id: '3', leadId: 'l1', type: 'appel', date: '2026-09-12', result: '', notes: '', authorId: 'tom', kind: 'sans_suite' },
    { id: '4', leadId: 'l1', type: 'appel', date: '2026-09-13', result: '', notes: '', authorId: 'tom', kind: 'realisee' },
  ];
  check('objectifs : seules les 2 réalisées comptent', countActions(actions, 'tom', 2026, 9, ['appel']) === 2);
}

section('Appel : puces de résultat (toutes = action réalisée)');
{
  check('5 puces, dans l\'ordre', CALL_RESULTS.map(r => r.value).join(' · ') === 'Joint · Message laissé · Pas de réponse · Rappel demandé · Mauvais numéro');
  check('aucune puce choisie -> refus', validateCallEntry(null, 'Client très intéressé').some(e => e.includes('résultat')));
  check('puce inconnue -> refus', validateCallEntry('Messagerie', 'Client très intéressé').length > 0);
  check('Joint : note obligatoire', validateCallEntry('Joint', '').length > 0 && validateCallEntry('Joint', 'OK').length > 0 && validateCallEntry('Joint', 'Client intéressé').length === 0);
  check('Rappel demandé : note obligatoire', validateCallEntry('Rappel demandé', '  ').length > 0 && validateCallEntry('Rappel demandé', 'Rappeler jeudi matin').length === 0);
  check('Message laissé / Pas de réponse / Mauvais numéro : note facultative',
    ['Message laissé', 'Pas de réponse', 'Mauvais numéro'].every(r => validateCallEntry(r, '').length === 0 && validateCallEntry(r, 'OK').length === 0));
  check('libellé d\'historique', callResultLabel('Pas de réponse') === 'Appel — Pas de réponse');

  for (const r of ['Pas de réponse', 'Message laissé', 'Mauvais numéro'] as const) {
    const act = { id: `call-${r}`, ...buildCommunicationAction(lead(), 'appel', '2026-09-15', { result: callResultLabel(r), notes: '' }) };
    const s = reducer(state(), { type: 'ADD_ACTION', payload: act });
    check(`« ${r} » : réalisée, dernière action mise à jour, compte dans les objectifs`,
      isRealizedAction(s.actions[0]) && s.leads[0].lastActionDate === '2026-09-15' && countActions(s.actions, 'tom', 2026, 9, ['appel']) === 1);
  }
}

section('Reducer : programmer, reporter, réaliser, « Aucune »');
{
  const ids = (n: string) => ({ plannedId: `p-${n}`, reportEntryId: `r-${n}` });
  let s = state();
  s = reducer(s, { type: 'PLAN_NEXT_ACTION', payload: { leadId: 'l1', input: input({ time: '10:00' }), authorId: 'tom', today: TODAY, ids: ids('1') } });
  check('PLAN : 1 action programmée, résumé posé', s.plannedActions.length === 1 && s.leads[0].nextActionDate === '2026-09-20' && s.leads[0].nextActionTime === '10:00');
  check('PLAN : aucune ligne d\'historique, dernière action inchangée', s.actions.length === 0 && s.leads[0].lastActionDate === '2026-09-10');

  s = reducer(s, { type: 'PLAN_NEXT_ACTION', payload: { leadId: 'l1', input: input({ date: '2026-09-24' }), authorId: 'fred', today: TODAY, ids: ids('2') } });
  check('reprogrammer : toujours UNE action, même id', s.plannedActions.length === 1 && s.plannedActions[0].id === 'p-1');
  check('reprogrammer : trace report dans l\'historique', s.actions.length === 1 && s.actions[0].kind === 'report' && s.actions[0].authorId === 'fred');
  check('trace : dernière action NON modifiée', s.leads[0].lastActionDate === '2026-09-10');
  check('résumé suit la nouvelle date', s.leads[0].nextActionDate === '2026-09-24' && s.leads[0].nextActionTime === undefined);

  s = reducer(s, { type: 'RESCHEDULE_PLANNED_ACTION', payload: { plannedId: 'p-1', date: '2026-09-26', time: '09:00', authorId: 'tom', today: TODAY, reportEntryId: 'r-3' } });
  check('RESCHEDULE : date + trace + résumé', s.plannedActions[0].date === '2026-09-26' && s.actions.length === 2 && s.leads[0].nextActionDate === '2026-09-26');

  s = reducer(s, { type: 'COMPLETE_PLANNED_ACTION', payload: { plannedId: 'p-1', action: { id: 'done-1', leadId: 'l1', type: 'appel', date: '2026-09-26', result: 'Rappelé', notes: 'Intéressé', authorId: 'tom' }, doneAt: '2026-09-26T09:10:00Z' } });
  check('COMPLETE : action faite, liée', s.plannedActions[0].status === 'faite' && s.plannedActions[0].doneActionId === 'done-1');
  check('COMPLETE : historique « realisee » lié, dernière action mise à jour', s.actions[0].id === 'done-1' && s.actions[0].kind === 'realisee' && s.actions[0].plannedActionId === 'p-1' && s.leads[0].lastActionDate === '2026-09-26');
  check('COMPLETE : plus rien à faire -> résumé vidé', s.leads[0].nextActionDate === '' && s.leads[0].nextActionType === '');
  const again = reducer(s, { type: 'COMPLETE_PLANNED_ACTION', payload: { plannedId: 'p-1', action: { id: 'done-2', leadId: 'l1', type: 'appel', date: '2026-09-26', result: '', notes: '', authorId: 'tom' }, doneAt: 'x' } });
  check('COMPLETE deux fois : sans effet (même state)', again === s);

  s = reducer(s, { type: 'PLAN_NEXT_ACTION', payload: { leadId: 'l1', input: input({ date: '2026-10-01' }), authorId: 'tom', today: TODAY, ids: ids('4') } });
  check('après « Fait », nouvelle action à faire (l\'ancienne reste faite)', s.plannedActions.length === 2 && s.plannedActions.filter(p => p.status === 'a_faire').length === 1);
  const actionsBefore = s.actions.length;
  s = reducer(s, { type: 'SET_NO_NEXT_ACTION', payload: { leadId: 'l1', reason: 'A acheté ailleurs', authorId: 'tom', today: TODAY, at: '2026-09-26T09:20:00Z', entryId: 'ns-1' } });
  check('AUCUNE : action à faire annulée (pas supprimée)', s.plannedActions.length === 2 && s.plannedActions.every(p => p.status !== 'a_faire'));
  check('AUCUNE : motif sur le lead, résumé vidé', s.leads[0].noNextActionReason === 'A acheté ailleurs' && s.leads[0].nextActionDate === '');
  check('AUCUNE : trace sans_suite, dernière action inchangée', s.actions.length === actionsBefore + 1 && s.actions[0].kind === 'sans_suite' && s.leads[0].lastActionDate === '2026-09-26');
  s = reducer(s, { type: 'PLAN_NEXT_ACTION', payload: { leadId: 'l1', input: input({ date: '2026-11-01' }), authorId: 'tom', today: TODAY, ids: ids('5') } });
  check('programmer ensuite : le motif EXPIRE', s.leads[0].noNextActionReason === '' && s.leads[0].nextActionDate === '2026-11-01');
  check('lead inconnu : sans effet', reducer(s, { type: 'PLAN_NEXT_ACTION', payload: { leadId: 'zzz', input: input(), authorId: 'tom', today: TODAY, ids: ids('6') } }) === s);
}

section('Reducer : écrans existants rebranchés sur le modèle (aucune perte)');
{
  let s = state({ leads: [lead({ commercialId: 'fred' })] });
  s = reducer(s, { type: 'SET_NEXT_ACTION', payload: { id: 'l1', nextActionType: 'rdv', nextActionDate: '2026-09-21', nextActionTime: '14:00' }, plan: { plannedId: 'sn-1', reportEntryId: 'sr-1' } });
  check('éditeur « Prochaine action » : action programmée créée, responsable = commercial du lead', s.plannedActions.length === 1 && s.plannedActions[0].id === 'sn-1' && s.plannedActions[0].people[0].commercialId === 'fred');
  check('éditeur : résumé identique à l\'ancien comportement', s.leads[0].nextActionType === 'rdv' && s.leads[0].nextActionDate === '2026-09-21' && s.leads[0].nextActionTime === '14:00');
  s = reducer(s, { type: 'SET_NEXT_ACTION', payload: { id: 'l1', nextActionType: 'rdv', nextActionDate: '2026-09-28', nextActionTime: '14:00' }, plan: { plannedId: 'sn-2', reportEntryId: 'sr-2' } });
  check('agenda (glisser) : même action, trace report', s.plannedActions.length === 1 && s.actions.some(a => a.id === 'sr-2' && a.kind === 'report'));
  s = reducer(s, { type: 'SET_NEXT_ACTION', payload: { id: 'l1', nextActionType: '', nextActionDate: '' }, plan: { plannedId: 'sn-3', reportEntryId: 'sr-3' } });
  check('effacer : action annulée (pas supprimée), résumé vide', s.plannedActions.length === 1 && s.plannedActions[0].status === 'annulee' && s.leads[0].nextActionDate === '');

  let t = state({ leads: [lead({ commercialId: 'na' })] });
  t = reducer(t, { type: 'ADD_ACTION', payload: { id: 'aa', leadId: 'l1', type: 'appel', date: '2026-09-16', result: 'OK', notes: '', authorId: 'tom', nextActionType: 'relance', nextActionDate: '2026-09-19' }, plan: { plannedId: 'ap-1', reportEntryId: 'ar-1' } });
  check('formulaire d\'action avec prochaine action : programmée', t.plannedActions.length === 1 && t.leads[0].nextActionDate === '2026-09-19' && t.leads[0].lastActionDate === '2026-09-16');
  check('lead « Non attribué » (écran existant) : commercial du lead gardé tel quel', t.plannedActions[0].people[0].commercialId === 'na');

  let u = state();
  u = reducer(u, { type: 'UPDATE_LEAD', payload: { id: 'l1', data: { firstName: 'Paul', nextActionType: 'visite', nextActionDate: '2026-09-23' } } });
  check('formulaire de lead avec prochaine action : programmée + autres champs écrits', u.plannedActions.length === 1 && u.leads[0].firstName === 'Paul' && u.leads[0].nextActionDate === '2026-09-23');
  const u2 = reducer(u, { type: 'UPDATE_LEAD', payload: { id: 'l1', data: { firstName: 'Pierre', nextActionType: 'visite', nextActionDate: '2026-09-23' } } });
  check('formulaire sans changement de prochaine action : aucune nouvelle action ni trace', u2.plannedActions.length === 1 && u2.actions.length === 0 && u2.leads[0].firstName === 'Pierre');

  const trace = reducer(state(), { type: 'ADD_ACTION', payload: { id: 't', leadId: 'l1', type: 'note', date: '2026-09-20', result: '', notes: '', authorId: 'tom', kind: 'report' } });
  check('ADD_ACTION d\'une trace : dernière action NON modifiée', trace.leads[0].lastActionDate === '2026-09-10');

  const del = reducer(state({ plannedActions: [pa(), pa({ id: 'o', leadId: 'l2' })] }), { type: 'DELETE_LEAD', payload: 'l1' });
  check('DELETE_LEAD : ses actions programmées suivent (cascade), les autres restent', del.plannedActions.length === 1 && del.plannedActions[0].leadId === 'l2');
  const legacyServer = { ...state(), plannedActions: undefined } as unknown as AppState;
  check('SET_STATE d\'un serveur d\'avant le lot 2 : plannedActions = []', Array.isArray(reducer(state(), { type: 'SET_STATE', payload: legacyServer }).plannedActions));
}

section('Arrêt 2 — quel point d\'entrée ouvre quelle fenêtre');
{
  const ALL = LEAD_STATUSES.map(s => s.value) as LeadStatus[];
  const p = (e: Parameters<typeof nextActionDecision>[0]) => nextActionDecision(e).prompt;
  const ACTIVE_OTHERS: LeadStatus[] = ['nouveau', 'a_contacter', 'contacte', 'qualifie', 'devis_envoye', 'negociation', 'en_conclusion'];

  check('« + Action » sans changement de statut -> obligatoire, NON fermable', JSON.stringify(p({ kind: 'action_enregistree', currentStatus: 'contacte' })) === JSON.stringify({ mode: 'obligatoire', closable: false }));
  check('« + Action » qui passe en Reporté -> reprise', p({ kind: 'action_enregistree', newStatus: 'reporte', currentStatus: 'contacte' })?.mode === 'reprise');
  check('« + Action » qui passe en Signé / Perdu -> passable', p({ kind: 'action_enregistree', newStatus: 'signe', currentStatus: 'negociation' })?.mode === 'passable' && p({ kind: 'action_enregistree', newStatus: 'perdu', currentStatus: 'contacte' })?.mode === 'passable');
  check('« + Action » même si une action est déjà à faire : la fenêtre s\'ouvre (pré-remplie)', p({ kind: 'action_enregistree', currentStatus: 'qualifie' }) !== null);
  check('appel enregistré (note) -> fenêtre, non fermable', p({ kind: 'appel_enregistre', currentStatus: 'nouveau' })?.closable === false);
  check('message confirmé « Oui » -> fenêtre, non fermable', p({ kind: 'message_confirme', currentStatus: 'contacte' })?.mode === 'obligatoire');
  check('message « Non » -> RIEN', nextActionDecision({ kind: 'message_non_envoye' }).prompt === null);
  check('appel / message sur un lead Reporté -> reprise', p({ kind: 'appel_enregistre', currentStatus: 'reporte' })?.mode === 'reprise' && p({ kind: 'message_confirme', currentStatus: 'reporte' })?.mode === 'reprise');

  for (const s of ALL) {
    const withP = p({ kind: 'statut_change', target: s, hadPendingAction: true });
    const without = p({ kind: 'statut_change', target: s, hadPendingAction: false });
    if (s === 'reporte') check('statut -> Reporté : reprise non fermable, action en cours ou non', withP?.mode === 'reprise' && without?.mode === 'reprise' && withP?.closable === false);
    else if (s === 'signe' || s === 'perdu') check(`statut -> ${s} : passable, action en cours ou non`, withP?.mode === 'passable' && without?.mode === 'passable');
    else if (ACTIVE_OTHERS.includes(s)) check(`statut -> ${s} : AUCUNE fenêtre si action à faire, sinon obligatoire`, withP === null && without?.mode === 'obligatoire' && without?.closable === false);
  }

  check('création manuelle -> obligatoire non fermable', JSON.stringify(p({ kind: 'lead_cree', status: 'nouveau' })) === JSON.stringify({ mode: 'obligatoire', closable: false }));
  check('création directement en Signé -> passable ; en Reporté -> reprise', p({ kind: 'lead_cree', status: 'signe' })?.mode === 'passable' && p({ kind: 'lead_cree', status: 'reporte' })?.mode === 'reprise');
  check('éditeur « Prochaine action » -> FERMABLE', p({ kind: 'editeur_prochaine_action', status: 'contacte' })?.closable === true);
  check('éditeur sur un Reporté -> reprise (« Aucune » interdite) mais fermable', JSON.stringify(p({ kind: 'editeur_prochaine_action', status: 'reporte' })) === JSON.stringify({ mode: 'reprise', closable: true }));
  check('boîte : Rattacher -> rien', nextActionDecision({ kind: 'boite_rattacher' }).prompt === null && !nextActionDecision({ kind: 'boite_rattacher' }).toastPlanifier);
  check('boîte : Rouvrir sans action à faire -> obligatoire', p({ kind: 'boite_rouvrir', hadPendingAction: false })?.mode === 'obligatoire');
  check('boîte : Rouvrir avec une action à faire -> rien (règle 4)', p({ kind: 'boite_rouvrir', hadPendingAction: true }) === null);
  const accept = nextActionDecision({ kind: 'boite_accepter' });
  check('boîte : Accepter -> PAS de fenêtre, toast « Planifier »', accept.prompt === null && accept.toastPlanifier === true);
  check('toast « Planifier » -> fenêtre fermable', p({ kind: 'toast_planifier', status: 'nouveau' })?.closable === true);
  check('agenda (créer, reporter) -> pas de fenêtre à l\'arrêt 2', nextActionDecision({ kind: 'agenda_creer' }).prompt === null && nextActionDecision({ kind: 'agenda_reporter' }).prompt === null);
  check('aucune fenêtre NON fermable ne peut être « passable » hors Signé / Perdu',
    ALL.every(s => { const x = p({ kind: 'action_enregistree', currentStatus: s }); return x?.mode !== 'passable' || s === 'signe' || s === 'perdu'; }));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais actions programmées : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
