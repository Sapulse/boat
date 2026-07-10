import type { Lead } from '../data/types';

// Détection de doublons de leads (correctif audit #2). AVERTISSEMENT NON
// BLOQUANT uniquement : la base contient des doublons LÉGITIMES (décision
// d'import « tout garder »), donc aucune contrainte d'unicité dure. On se
// contente de prévenir à la création / à l'import, l'utilisateur décide.
//
// Comparaison sur email OU téléphone normalisés (pur -> testable au harnais).

/** Email normalisé : trim + minuscules. '' si vide. */
export function normEmail(email: string | undefined | null): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Téléphone normalisé au numéro national significatif : chiffres seuls, indicatif
 * FR (+33 / 0033) et 0 national retirés -> `06 12 34 56 78`, `+33 6 12 34 56 78`
 * et `0033612345678` deviennent tous `612345678`. '' si vide.
 */
export function normPhone(phone: string | undefined | null): string {
  let d = (phone ?? '').replace(/\D/g, ''); // chiffres seuls
  if (!d) return '';
  if (d.startsWith('0033')) d = d.slice(4);
  else if (d.startsWith('33') && d.length >= 11) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

type Candidate = { email?: string | null; phone?: string | null };

/**
 * Leads existants qui partagent l'email OU le téléphone du candidat. `excludeId`
 * évite qu'un lead se détecte lui-même en édition. Retourne [] si le candidat
 * n'a ni email ni téléphone exploitable.
 */
export function findDuplicateLeads(existing: Lead[], candidate: Candidate, excludeId?: string): Lead[] {
  const e = normEmail(candidate.email);
  const p = normPhone(candidate.phone);
  if (!e && !p) return [];
  return existing.filter(l =>
    l.id !== excludeId && (
      (e !== '' && normEmail(l.email) === e) ||
      (p !== '' && normPhone(l.phone) === p)
    ),
  );
}

/** Nombre de candidats d'un import qui recouvrent un lead déjà en base. */
export function countImportOverlap(candidates: Candidate[], existing: Lead[]): number {
  return candidates.reduce((n, c) => n + (findDuplicateLeads(existing, c).length > 0 ? 1 : 0), 0);
}
