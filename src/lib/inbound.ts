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

// ---------------------------------------------------------------------------
// Présentation de la file (lot améliorations, 2026-07-30) — cœur PUR, testé par
// scripts/harness-inbound.ts.
// ---------------------------------------------------------------------------

/**
 * Titre d'une carte : QUI écrit. C'était l'information la plus importante de
 * l'écran et la seule à n'être nulle part — elle vivait dans un `<input>` au
 * milieu de la carte, donc impossible de survoler la file.
 *
 * Replis successifs : nom complet -> email extrait -> adresse d'expédition. On ne
 * renvoie jamais une chaîne vide (une carte sans titre est une carte illisible).
 */
export function inboundDisplayName(mail: Pick<InboundEmail, 'extracted' | 'fromAddress'>): string {
  const full = `${mail.extracted.firstName} ${mail.extracted.lastName}`.trim();
  if (full) return full;
  if (mail.extracted.email.trim()) return mail.extracted.email.trim();
  if (mail.fromAddress.trim()) return mail.fromAddress.trim();
  return 'Expéditeur inconnu';
}

/**
 * Date de réception LISIBLE. L'écran affichait `receivedAt` brut, soit
 * « 2026-07-28T11:17:00Z » en mode réel (le collecteur stocke de l'ISO UTC)
 * et « 2026-07-28 10:00 » dans les fixtures de démo : les deux formats sont
 * donc tolérés, et une valeur illisible est rendue telle quelle plutôt que
 * remplacée par « Invalid Date ».
 */
export function parseReceivedAt(receivedAt: string): Date | null {
  const t = Date.parse(receivedAt.includes('T') ? receivedAt : receivedAt.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : new Date(t);
}

/** « il y a 2 h », « il y a 3 j » — la FRAÎCHEUR décide de l'urgence d'un
 *  prospect, bien plus que l'horodatage exact. */
export function formatReceivedAge(receivedAt: string, now: Date): string {
  const d = parseReceivedAt(receivedAt);
  if (!d) return '';
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 0) return '';               // horloge décalée : on n'invente pas
  if (mins < 2) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

/** Date courte « 28/07 à 13:17 » (heure locale). Repli : la chaîne d'origine. */
export function formatReceivedShort(receivedAt: string): string {
  const d = parseReceivedAt(receivedAt);
  if (!d) return receivedAt;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Raisons de score qui FONT BAISSER le score, telles que produites par
 * `src/lib/email/score.ts`. Comparaison par PRÉFIXE : certaines raisons portent
 * un compte variable (« Démarchage probable : … (3 signaux) »).
 *
 * Cette liste duplique des libellés de score.ts — le harnais fait tourner le
 * VRAI `scoreEmail` et exige qu'AUCUNE raison ne ressorte « inconnue », donc
 * ajouter une raison là-bas sans la classer ici casse les tests bruyamment.
 */
const NEGATIVE_REASON_PREFIXES = [
  'Administratif',
  'Pas de téléphone fourni',
  'Format ancien',
  'Réponse via la plateforme uniquement',
  'Notification automatique',
  'Source inconnue',
  'Démarchage probable',
  "Adresse d'entreprise tierce",
  'Adresse email commerciale',
] as const;

/** Raisons qui MONTENT le score (mêmes règles de préfixe). */
const POSITIVE_REASON_PREFIXES = [
  'Format boats.com',
  'Bateau précis',
  'Téléphone + email fournis',
  'LeadSmart',
  'Intention nautique claire',
  'Bateau / marque identifié',
  'Mobile FR personnel',
  'Email personnel',
  'Annonce identifiée',
  'Format récent',
  'Intention claire',
  'Email du prospect fourni',
] as const;

/**
 * Signe d'une raison de score. « Administratif (facture) » et « Téléphone
 * fourni » s'affichaient dans le MÊME gris : impossible de voir d'un coup d'œil
 * pourquoi un score est bas.
 *
 * `inconnu` (repli neutre) plutôt qu'une supposition : mieux vaut un signal
 * sans couleur qu'un signal peint à l'envers.
 */
export function scoreReasonSign(reason: string): 'positif' | 'negatif' | 'inconnu' {
  const r = reason.trim();
  if (!r) return 'inconnu';
  if (NEGATIVE_REASON_PREFIXES.some(p => r.startsWith(p))) return 'negatif';
  return POSITIVE_REASON_PREFIXES.some(p => r.startsWith(p)) ? 'positif' : 'inconnu';
}
