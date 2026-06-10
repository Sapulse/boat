/**
 * Harnais de la logique risques / alertes (lot fix/coherence-relances).
 *
 * Execution : npx tsx scripts/harness-risks.ts
 * (hors tsc -b et hors bundle Vite : ce fichier n'est importe par aucun fichier
 * de l'app et scripts/ n'est dans aucun tsconfig.)
 *
 * Couvre :
 *  - N4 : hasPlannedNextAction = source de verite unique — un type SANS date
 *    n'est pas "planifie" ; getAlertLevel et getLeadRisks rendent des verdicts
 *    coherents (plus de lead "Urgence" absent de la vue A relancer).
 *  - N5 : risque "Action planifiee depassee" quand nextActionDate < aujourd'hui
 *    (warning 1-3j de retard, danger au-dela) ; mutuellement exclusif avec le
 *    risque "manquante" (N4).
 *  - Regle v3.4 : une prochaine action planifiee dans le FUTUR suspend les
 *    alertes/risques d'INACTIVITE (hasFutureNextAction), SAUF "lead chaud
 *    inactif" qui reste actif ; isInactiveOverWeek suit la meme regle.
 *    NB fixtures : les cas d'inactivite utilisent nextActionDate = AUJOURD'HUI
 *    (planifiee, ni future ni echue = neutre) — une date future les
 *    suspendrait desormais, c'est precisement la regle testee.
 *  - Non-regression : risques existants (chaud inactif, devis sans relance,
 *    7j/14j sans action, critique) et getFollowUpLeads (pur passe-plat de
 *    getLeadRisks) inchanges.
 */

import { addDays } from 'date-fns';
import {
  getAlertLevel,
  getLeadRisks,
  hasPlannedNextAction,
  hasFutureNextAction,
  isInactiveOverWeek,
  toISODate,
  type RiskItem,
} from '../src/lib/utils';
import { getFollowUpLeads } from '../src/lib/relances';
import type { Lead } from '../src/data/types';

const today = new Date();
const d = (offsetDays: number) => toISODate(addDays(today, offsetDays)); // d(-1) = hier

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

const hasRisk = (risks: RiskItem[], fragment: string) => risks.some(r => r.label.includes(fragment));
const riskSeverity = (risks: RiskItem[], fragment: string) => risks.find(r => r.label.includes(fragment))?.severity;

/**
 * Lead "neutre" : actif, tiede, priorite normale, derniere action AUJOURD'HUI
 * -> aucun risque d'inactivite ; chaque cas n'active que ce qu'il teste.
 */
function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    createdAt: d(-30),
    source: 'Tel',
    commercialId: 'fred',
    firstName: 'Jean',
    lastName: 'Test',
    phone: '06 00 00 00 00',
    email: 'jean.test@email.fr',
    boatType: 'Moteur',
    boatCondition: 'Neuf',
    boatInterest: 'Antares 9',
    brand: 'Beneteau',
    budget: 50000,
    status: 'qualifie',
    contactDate: d(-25),
    quoteAmount: null,
    probability: null,
    currentBoat: '',
    comments: '',
    deliveryDate: '',
    temperature: 'tiede',
    priority: 'normale',
    nextActionType: 'appel',
    nextActionDate: d(7),
    lastActionDate: d(0),
    lossReason: '',
    signedAt: '',
    lostAt: '',
    reportedAt: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Helper hasPlannedNextAction — la definition elle-meme
// ---------------------------------------------------------------------------

section('hasPlannedNextAction — seule la DATE compte');
{
  check('date posee -> planifiee', hasPlannedNextAction(makeLead({ nextActionDate: d(3) })) === true);
  check('type SANS date -> PAS planifiee', hasPlannedNextAction(makeLead({ nextActionType: 'rdv', nextActionDate: '' })) === false);
  check('ni type ni date -> pas planifiee', hasPlannedNextAction(makeLead({ nextActionType: '', nextActionDate: '' })) === false);
}

// ---------------------------------------------------------------------------
// N4 — verdicts coherents getAlertLevel / getLeadRisks
// ---------------------------------------------------------------------------

section('N4 — lead CHAUD avec type mais SANS date : les DEUX signalent (coherents)');
{
  const lead = makeLead({ temperature: 'chaud', nextActionType: 'rdv', nextActionDate: '' });
  const risks = getLeadRisks(lead);
  check("getAlertLevel = 'red'", getAlertLevel(lead) === 'red', `=${getAlertLevel(lead)}`);
  check('risque "Prochaine action sans date" present', hasRisk(risks, 'Prochaine action sans date'));
  check('severite danger (lead chaud)', riskSeverity(risks, 'Prochaine action sans date') === 'danger');
  check('libelle differencie (pas "Aucune prochaine action")', !hasRisk(risks, 'Aucune prochaine action'));
}

section('N4 — lead chaud avec date FUTURE : AUCUN des deux ne signale (coherents)');
{
  const lead = makeLead({ temperature: 'chaud', nextActionType: 'rdv', nextActionDate: d(5) });
  const risks = getLeadRisks(lead);
  check("getAlertLevel = 'none'", getAlertLevel(lead) === 'none', `=${getAlertLevel(lead)}`);
  check('aucun risque "manquante" / "sans date"', !hasRisk(risks, 'sans date') && !hasRisk(risks, 'Aucune prochaine action'));
  check('aucun risque du tout (lead sain)', risks.length === 0, `risks=${JSON.stringify(risks.map(r => r.label))}`);
}

section('N4 — lead tiede sans rien : libelle historique conserve, severite warning');
{
  const risks = getLeadRisks(makeLead({ nextActionType: '', nextActionDate: '' }));
  check('"Aucune prochaine action planifiée" present', hasRisk(risks, 'Aucune prochaine action planifiée'));
  check('severite warning (pas chaud)', riskSeverity(risks, 'Aucune prochaine action') === 'warning');
}

// ---------------------------------------------------------------------------
// N5 — action planifiee echue
// ---------------------------------------------------------------------------

section('N5 — date HIER : risque echu, warning (1-3j de retard)');
{
  const risks = getLeadRisks(makeLead({ nextActionDate: d(-1) }));
  check('risque "dépassée de 1j" present', hasRisk(risks, 'dépassée de 1j'), `risks=${JSON.stringify(risks.map(r => r.label))}`);
  check('severite warning', riskSeverity(risks, 'dépassée') === 'warning');
}

section('N5 — date il y a 3j : encore warning (borne du seuil)');
{
  const risks = getLeadRisks(makeLead({ nextActionDate: d(-3) }));
  check('risque echu present', hasRisk(risks, 'dépassée de 3j'));
  check('severite warning (3j = limite)', riskSeverity(risks, 'dépassée') === 'warning');
}

section('N5 — date il y a 5j : danger (> 3j de retard)');
{
  const risks = getLeadRisks(makeLead({ nextActionDate: d(-5) }));
  check('risque "dépassée de 5j" present', hasRisk(risks, 'dépassée de 5j'));
  check('severite danger', riskSeverity(risks, 'dépassée') === 'danger');
}

section("N5 — date AUJOURD'HUI ou future : pas de risque echu");
{
  check("aujourd'hui -> rien", !hasRisk(getLeadRisks(makeLead({ nextActionDate: d(0) })), 'dépassée'));
  check('future -> rien', !hasRisk(getLeadRisks(makeLead({ nextActionDate: d(10) })), 'dépassée'));
}

section('N5 / N4 — mutuellement exclusifs');
{
  const noDate = getLeadRisks(makeLead({ nextActionType: 'rdv', nextActionDate: '' }));
  check('pas de date -> risque N4, PAS de risque echu', hasRisk(noDate, 'sans date') && !hasRisk(noDate, 'dépassée'));
  const overdue = getLeadRisks(makeLead({ nextActionDate: d(-2) }));
  check('date passee -> risque echu, PAS de risque manquante', hasRisk(overdue, 'dépassée') && !hasRisk(overdue, 'sans date') && !hasRisk(overdue, 'Aucune prochaine action'));
}

// ---------------------------------------------------------------------------
// Non-regression — risques existants inchanges
// ---------------------------------------------------------------------------

section('Non-regression — chaud inactif > 3j');
{
  const risks = getLeadRisks(makeLead({ temperature: 'chaud', lastActionDate: d(-5), nextActionDate: d(7) }));
  check('"Lead chaud inactif depuis 5j" danger', hasRisk(risks, 'chaud inactif depuis 5j') && riskSeverity(risks, 'chaud inactif') === 'danger');
}

section('Non-regression — devis envoye sans relance (fixture neutre : date du jour)');
{
  const w = getLeadRisks(makeLead({ status: 'devis_envoye', lastActionDate: d(-6), nextActionDate: d(0) }));
  check('6j -> warning', riskSeverity(w, 'Devis envoyé sans relance') === 'warning');
  const dgr = getLeadRisks(makeLead({ status: 'devis_envoye', lastActionDate: d(-12), nextActionDate: d(0) }));
  check('12j -> danger', riskSeverity(dgr, 'Devis envoyé sans relance') === 'danger');
}

section('Non-regression — inactivite 7j / 14j (fixture neutre : date du jour)');
{
  const w = getLeadRisks(makeLead({ lastActionDate: d(-8), nextActionDate: d(0) }));
  check('8j -> "Dernière action il y a 8 jours" warning', riskSeverity(w, 'Dernière action il y a 8 jours') === 'warning');
  const dgr = getLeadRisks(makeLead({ lastActionDate: d(-15), nextActionDate: d(0) }));
  check('15j -> "Aucune action depuis 15 jours" danger', riskSeverity(dgr, 'Aucune action depuis 15 jours') === 'danger');
}

section('Non-regression — priorite critique sans action recente (fixture neutre)');
{
  const risks = getLeadRisks(makeLead({ priority: 'critique', lastActionDate: d(-3), nextActionDate: d(0) }));
  check('"Lead critique sans action récente" danger', riskSeverity(risks, 'Lead critique sans action récente') === 'danger');
}

section('Non-regression — statuts terminaux : aucun risque, aucune alerte');
{
  for (const status of ['signe', 'perdu', 'reporte'] as const) {
    const lead = makeLead({ status, nextActionType: '', nextActionDate: '', lastActionDate: d(-30) });
    check(`${status} -> getLeadRisks []`, getLeadRisks(lead).length === 0);
    check(`${status} -> getAlertLevel none`, getAlertLevel(lead) === 'none');
  }
}

section('Non-regression — getAlertLevel inactivite (14j rouge, 7j orange — fixture neutre)');
{
  check('15j sans action -> red', getAlertLevel(makeLead({ lastActionDate: d(-15), nextActionDate: d(0) })) === 'red');
  check('8j sans action -> orange', getAlertLevel(makeLead({ lastActionDate: d(-8), nextActionDate: d(0) })) === 'orange');
  check('0j -> none', getAlertLevel(makeLead({})) === 'none');
}

// ---------------------------------------------------------------------------
// Regle v3.4 — une action FUTURE planifiee suspend l'inactivite (sauf chaud)
// ---------------------------------------------------------------------------

section('v3.4 — helper hasFutureNextAction');
{
  check('date future -> true', hasFutureNextAction(makeLead({ nextActionDate: d(5) })) === true);
  check("date d'aujourd'hui -> false (ne suspend pas)", hasFutureNextAction(makeLead({ nextActionDate: d(0) })) === false);
  check('date passee -> false', hasFutureNextAction(makeLead({ nextActionDate: d(-2) })) === false);
  check('pas de date -> false', hasFutureNextAction(makeLead({ nextActionDate: '' })) === false);
}

section('v3.4 — inactif 9j SANS action future : alerte + risque (inchange)');
{
  const lead = makeLead({ lastActionDate: d(-9), nextActionType: '', nextActionDate: '' });
  check("getAlertLevel = 'orange'", getAlertLevel(lead) === 'orange', `=${getAlertLevel(lead)}`);
  check('risque "Dernière action il y a 9 jours" present', hasRisk(getLeadRisks(lead), 'Dernière action il y a 9 jours'));
}

section('v3.4 — LE FIX : inactif 9j AVEC action future J+5 -> plus aucune alerte/risque d\'inactivite');
{
  const lead = makeLead({ lastActionDate: d(-9), nextActionType: 'rdv', nextActionDate: d(5) });
  const risks = getLeadRisks(lead);
  check("getAlertLevel = 'none' (plus d'orange)", getAlertLevel(lead) === 'none', `=${getAlertLevel(lead)}`);
  check('aucun risque du tout (suspension complete)', risks.length === 0, JSON.stringify(risks.map(r => r.label)));

  const lead16 = makeLead({ lastActionDate: d(-16), nextActionDate: d(5) });
  check('16j + action future -> none (rouge suspendu aussi)', getAlertLevel(lead16) === 'none');
  check('pas de "Aucune action depuis"', !hasRisk(getLeadRisks(lead16), 'Aucune action depuis'));
}

section("v3.4 — L'EXCEPTION : lead CHAUD inactif 9j AVEC action future -> reste signale");
{
  const lead = makeLead({ temperature: 'chaud', lastActionDate: d(-9), nextActionType: 'rdv', nextActionDate: d(5) });
  const risks = getLeadRisks(lead);
  check("getAlertLevel = 'orange' (seuils actifs pour un chaud)", getAlertLevel(lead) === 'orange', `=${getAlertLevel(lead)}`);
  check('risque "Lead chaud inactif depuis 9j" danger present', riskSeverity(risks, 'chaud inactif depuis 9j') === 'danger');
  check('mais risque generique "Dernière action" suspendu (porte par le risque chaud)', !hasRisk(risks, 'Dernière action il y a'));
  const lead15 = makeLead({ temperature: 'chaud', lastActionDate: d(-15), nextActionDate: d(5) });
  check('chaud 15j + future -> red (seuils complets)', getAlertLevel(lead15) === 'red');
}

section('v3.4 — devis / critique suspendus par une action future');
{
  const devis = getLeadRisks(makeLead({ status: 'devis_envoye', lastActionDate: d(-8), nextActionDate: d(5) }));
  check('devis 8j + future -> pas de risque devis', !hasRisk(devis, 'Devis envoyé sans relance'));
  const crit = getLeadRisks(makeLead({ priority: 'critique', lastActionDate: d(-4), nextActionDate: d(5) }));
  check('critique 4j + future -> pas de risque critique', !hasRisk(crit, 'Lead critique'));
}

section('v3.4 — une date PASSEE (echue) ne suspend RIEN : echu + inactivite cumulables');
{
  const lead = makeLead({ lastActionDate: d(-9), nextActionDate: d(-2) });
  const risks = getLeadRisks(lead);
  check('risque "dépassée de 2j" present (inchange)', hasRisk(risks, 'dépassée de 2j'));
  check('risque "Dernière action il y a 9 jours" AUSSI present', hasRisk(risks, 'Dernière action il y a 9 jours'));
  check("getAlertLevel = 'orange' (inactivite non suspendue)", getAlertLevel(lead) === 'orange');
}

section('v3.4 — isInactiveOverWeek coherent avec la regle');
{
  check('9j sans plan -> inactif', isInactiveOverWeek(makeLead({ lastActionDate: d(-9), nextActionType: '', nextActionDate: '' })) === true);
  check('9j + action future -> PLUS inactif (le fix)', isInactiveOverWeek(makeLead({ lastActionDate: d(-9), nextActionDate: d(5) })) === false);
  check('9j + date passee (echue) -> toujours inactif', isInactiveOverWeek(makeLead({ lastActionDate: d(-9), nextActionDate: d(-2) })) === true);
  check("9j + date d'aujourd'hui -> toujours inactif (pas future)", isInactiveOverWeek(makeLead({ lastActionDate: d(-9), nextActionDate: d(0) })) === true);
}

// ---------------------------------------------------------------------------
// getFollowUpLeads — beneficie des 2 fixes sans modification
// ---------------------------------------------------------------------------

section('getFollowUpLeads — passe-plat de getLeadRisks');
{
  const onlyOverdue = makeLead({ id: 'overdue', nextActionDate: d(-2) }); // seul risque : echu (warning)
  const typeNoDate = makeLead({ id: 'no-date', temperature: 'chaud', nextActionType: 'rdv', nextActionDate: '' }); // N4 danger
  const healthy = makeLead({ id: 'healthy' });
  const terminal = makeLead({ id: 'done', status: 'signe' });

  const list = getFollowUpLeads([onlyOverdue, typeNoDate, healthy, terminal]);
  const ids = list.map(i => i.lead.id);

  check('lead uniquement "echu" present (N5 propage)', ids.includes('overdue'));
  check('lead chaud type-sans-date present (N4 propage — plus d\'angle mort)', ids.includes('no-date'));
  check('lead sain absent', !ids.includes('healthy'));
  check('statut terminal exclu', !ids.includes('done'));
  check('tri urgence : danger (no-date) avant warning (overdue)', ids.indexOf('no-date') < ids.indexOf('overdue'));
  check('maxSeverity correcte sur le lead echu', list.find(i => i.lead.id === 'overdue')?.maxSeverity === 'warning');
}

// ---------------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais risques : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
