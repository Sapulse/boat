/**
 * Harnais objectifs commerciaux (lot page-objectifs-commerciaux, etape 1).
 *
 * Execution : npx tsx scripts/harness-goals.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre la logique PURE (lib/goals) — le coeur reutilisable au backend :
 *  - appartenance au mois (comparaison chaine "YYYY-MM") ;
 *  - comptage actions par type/commercial/mois (appels, relances message inclus,
 *    RDV/visites) ;
 *  - CA signe (quoteAmount ?? budget, signedAt du mois) ;
 *  - taux de transformation (signes/(signes+perdus) sur dates terminales du mois) ;
 *  - realise auto + override manuel qui prime ;
 *  - % de realisation + code couleur (vert>=100 / orange>=70 / rouge<70).
 */

import {
  isInMonth,
  countActions,
  sumSignedRevenue,
  conversionRate,
  computeAutoRealized,
  applyOverrides,
  progressPct,
  progressLevel,
  CALL_TYPES,
  FOLLOWUP_TYPES,
  MEETING_TYPES,
} from '../src/lib/goals';
import type { Lead, LeadAction, CommercialGoal, GoalMetric, GoalRealized } from '../src/data/types';

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

function act(over: Partial<LeadAction> = {}): LeadAction {
  return { id: 'a', leadId: 'l', type: 'appel', date: '2026-06-10', result: '', notes: '', authorId: 'fred', ...over };
}
function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l', createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
    firstName: 'A', lastName: 'B', phone: '', email: '',
    boatType: '', boatCondition: '', boatInterest: '', brand: '',
    budget: null, status: 'nouveau', contactDate: '', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '',
    temperature: 'tiede', priority: 'normale', nextActionType: '', nextActionDate: '',
    lastActionDate: '', lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
    ...over,
  };
}
function metric(target: number | null = null, override: number | null = null): GoalMetric {
  return { target, override };
}
function makeGoal(over: Partial<CommercialGoal> = {}): CommercialGoal {
  return {
    id: 'g', commercialId: 'fred', year: 2026, month: 6,
    calls: metric(), followups: metric(), meetings: metric(), revenue: metric(), conversionRate: metric(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
section('isInMonth — comparaison chaine "YYYY-MM"');
{
  check('date du mois -> true', isInMonth('2026-06-10', 2026, 6) === true);
  check('mois sur 1 chiffre zero-padde', isInMonth('2026-03-01', 2026, 3) === true);
  check('autre mois -> false', isInMonth('2026-07-01', 2026, 6) === false);
  check('autre annee -> false', isInMonth('2025-06-10', 2026, 6) === false);
  check('vide / null -> false', isInMonth('', 2026, 6) === false && isInMonth(null, 2026, 6) === false);
  check('mapping types figes', CALL_TYPES.join() === 'appel'
    && FOLLOWUP_TYPES.join() === 'relance,email,sms,whatsapp'
    && MEETING_TYPES.join() === 'rdv,visite');
}

// ---------------------------------------------------------------------------
section('countActions — par type / commercial / mois');
{
  const actions: LeadAction[] = [
    act({ type: 'appel' }),
    act({ type: 'appel' }),
    act({ type: 'appel', authorId: 'tom' }),     // autre commercial
    act({ type: 'appel', date: '2026-05-30' }),  // autre mois
    act({ type: 'relance' }),
    act({ type: 'email' }),
    act({ type: 'sms' }),
    act({ type: 'whatsapp' }),
    act({ type: 'rdv' }),
    act({ type: 'visite' }),
    act({ type: 'devis' }),                      // ne compte nulle part
    act({ type: 'note' }),                        // ne compte nulle part
  ];
  check('appels = 2 (fred, juin, type appel)', countActions(actions, 'fred', 2026, 6, CALL_TYPES) === 2,
    `${countActions(actions, 'fred', 2026, 6, CALL_TYPES)}`);
  check('relances = 4 (relance+email+sms+whatsapp)', countActions(actions, 'fred', 2026, 6, FOLLOWUP_TYPES) === 4,
    `${countActions(actions, 'fred', 2026, 6, FOLLOWUP_TYPES)}`);
  check('RDV/visites = 2', countActions(actions, 'fred', 2026, 6, MEETING_TYPES) === 2);
  check('devis/note exclus des indicateurs', countActions(actions, 'fred', 2026, 6, ['appel', 'relance', 'email', 'sms', 'whatsapp', 'rdv', 'visite']) === 8);
  check('autre commercial isole', countActions(actions, 'tom', 2026, 6, CALL_TYPES) === 1);
}

// ---------------------------------------------------------------------------
section('sumSignedRevenue — CA signe du mois');
{
  const leads: Lead[] = [
    makeLead({ status: 'signe', signedAt: '2026-06-15', quoteAmount: 50000 }),
    makeLead({ status: 'signe', signedAt: '2026-06-20', quoteAmount: null, budget: 30000 }), // fallback budget
    makeLead({ status: 'signe', signedAt: '2026-05-10', quoteAmount: 99999 }),               // autre mois
    makeLead({ status: 'negociation', quoteAmount: 80000 }),                                  // pas signe
    makeLead({ status: 'signe', signedAt: '2026-06-01', quoteAmount: 10000, commercialId: 'tom' }), // autre commercial
  ];
  check('CA = 50000 + 30000 = 80000', sumSignedRevenue(leads, 'fred', 2026, 6) === 80000,
    `${sumSignedRevenue(leads, 'fred', 2026, 6)}`);
  check('quoteAmount null -> fallback budget', sumSignedRevenue([leads[1]], 'fred', 2026, 6) === 30000);
  check('autre commercial isole', sumSignedRevenue(leads, 'tom', 2026, 6) === 10000);
}

// ---------------------------------------------------------------------------
section('conversionRate — signes/(signes+perdus) sur dates terminales du mois');
{
  const leads: Lead[] = [
    makeLead({ status: 'signe', signedAt: '2026-06-05' }),
    makeLead({ status: 'signe', signedAt: '2026-06-25' }),
    makeLead({ status: 'perdu', lostAt: '2026-06-10' }),
    makeLead({ status: 'perdu', lostAt: '2026-05-10' }),  // perdu autre mois -> hors denom
    makeLead({ status: 'nouveau' }),                       // en cours -> ni num ni denom
  ];
  check('2 signes / (2 + 1 perdu) = 66.7%', conversionRate(leads, 'fred', 2026, 6) === 66.7,
    `${conversionRate(leads, 'fred', 2026, 6)}`);
  check('aucun lead terminal ce mois -> null', conversionRate([makeLead({ status: 'nouveau' })], 'fred', 2026, 6) === null);
  check('100% si que des signes', conversionRate([makeLead({ status: 'signe', signedAt: '2026-06-01' })], 'fred', 2026, 6) === 100);
}

// ---------------------------------------------------------------------------
section('computeAutoRealized + applyOverrides (override prime)');
{
  const actions: LeadAction[] = [act({ type: 'appel' }), act({ type: 'relance' })];
  const leads: Lead[] = [makeLead({ status: 'signe', signedAt: '2026-06-10', quoteAmount: 12000 })];
  const auto = computeAutoRealized(actions, leads, 'fred', 2026, 6);
  check('auto.calls = 1', auto.calls === 1);
  check('auto.followups = 1', auto.followups === 1);
  check('auto.revenue = 12000', auto.revenue === 12000);
  check('auto.conversionRate = 100', auto.conversionRate === 100);

  // override sur calls : prime sur l'auto ; les autres restent auto.
  const g = makeGoal({ calls: metric(40, 35) });
  const eff = applyOverrides(auto, g);
  check('override calls prime (35 au lieu de 1)', eff.calls === 35);
  check('followups reste auto (1)', eff.followups === 1);

  // override null -> auto ; goal absent -> auto.
  check('override null -> auto', applyOverrides(auto, makeGoal({ calls: metric(40, null) })).calls === 1);
  check('goal absent -> auto', applyOverrides(auto, undefined).calls === 1);
}

// ---------------------------------------------------------------------------
section('progressPct + progressLevel (vert>=100 / orange>=70 / rouge<70)');
{
  check('30/40 = 75%', progressPct(30, 40) === 75);
  check('pas d\'objectif (target null) -> null', progressPct(30, null) === null);
  check('objectif 0 -> null (pas de division)', progressPct(30, 0) === null);
  check('realise null -> null', progressPct(null, 40) === null);

  check('100% -> vert', progressLevel(100) === 'vert');
  check('120% -> vert', progressLevel(120) === 'vert');
  check('70% -> orange', progressLevel(70) === 'orange');
  check('69.9% -> rouge', progressLevel(69.9) === 'rouge');
  check('pas d\'objectif -> null', progressLevel(null) === null);

  // chaine de bout en bout sur un realise type GoalRealized
  const r: GoalRealized = { calls: 30, followups: 10, meetings: 4, revenue: 50000, conversionRate: 40 };
  check('bout-en-bout : 30 appels / cible 40 -> 75% orange',
    progressLevel(progressPct(r.calls, 40)) === 'orange');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais objectifs : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
