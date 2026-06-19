import type { MonthlyStat, AcquisitionVolume } from '../data/types';

/**
 * Logique PURE de l'acquisition (lot refonte-acquisition, etape 1).
 * Sans React, sans I/O -> testable au harnais (scripts/harness-acquisition.ts).
 *
 * Objectif : UNE seule source de verite par (annee, mois, source). On fusionne
 * les anciens `acquisitionVolumes` (volume de leads des plateformes d'annonces)
 * dans `monthlyStats` (leads + budget des regies). Le CPL n'est plus stocke : il
 * est DERIVE a la volee (computeCpl) -> plus aucune incoherence possible.
 */

/**
 * CPL (cout par lead) DERIVE = budget / leads, arrondi a l'euro.
 * null si non calculable : pas de budget, ou 0 lead (division impossible / vide).
 * Jamais stocke -> ne peut pas diverger de (budget, leads).
 */
export function computeCpl(budget: number | null, leads: number | null): number | null {
  if (budget === null || budget === undefined) return null;
  if (leads === null || leads === undefined || leads <= 0) return null;
  return Math.round(budget / leads);
}

/**
 * Fusionne `acquisitionVolumes` dans `monthlyStats`.
 *
 * Chaque volume devient un MonthlyStat { leads: leadCount, budget: null }
 * (les plateformes d'annonces n'ont pas de budget -> cpl derive = null). Les
 * stats existantes sont conservees telles quelles.
 *
 * SANS PERTE et IDEMPOTENT : un volume n'est replie QUE si aucune stat n'existe
 * deja pour le meme (annee, mois, source). Donc re-executer la migration, ou
 * re-hydrater un state deja migre, ne cree aucun doublon ; en cas de collision,
 * la stat existante (qui peut porter un budget) prime sur le volume.
 */
export function mergeAcquisition(
  stats: MonthlyStat[],
  volumes: AcquisitionVolume[],
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
      cpl: computeCpl(null, v.leadCount), // = null : pas de budget pour une plateforme
    });
  }

  return [...stats, ...folded];
}
