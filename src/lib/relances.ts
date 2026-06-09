import type { Lead } from '../data/types';
import { getLeadRisks, daysSince, type RiskItem } from './utils';

export type FollowUpSeverity = 'danger' | 'warning';

export interface FollowUpLead {
  lead: Lead;
  risks: RiskItem[];
  maxSeverity: FollowUpSeverity;
  days: number; // inactivite : jours depuis la derniere action (ou la creation)
}

/**
 * Selectionne les leads "a relancer" en reutilisant UNIQUEMENT la detection
 * existante (getLeadRisks). Un lead est retenu s'il porte au moins un risque ;
 * getLeadRisks renvoyant [] pour les statuts terminaux (signe/perdu/reporte),
 * ceux-ci sont exclus d'office.
 *
 * Tri (fixe) : urgence puis anciennete.
 *  - severite max d'abord (danger avant warning) ;
 *  - a severite egale, le plus inactif d'abord (days decroissant).
 *
 * Helper pur -> testable au harnais.
 */
export function getFollowUpLeads(leads: Lead[]): FollowUpLead[] {
  const items: FollowUpLead[] = [];

  for (const lead of leads) {
    const risks = getLeadRisks(lead);
    if (risks.length === 0) continue;
    const maxSeverity: FollowUpSeverity = risks.some(r => r.severity === 'danger') ? 'danger' : 'warning';
    items.push({
      lead,
      risks,
      maxSeverity,
      days: daysSince(lead.lastActionDate || lead.createdAt),
    });
  }

  const severityRank = (s: FollowUpSeverity) => (s === 'danger' ? 0 : 1);
  return items.sort((a, b) => {
    if (a.maxSeverity !== b.maxSeverity) return severityRank(a.maxSeverity) - severityRank(b.maxSeverity);
    return b.days - a.days; // plus ancien d'abord
  });
}
