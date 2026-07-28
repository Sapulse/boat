import type { InboundEmail, Lead } from '../data/types.js';

// Cœur PUR de la boîte de réception prospects (Étape A, maquette) — aucune
// dépendance React, testé par scripts/harness-inbound.ts (même découpage que
// duplicateLeads / toastReducer). La collecte réelle (Étape B) branchera ses
// extracteurs EN AMONT de ces helpers sans les changer : ils ne connaissent
// que des InboundEmail déjà analysés.

// Seuils du score (spec §3) : >= 70 prospect probable, >= 40 à vérifier,
// en dessous parasite probable. Le score TRIE et SIGNALE, il ne décide pas.
export type ScoreLevel = 'prospect' | 'a_verifier' | 'parasite';

export function scoreLevel(score: number): ScoreLevel {
  if (score >= 70) return 'prospect';
  if (score >= 40) return 'a_verifier';
  return 'parasite';
}

// Libellés + classes par niveau (classes en toutes lettres pour le JIT Tailwind,
// même convention que LEAD_STATUSES / TEMPERATURES dans constants.ts).
export const SCORE_LEVELS: Record<ScoreLevel, { label: string; badge: string; bar: string }> = {
  prospect: { label: 'Prospect probable', badge: 'bg-green-100 text-green-800', bar: 'bg-green-500' },
  a_verifier: { label: 'À vérifier', badge: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  parasite: { label: 'Parasite probable', badge: 'bg-red-100 text-red-800', bar: 'bg-red-500' },
};

/** File triée par score décroissant (prospects probables en haut) ; à score égal,
 * le plus récent d'abord (receivedAt "YYYY-MM-DD HH:mm" comparé en chaîne). */
export function sortInboundByScore(emails: InboundEmail[]): InboundEmail[] {
  return [...emails].sort((a, b) => b.score - a.score || b.receivedAt.localeCompare(a.receivedAt));
}

/**
 * Fiche lead pré-remplie depuis un email accepté. Le contexte de l'email
 * (source, objet, message) part dans les commentaires : rien n'est perdu même
 * si l'extraction était partielle. `commercialId` peut être '' (« Non
 * attribué ») — même sentinelle que le filtre NO_COMMERCIAL_FILTER.
 */
export function buildLeadFromInbound(mail: InboundEmail, commercialId: string, todayISO: string): Omit<Lead, 'id'> {
  const via = mail.sourceDetail ? `${mail.sourceLabel} — ${mail.sourceDetail}` : mail.sourceLabel;
  return {
    createdAt: todayISO,
    source: mail.leadSource,
    commercialId,
    firstName: mail.extracted.firstName,
    lastName: mail.extracted.lastName,
    phone: mail.extracted.phone,
    email: mail.extracted.email,
    boatType: '',
    boatCondition: '',
    boatInterest: mail.extracted.boatInterest,
    brand: mail.extracted.brand,
    budget: null,
    status: 'nouveau',
    contactDate: todayISO,
    quoteAmount: null,
    probability: null,
    currentBoat: '',
    comments:
      `Reçu par email (${via}) le ${mail.receivedAt}.\n` +
      `Objet : ${mail.subject}\n\n${mail.excerpt}`,
    deliveryDate: '',
    // Score élevé = acheteur actif identifié -> lead chaud d'emblée ; sinon tiède
    // (le défaut du formulaire manuel).
    temperature: scoreLevel(mail.score) === 'prospect' ? 'chaud' : 'tiede',
    priority: 'normale',
    nextActionType: '',
    nextActionDate: '',
    lastActionDate: '',
    lossReason: '',
    signedAt: '',
    lostAt: '',
    reportedAt: '',
  };
}
