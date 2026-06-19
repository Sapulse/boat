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
  countLeadsCreated,
  sumSignedRevenue,
  conversionRate,
  computeAutoRealized,
  applyOverrides,
  progressPct,
  progressLevel,
  FOLLOWUP_TYPES,
  MEETING_TYPES,
} from '../src/lib/goals';
import type { Lead, LeadAction, CommercialGoal, GoalMetric, GoalRealized } from '../src/data/types';
import { SOURCES, PROSPECTION_SOURCES } from '../src/data/constants';

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
    prospectsCreated: metric(), coldCalls: metric(),
    followups: metric(), meetings: metric(), revenue: metric(), conversionRate: metric(),
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
  check('mapping types figes (appel fondu dans relances)',
    FOLLOWUP_TYPES.join() === 'appel,relance,email,sms,whatsapp'
    && MEETING_TYPES.join() === 'rdv,visite');
  // Invariant : toute source de prospection doit exister dans SOURCES (anti-typo).
  check('PROSPECTION_SOURCES ⊆ SOURCES',
    PROSPECTION_SOURCES.every((s) => SOURCES.includes(s)),
    PROSPECTION_SOURCES.filter((s) => !SOURCES.includes(s)).join() || 'ok');
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
  check('relances = 6 (appel + relance + email + sms + whatsapp, appel INCLUS)',
    countActions(actions, 'fred', 2026, 6, FOLLOWUP_TYPES) === 6,
    `${countActions(actions, 'fred', 2026, 6, FOLLOWUP_TYPES)}`);
  check('RDV/visites = 2', countActions(actions, 'fred', 2026, 6, MEETING_TYPES) === 2);
  check('devis/note exclus des indicateurs', countActions(actions, 'fred', 2026, 6, ['appel', 'relance', 'email', 'sms', 'whatsapp', 'rdv', 'visite']) === 8);
  check('autre commercial isole (1 appel tom -> 1 relance)', countActions(actions, 'tom', 2026, 6, FOLLOWUP_TYPES) === 1);
}

// ---------------------------------------------------------------------------
section('countLeadsCreated — leads rentrés par PROSPECTION ACTIVE (source filtrée)');
{
  const leads: Lead[] = [
    makeLead({ createdAt: '2026-06-03', source: 'Passage' }),            // prospection ✓
    makeLead({ createdAt: '2026-06-28', source: 'Démarchage terrain' }), // prospection ✓
    makeLead({ createdAt: '2026-06-15', source: 'LBC' }),                // flux entrant -> exclu
    makeLead({ createdAt: '2026-06-12', source: '' }),                   // sans source -> exclu
    makeLead({ createdAt: '2026-05-31', source: 'Salon GP' }),           // prospection mais autre mois
    makeLead({ createdAt: '2026-06-10', source: 'Recommandation', commercialId: 'tom' }), // autre commercial
  ];
  check('fred : 2 leads de prospection en juin (Passage + Démarchage)',
    countLeadsCreated(leads, 'fred', 2026, 6) === 2, `${countLeadsCreated(leads, 'fred', 2026, 6)}`);
  check('flux entrant (LBC) exclu',
    countLeadsCreated([makeLead({ createdAt: '2026-06-01', source: 'LBC' })], 'fred', 2026, 6) === 0);
  check('sans source exclu',
    countLeadsCreated([makeLead({ createdAt: '2026-06-01', source: '' })], 'fred', 2026, 6) === 0);
  check('tom isolé (1 lead Recommandation)', countLeadsCreated(leads, 'tom', 2026, 6) === 1);
  check('Salon GP de mai ne compte pas en juin (mais bien en mai)',
    countLeadsCreated(leads, 'fred', 2026, 5) === 1);
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
  // 1 lead signé (créé en juin par prospection) + 2 recontacts (appel + relance).
  const actions: LeadAction[] = [act({ type: 'appel' }), act({ type: 'relance' })];
  const leads: Lead[] = [makeLead({ status: 'signe', signedAt: '2026-06-10', quoteAmount: 12000, source: 'Passage' })];
  const auto = computeAutoRealized(actions, leads, 'fred', 2026, 6);
  check('auto.prospectsCreated = 1 (lead de prospection créé en juin)', auto.prospectsCreated === 1);
  check('auto.coldCalls = 0 (manuel : aucune source auto)', auto.coldCalls === 0);
  check('auto.followups = 2 (appel + relance)', auto.followups === 2);
  check('auto.revenue = 12000', auto.revenue === 12000);
  check('auto.conversionRate = 100', auto.conversionRate === 100);

  // coldCalls = réalisé PUREMENT manuel via override ; followups override prime.
  const g = makeGoal({ coldCalls: metric(50, 35), followups: metric(40, 28) });
  const eff = applyOverrides(auto, g);
  check('coldCalls = override (35, réalisé manuel)', eff.coldCalls === 35);
  check('followups override prime (28 au lieu de 2)', eff.followups === 28);
  check('prospectsCreated reste auto (1)', eff.prospectsCreated === 1);

  // override null -> auto ; goal absent -> auto ; coldCalls sans saisie -> 0.
  check('override null -> auto', applyOverrides(auto, makeGoal({ followups: metric(40, null) })).followups === 2);
  check('goal absent -> auto', applyOverrides(auto, undefined).followups === 2);
  check('coldCalls sans override -> 0', applyOverrides(auto, undefined).coldCalls === 0);
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
  const r: GoalRealized = { prospectsCreated: 5, coldCalls: 12, followups: 30, meetings: 4, revenue: 50000, conversionRate: 40 };
  check('bout-en-bout : 30 relances / cible 40 -> 75% orange',
    progressLevel(progressPct(r.followups, 40)) === 'orange');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais objectifs : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
