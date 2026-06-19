import type { MonthlyStat } from '../data/types';
import { ACQUISITION_SOURCES_ALL } from '../data/constants';

/**
 * Logique PURE de l'acquisition (lot refonte-acquisition).
 * Sans React, sans I/O -> testable au harnais (scripts/harness-acquisition.ts).
 *
 * UNE seule source de verite par (annee, mois, source) : `monthlyStats`. Le CPL
 * n'est jamais stocke -> DERIVE a la volee (computeCpl) -> aucune incoherence.
 */

/**
 * CPL (cout par lead) DERIVE = budget / leads, arrondi a l'euro.
 * null si non calculable : pas de budget, ou 0 lead (division impossible / vide).
 */
export function computeCpl(budget: number | null, leads: number | null): number | null {
  if (budget === null || budget === undefined) return null;
  if (leads === null || leads === undefined || leads <= 0) return null;
  return Math.round(budget / leads);
}

export interface AcquisitionTotals {
  totalBudget: number;
  totalLeads: number;   // toutes sources confondues (volume)
  paidLeads: number;    // leads des regies seulement (denominateur du CPL)
  cpl: number | null;   // budget total / leads payants (DERIVE)
}

/**
 * Totaux d'un ensemble de lignes (un mois, ou une annee). Logique PURE.
 *
 * CPL moyen = budget total / leads PAYANTS (regies). Les leads des plateformes
 * d'annonces gonflent le volume (totalLeads) mais ne doivent PAS diluer le CPL
 * (pas de budget en face) -> on les exclut du denominateur via `paid`.
 */
export function acquisitionTotals(
  rows: { budget: number | null; leads: number | null; paid?: boolean }[],
): AcquisitionTotals {
  let totalBudget = 0;
  let totalLeads = 0;
  let paidLeads = 0;
  for (const r of rows) {
    totalBudget += r.budget ?? 0;
    totalLeads += r.leads ?? 0;
    if (r.paid) paidLeads += r.leads ?? 0;
  }
  return { totalBudget, totalLeads, paidLeads, cpl: computeCpl(totalBudget, paidLeads) };
}

/**
 * Forme HISTORIQUE d'un volume d'acquisition (avant fusion). Conservee
 * UNIQUEMENT pour migrer les anciens states (lecture). Le modele applicatif ne
 * l'expose plus (cf. mergeAcquisition, appele a l'hydratation).
 */
export interface LegacyAcquisitionVolume {
  id: string;
  source: string;
  month: number;
  year: number;
  leadCount: number;
}

/**
 * Fusionne d'anciens `acquisitionVolumes` dans `monthlyStats`.
 *
 * Chaque volume devient un MonthlyStat { leads: leadCount, budget: null } (les
 * plateformes d'annonces n'ont pas de budget). Les stats existantes sont
 * conservees telles quelles.
 *
 * SANS PERTE et IDEMPOTENT : un volume n'est replie QUE si aucune stat n'existe
 * deja pour le meme (annee, mois, source). Re-executer la migration, ou re-
 * hydrater un state deja migre, ne cree aucun doublon ; en cas de collision la
 * stat existante (qui peut porter un budget) prime sur le volume.
 */
export function mergeAcquisition(
  stats: MonthlyStat[],
  volumes: LegacyAcquisitionVolume[],
): MonthlyStat[] {
  const key = (year: number, month: number, source: string) => `${year}|${month}|${source}`;
  const seen = new Set(stats.map(s => key(s.year, s.month, s.source)));

  const folded: MonthlyStat[] = [];
  for (const v of volumes) {
    const k = key(v.year, v.month, v.source);
    if (seen.has(k)) continue;        // collision -> on garde la stat existante
    seen.add(k);                       // protege aussi des doublons internes aux volumes
    folded.push({
      id: v.id,
      year: v.year,
      month: v.month,
      source: v.source,
      budget: null,
      leads: v.leadCount,
    });
  }

  return [...stats, ...folded];
}

// Sources payantes (regies) : portent un budget -> comptent dans le denominateur
// du CPL. Derive de la liste unifiee pour rester l'unique source de verite.
const PAID_SOURCES = new Set(
  ACQUISITION_SOURCES_ALL.filter(s => s.category === 'regie').map(s => s.name),
);

/** Une source payante (regie) ? (sinon plateforme d'annonces : leads seuls). */
export function isPaidSource(source: string): boolean {
  return PAID_SOURCES.has(source);
}
