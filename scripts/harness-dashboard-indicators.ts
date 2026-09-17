/**
 * Harnais lot 4 — indicateurs du tableau de bord (src/lib/plannedActions.ts) et
 * paramètres d'URL de l'Agenda (src/lib/agenda.ts).
 *
 * Exécution : npx tsx scripts/harness-dashboard-indicators.ts
 *
 * Décisions du 17/09 :
 *  - a) à faire aujourd'hui : actions des Signés / Perdus INCLUSES ;
 *  - une action à plusieurs = 1 dans le total, 1 chez chaque personne concernée ;
 *  - b) = pastille du menu (countOverdue), c) = vue « À planifier » (needsPlanning) :
 *    une seule source de calcul ;
 *  - c) sans filtre : part des leads non attribués (Non attribué ou commercial inconnu).
 */
import {
  countDueToday, countOverdue, needsPlanning, overdueActions, planningIndicators, isUnassignedLead,
} from '../src/lib/plannedActions';
import { parseAgendaParams, agendaLink } from '../src/lib/agenda';
import type { Commercial, Lead, LeadStatus, PlannedAction } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const TODAY = '2026-09-17';
const COMMERCIALS: Commercial[] = [
  { id: 'tom', name: 'Tom', active: true },
  { id: 'fred', name: 'Fred', active: true },
  { id: 'na', name: 'Non attribué', active: true },
];

function lead(id: string, over: Partial<Lead> = {}): Lead {
  return {
    id, createdAt: '2026-08-01', source: 'LBC', commercialId: 'tom', firstName: 'P', lastName: id,
    phone: '', email: '', boatType: '', boatCondition: '', boatInterest: '', brand: '', budget: null,
    status: 'contacte', contactDate: '', quoteAmount: null, probability: null, currentBoat: '', comments: '',
    deliveryDate: '', temperature: 'neutre', priority: 'normale', nextActionType: '', nextActionDate: '',
    lastActionDate: '2026-09-10', lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
  };
}
function pa(id: string, leadId: string, date: string, people: string[], over: Partial<PlannedAction> = {}): PlannedAction {
  return {
    id, leadId, type: 'appel', customLabel: '', date, originalDate: date, note: '', status: 'a_faire',
    people: people.map((c, i) => ({ commercialId: c, role: i === 0 ? 'responsable' : 'participant' })), ...over,
  };
}
const withStatus = (id: string, status: LeadStatus, over: Partial<Lead> = {}) => lead(id, { status, ...over });

const leads: Lead[] = [
  lead('l1', { nextActionDate: TODAY }),
  withStatus('l2', 'signe', { nextActionDate: TODAY }),
  withStatus('l3', 'perdu', { nextActionDate: '2026-09-10' }),
  lead('l4', { commercialId: 'fred', nextActionDate: '2026-09-15' }),
  withStatus('l5', 'reporte', { nextActionDate: '2026-09-01' }),
  lead('l6', { commercialId: 'fred', nextActionDate: TODAY }),
  lead('l7'),                                        // à planifier (tom)
  lead('l8', { commercialId: 'na' }),                // à planifier (non attribué)
  lead('l9', { commercialId: 'supprime' }),          // à planifier (commercial inconnu)
  lead('l10', { noNextActionReason: 'Attente financement' }), // motif : pas à planifier
  withStatus('l11', 'signe'),                        // fermé : pas à planifier
];
const planned: PlannedAction[] = [
  pa('a1', 'l1', TODAY, ['tom']),
  pa('a2', 'l2', TODAY, ['tom', 'fred']),            // Signé, à plusieurs, aujourd'hui
  pa('a3', 'l3', '2026-09-10', ['tom']),             // Perdu, date passée : pas en retard
  pa('a4', 'l4', '2026-09-15', ['fred', 'tom']),     // retard à deux
  pa('a5', 'l5', '2026-09-01', ['tom']),             // Reporté en retard
  pa('a6', 'l6', TODAY, ['fred']),
  pa('a7', 'l1', TODAY, ['tom'], { status: 'faite' }),
  pa('a8', 'l7', TODAY, ['tom'], { status: 'annulee' }),
  pa('a9', 'disparu', TODAY, ['tom']),               // lead supprimé : ignoré
  pa('a10', 'l6', '2026-09-18', ['fred']),           // futur
];

section("a) À faire aujourd'hui");
check('total : a1, a2 (Signé inclus), a6 = 3', countDueToday(planned, leads, TODAY) === 3, String(countDueToday(planned, leads, TODAY)));
check("Tom : a1 + a2 (participant d'une action à deux) = 2", countDueToday(planned, leads, TODAY, 'tom') === 2);
check("Fred : a2 + a6 = 2 (l'action à deux compte chez chacun)", countDueToday(planned, leads, TODAY, 'fred') === 2);
check('action à deux : 1 dans le total (Tom 2 + Fred 2 ≠ total 3)', countDueToday(planned, leads, TODAY) < countDueToday(planned, leads, TODAY, 'tom') + countDueToday(planned, leads, TODAY, 'fred'));
check('faites, annulées, futures et lead supprimé exclus', countDueToday([planned[6], planned[7], planned[8], planned[9]], leads, TODAY) === 0);

section('b) En retard = pastille du menu');
check('total : a4 + a5 (Perdu exclu, Reporté inclus) = 2', countOverdue(planned, leads, TODAY) === 2);
check("liste du bandeau = compteur, plus ancienne d'abord", overdueActions(planned, leads, TODAY).map(p => p.id).join() === 'a5,a4');
check('Tom : 2 ; Fred : 1 (a4 à deux compte chez chacun)', countOverdue(planned, leads, TODAY, 'tom') === 2 && countOverdue(planned, leads, TODAY, 'fred') === 1);
check('bandeau filtré Fred = compteur Fred', overdueActions(planned, leads, TODAY, 'fred').length === countOverdue(planned, leads, TODAY, 'fred'));
check("aujourd'hui n'est pas en retard", overdueActions(planned, leads, TODAY).every(p => p.date < TODAY));

section('c) À planifier = vue « À planifier » des Leads');
const vueLeads = leads.filter(needsPlanning).map(l => l.id).sort().join();
check('vue : l7, l8, l9', vueLeads === 'l7,l8,l9', vueLeads);
check('non attribué : « Non attribué » et commercial inconnu', isUnassignedLead(leads[7], COMMERCIALS) && isUnassignedLead(leads[8], COMMERCIALS) && !isUnassignedLead(leads[6], COMMERCIALS));

section('planningIndicators : même source que ci-dessus');
const all = planningIndicators(planned, leads, COMMERCIALS, TODAY);
check('tous : 3 / 2 / 3 dont 2 non attribués', all.today === 3 && all.overdue === 2 && all.toPlan === 3 && all.toPlanUnassigned === 2, JSON.stringify(all));
const tom = planningIndicators(planned, leads, COMMERCIALS, TODAY, 'tom');
check('Tom : 2 / 2 / 1, part non attribuée 0', tom.today === 2 && tom.overdue === 2 && tom.toPlan === 1 && tom.toPlanUnassigned === 0, JSON.stringify(tom));
check('c) Tom = vue « À planifier » + filtre commercial Tom', tom.toPlan === leads.filter(needsPlanning).filter(l => l.commercialId === 'tom').length);
const fred = planningIndicators(planned, leads, COMMERCIALS, TODAY, 'fred');
check('Fred : 2 / 1 / 0', fred.today === 2 && fred.overdue === 1 && fred.toPlan === 0, JSON.stringify(fred));
check('base vide : tout à 0', JSON.stringify(planningIndicators([], [], COMMERCIALS, TODAY)) === JSON.stringify({ today: 0, overdue: 0, toPlan: 0, toPlanUnassigned: 0 }));

section("Paramètres d'URL de l'Agenda");
const p = (qs: string) => parseAgendaParams(new URLSearchParams(qs));
check('vue=jour&date&commercial', JSON.stringify(p('vue=jour&date=2026-09-17&commercial=tom')) === JSON.stringify({ vue: 'jour', date: '2026-09-17', commercial: 'tom', retards: false }));
check('retards=1', p('retards=1').retards === true && p('retards=0').retards === false && p('').retards === false);
check('vue inconnue ignorée', p('vue=annee').vue === undefined);
check('date invalide ignorée (format, 31/02)', p('date=17/09/2026').date === undefined && p('date=2026-02-31').date === undefined);
check('commercial vide ignoré', p('commercial=').commercial === undefined);
check('lien a) : Journée du jour filtrée', agendaLink({ vue: 'jour', date: TODAY, commercial: 'tom' }) === '/agenda?vue=jour&date=2026-09-17&commercial=tom');
check('lien b) : retards, sans commercial', agendaLink({ retards: true }) === '/agenda?retards=1');
check('lien sans paramètre', agendaLink({}) === '/agenda');
const back = p(agendaLink({ vue: 'mois', commercial: 'fred', retards: true }).split('?')[1]);
check('aller-retour lien -> lecture', back.vue === 'mois' && back.date === undefined && back.commercial === 'fred' && back.retards === true);

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais indicateurs : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
