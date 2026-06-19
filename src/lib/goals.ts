import type { Lead, LeadAction, ActionType, CommercialGoal } from '../data/types';
import { PROSPECTION_SOURCES } from '../data/constants';

/**
 * Logique PURE des objectifs commerciaux (lot page-objectifs-commerciaux).
 * Sans React, sans I/O -> testable au harnais (scripts/harness-goals.ts).
 *
 * C'est le COEUR reutilisable au backend : ces fonctions prennent les donnees en
 * argument (actions / leads). Au backend on ne changera QUE la source de ces
 * donnees (poste -> base partagee), pas les calculs ni l'UI.
 *
 * Conventions de date respectees : dates "YYYY-MM-DD" comparees en CHAINE (aucun
 * parsing Date) -> appartenance a un mois = prefixe "YYYY-MM".
 */

// Mapping ActionType -> indicateur (tranche avec Nicolas).
// RELANCES = TOUT recontact d'un lead existant : appel + relance + message
// (email/sms/whatsapp). UN SEUL compteur -> pas de ligne « appels » separee, pas
// de double comptage. L'appel rejoint donc les relances.
export const FOLLOWUP_TYPES: ActionType[] = ['appel', 'relance', 'email', 'sms', 'whatsapp'];
export const MEETING_TYPES: ActionType[] = ['rdv', 'visite'];

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** La date "YYYY-MM-DD" tombe-t-elle dans (year, month) ? Comparaison en chaine. */
export function isInMonth(isoDate: string | null | undefined, year: number, month: number): boolean {
  return !!isoDate && isoDate.startsWith(monthPrefix(year, month));
}

/** Nombre d'actions d'un commercial dans le mois, parmi les types donnes. */
export function countActions(
  actions: LeadAction[],
  commercialId: string,
  year: number,
  month: number,
  types: ActionType[],
): number {
  const wanted = new Set<ActionType>(types);
  return actions.filter(
    (a) => a.authorId === commercialId && wanted.has(a.type) && isInMonth(a.date, year, month),
  ).length;
}

/** CA signe du mois : somme de quoteAmount ?? budget des leads signes (signedAt du mois). */
export function sumSignedRevenue(
  leads: Lead[],
  commercialId: string,
  year: number,
  month: number,
): number {
  return leads
    .filter(
      (l) =>
        l.commercialId === commercialId &&
        l.status === 'signe' &&
        isInMonth(l.signedAt, year, month),
    )
    .reduce((sum, l) => sum + (l.quoteAmount ?? l.budget ?? 0), 0);
}

/**
 * Taux de transformation du mois (%) = signes / (signes + perdus), base sur la
 * DATE TERMINALE du mois (signedAt / lostAt). null si aucun lead terminal ce
 * mois-la (pas de denominateur). Arrondi a 1 decimale (comme PerformancePage).
 */
export function conversionRate(
  leads: Lead[],
  commercialId: string,
  year: number,
  month: number,
): number | null {
  let signed = 0;
  let lost = 0;
  for (const l of leads) {
    if (l.commercialId !== commercialId) continue;
    if (l.status === 'signe' && isInMonth(l.signedAt, year, month)) signed++;
    else if (l.status === 'perdu' && isInMonth(l.lostAt, year, month)) lost++;
  }
  const denom = signed + lost;
  if (denom === 0) return null;
  return Math.round((signed / denom) * 1000) / 10;
}

// Sources de prospection active (Set pour un test d'appartenance O(1)).
const PROSPECTION_SOURCE_SET = new Set<string>(PROSPECTION_SOURCES);

/**
 * Leads RENTRES dans le mois par PROSPECTION ACTIVE : crees par ce commercial
 * (createdAt du mois) ET dont la source est une source de prospection
 * (PROSPECTION_SOURCES). Le flux entrant (site, annonces, apporteurs…) et les
 * leads sans source ne comptent pas.
 */
export function countLeadsCreated(
  leads: Lead[],
  commercialId: string,
  year: number,
  month: number,
): number {
  return leads.filter(
    (l) =>
      l.commercialId === commercialId &&
      PROSPECTION_SOURCE_SET.has(l.source) &&
      isInMonth(l.createdAt, year, month),
  ).length;
}

export interface GoalRealized {
  prospectsCreated: number;   // leads rentres (auto)
  coldCalls: number;          // appels a froid (manuel : aucune source auto -> 0)
  followups: number;          // relances (appel + relance + email + sms + whatsapp)
  meetings: number;           // rdv + visite
  revenue: number;            // CA signe
  conversionRate: number | null;
}

/** Realise AUTOMATIQUE (compte depuis actions/leads), avant override manuel. */
export function computeAutoRealized(
  actions: LeadAction[],
  leads: Lead[],
  commercialId: string,
  year: number,
  month: number,
): GoalRealized {
  return {
    prospectsCreated: countLeadsCreated(leads, commercialId, year, month),
    coldCalls: 0, // pas de source auto (le prospect demarche n'est pas en base) -> saisi via override
    followups: countActions(actions, commercialId, year, month, FOLLOWUP_TYPES),
    meetings: countActions(actions, commercialId, year, month, MEETING_TYPES),
    revenue: sumSignedRevenue(leads, commercialId, year, month),
    conversionRate: conversionRate(leads, commercialId, year, month),
  };
}

function pickOverride(auto: number | null, metric: { override: number | null } | undefined): number | null {
  if (metric && metric.override !== null && metric.override !== undefined) return metric.override;
  return auto;
}

/**
 * Realise EFFECTIF = override ?? auto, par indicateur. `goal` peut etre absent
 * (commercial sans objectif saisi) -> on renvoie l'auto tel quel.
 */
export function applyOverrides(auto: GoalRealized, goal: CommercialGoal | undefined): GoalRealized {
  return {
    prospectsCreated: pickOverride(auto.prospectsCreated, goal?.prospectsCreated) ?? 0,
    // coldCalls : realise PUREMENT manuel -> override ; a defaut 0 (auto = 0).
    coldCalls: pickOverride(auto.coldCalls, goal?.coldCalls) ?? 0,
    followups: pickOverride(auto.followups, goal?.followups) ?? 0,
    meetings: pickOverride(auto.meetings, goal?.meetings) ?? 0,
    revenue: pickOverride(auto.revenue, goal?.revenue) ?? 0,
    conversionRate: pickOverride(auto.conversionRate, goal?.conversionRate),
  };
}

/**
 * Cible EFFECTIVE d'un indicateur : la SURCHARGE (target du CommercialGoal pour
 * un commercial/mois) si elle est saisie, SINON le DÉFAUT ÉQUIPE. Même patron que
 * l'override du réalisé, appliqué à la cible. La progression doit se baser sur
 * cette cible effective. `0` est une surcharge explicite (exemption) -> prime.
 */
export function effectiveTarget(
  target: number | null | undefined,
  defaultTarget: number | null | undefined,
): number | null {
  if (target !== null && target !== undefined) return target;
  return defaultTarget ?? null;
}

/** % de realisation = realise / objectif * 100. null si pas d'objectif (cible <= 0 ou absente). */
export function progressPct(realized: number | null, target: number | null): number | null {
  if (target === null || target === undefined || target <= 0) return null;
  if (realized === null || realized === undefined) return null;
  return Math.round((realized / target) * 1000) / 10;
}

export type ProgressLevel = 'vert' | 'orange' | 'rouge';

/** Code couleur : vert >= 100 %, orange >= 70 %, rouge < 70 %. null si pas d'objectif. */
export function progressLevel(pct: number | null): ProgressLevel | null {
  if (pct === null || pct === undefined) return null;
  if (pct >= 100) return 'vert';
  if (pct >= 70) return 'orange';
  return 'rouge';
}
