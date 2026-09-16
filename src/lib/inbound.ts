import type { InboundEmail, Lead, LeadStatus } from '../data/types.js';

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
    // TIÈDE, en dur — comme TOUTE autre création de lead (formulaire manuel,
    // import Excel, vCard). Décision de l'équipe (retour terrain 2026-09) : le
    // système ne décide PLUS de la température à la place des commerciaux, qui
    // veulent la poser eux-mêmes. Il n'existe donc plus qu'une seule valeur
    // d'entrée dans tout le CRM, et un lead venu d'un email est un lead comme
    // les autres.
    //
    // Le SCORE, lui, reste entièrement automatique : c'est lui qui trie la file
    // et qui signale les notifications (favoris Leboncoin à 45, cf. lib/email/
    // score.ts). La priorisation n'a jamais reposé sur la température.
    temperature: 'tiede',
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
  'Mise en favori',
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

// ---------------------------------------------------------------------------
// Rattachement à un lead CLOS : proposer de le rouvrir, jamais le faire seul.
// ---------------------------------------------------------------------------

/**
 * Statuts « clos » pour lesquels une demande rattachée risque de passer
 * inaperçue : le lead n'apparaît plus dans les vues de travail (hors
 * ACTIVE_STATUSES), donc la note « Demande entrante » dort dans un historique
 * que personne n'ouvre.
 *
 * Décision d'équipe (retour terrain 2026-09) : le système ne modifie RIEN
 * automatiquement. Il PROPOSE de rouvrir ; seul le clic du commercial agit.
 *
 * SIGNÉ volontairement ABSENT : un client signé qui revient porte presque
 * toujours un NOUVEAU projet, pas une vente annulée. Le rouvrir effacerait
 * `signedAt` (statusMilestoneDates) et fausserait les chiffres de ventes. On
 * l'oriente plutôt, AVANT le rattachement, vers un nouveau lead
 * (cf. shouldSuggestNewLead).
 */
export const REOPENABLE_LEAD_STATUSES: readonly LeadStatus[] = ['perdu', 'reporte'];

/** Statut posé par « Rouvrir le lead » — un changement de statut ordinaire. */
export const REOPEN_TARGET_STATUS: LeadStatus = 'a_contacter';

/** Faut-il proposer de rouvrir ce lead après un rattachement ? */
export function shouldOfferReopen(status: LeadStatus): boolean {
  return REOPENABLE_LEAD_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// « Traités » : filtre par statut, recherche, pagination (étape B).
// ---------------------------------------------------------------------------

/** Filtre de statut de la section « Traités » ('tous' = les trois statuts traités). */
export type ProcessedStatusFilter = 'tous' | 'accepte' | 'rattache' | 'rejete';

export const PROCESSED_STATUS_FILTERS: readonly { value: ProcessedStatusFilter; label: string }[] = [
  { value: 'tous', label: 'Tous' },
  { value: 'accepte', label: 'Acceptés' },
  { value: 'rattache', label: 'Rattachés' },
  { value: 'rejete', label: 'Rejetés' },
];

/** Taille d'une page de « Traités » (« Charger plus » ajoute la suivante). */
export const PROCESSED_PAGE_SIZE = 25;

/** Réponse paginée de GET /api/inbound/processed (et de son miroir démo). */
export interface ProcessedPage {
  items: InboundEmail[];
  /** Nombre TOTAL d'emails correspondant (statut + recherche) — tous pages confondues. */
  total: number;
  /** Décalage à redemander pour la page suivante ; absent = dernière page. */
  nextOffset?: number;
  /** Comptes par statut pour la recherche courante (alimentent les onglets). */
  counts: Record<ProcessedStatusFilter, number>;
}

/** Minuscules sans accents : « Bénéteau » se trouve en tapant « beneteau ». */
export function foldSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

type ProcessedMatchable = Pick<InboundEmail, 'status' | 'subject' | 'fromAddress' | 'extracted'>;

/**
 * Un email traité correspond-il à la recherche ? Nom complet, email, téléphone,
 * bateau, marque, objet, expéditeur ; insensible à la casse ET aux accents.
 * Le téléphone se compare aussi chiffres seuls (« 06 12 » trouve « 0612… »).
 * Requête vide -> tout correspond.
 */
export function inboundMatchesSearch(mail: ProcessedMatchable, query: string): boolean {
  const q = foldSearch(query);
  if (!q) return true;
  const x = mail.extracted;
  const haystack = foldSearch([
    `${x.firstName} ${x.lastName}`, `${x.lastName} ${x.firstName}`,
    x.email, x.phone, x.boatInterest, x.brand, mail.subject, mail.fromAddress,
  ].join('  '));
  if (haystack.includes(q)) return true;
  const qDigits = q.replace(/\D/g, '');
  return qDigits.length >= 4 && q.replace(/[\d\s.+-]/g, '') === '' && x.phone.replace(/\D/g, '').includes(qDigits);
}

/**
 * Filtre + comptes de « Traités », PUR — partagé par le serveur (sur une
 * projection légère des lignes) et par le mode démo, pour une sémantique
 * identique. L'ordre d'entrée est conservé (l'appelant trie).
 */
export function filterProcessedInbound<T extends ProcessedMatchable>(
  mails: T[], status: ProcessedStatusFilter, query: string,
): { matches: T[]; counts: Record<ProcessedStatusFilter, number> } {
  const searched = mails.filter(m => m.status !== 'a_traiter' && inboundMatchesSearch(m, query));
  const counts: Record<ProcessedStatusFilter, number> = {
    tous: searched.length,
    accepte: searched.filter(m => m.status === 'accepte').length,
    rattache: searched.filter(m => m.status === 'rattache').length,
    rejete: searched.filter(m => m.status === 'rejete').length,
  };
  return { matches: status === 'tous' ? searched : searched.filter(m => m.status === status), counts };
}

/**
 * Paramètres de la requête « Traités », VALIDÉS (entrée non fiable : query
 * string). Statut inconnu -> 'tous' ; décalage négatif/invalide -> 0 ; taille
 * bornée à [1, 100] ; recherche tronquée à 100 caractères.
 */
export function parseProcessedQuery(params: { status?: string | null; q?: string | null; offset?: string | null; limit?: string | null }): {
  status: ProcessedStatusFilter; q: string; offset: number; limit: number;
} {
  const status = PROCESSED_STATUS_FILTERS.some(f => f.value === params.status) ? params.status as ProcessedStatusFilter : 'tous';
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  const rawLimit = Math.floor(Number(params.limit) || PROCESSED_PAGE_SIZE);
  const limit = Math.min(100, Math.max(1, rawLimit));
  return { status, q: (params.q ?? '').slice(0, 100), offset, limit };
}

/**
 * Faut-il conseiller, AVANT de rattacher, d'accepter plutôt la demande comme
 * nouveau lead ? Oui pour un client déjà SIGNÉ (nouveau projet probable). Simple
 * aide : Rattacher et Accepter restent tous deux disponibles.
 */
export function shouldSuggestNewLead(status: LeadStatus): boolean {
  return status === 'signe';
}
