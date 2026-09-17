import type { SocialNetwork, SocialStat } from '../data/types.js';
// Suffixe .js : ce module est aussi chargé par l'API (upsert, restauration) en ESM Node.

// ===========================================================================
// Réseaux sociaux (lot 5) — module PUR, partagé app / API / harnais
// (scripts/harness-social.ts).
//
// Décisions du 17/09 :
//  - tables À PART (social_networks, social_stats) : MonthlyStat n'est PAS
//    réutilisé (il fausserait totaux, CPL et exports de l'acquisition) ;
//  - Facebook, Instagram, LinkedIn par défaut, identifiants FIXES ;
//  - un enregistrement par (réseau, année, mois), jamais supprimé : un mois se
//    corrige ; abonnés obligatoires, publications / portée / commentaire facultatifs ;
//  - carte entièrement vide = rien à enregistrer pour ce réseau ; un mois déjà
//    enregistré ne peut pas être vidé ;
//  - synchro : seules les lignes modifiées partent, le serveur fait l'upsert par
//    (réseau, année, mois) et garde l'id existant (jamais de doublon entre postes) ;
//  - variation des abonnés : par rapport au DERNIER mois saisi avant (mention du
//    mois quand ce n'est pas le mois précédent) ;
//  - réseau archivé : visible dans l'historique, absent de la saisie.
// ===========================================================================

export const DEFAULT_SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  { id: 'reseau-facebook', name: 'Facebook', position: 1, archived: false },
  { id: 'reseau-instagram', name: 'Instagram', position: 2, archived: false },
  { id: 'reseau-linkedin', name: 'LinkedIn', position: 3, archived: false },
];
export const defaultSocialNetworks = (): SocialNetwork[] => DEFAULT_SOCIAL_NETWORKS.map(n => ({ ...n }));

export const NETWORK_NAME_MAX = 60;
export const SOCIAL_COMMENT_MAX = 1000;
/** Borne de bon sens des compteurs (abonnés, publications, portée). */
export const SOCIAL_NUMBER_MAX = 1_000_000_000;

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1]} ${year}`;
const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
export const statKey = (s: Pick<SocialStat, 'networkId' | 'year' | 'month'>) => `${s.networkId}|${s.year}|${s.month}`;

// ---------------------------------------------------------------------------
// Réseaux
// ---------------------------------------------------------------------------

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Tous les réseaux, dans l'ordre (archivés compris). */
export function orderedNetworks(list: SocialNetwork[]): SocialNetwork[] {
  return [...list].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
/** Réseaux proposés à la saisie : non archivés. */
export const activeNetworks = (list: SocialNetwork[]) => orderedNetworks(list).filter(n => !n.archived);

export type NetworkError = 'nom-vide' | 'nom-trop-long' | 'nom-en-double';
export const NETWORK_ERROR_LABEL: Record<NetworkError, string> = {
  'nom-vide': 'Donnez un nom au réseau.',
  'nom-trop-long': `${NETWORK_NAME_MAX} caractères au plus.`,
  'nom-en-double': 'Ce réseau existe déjà (archivé compris).',
};

/** Nom valide : non vide, borné, unique (casse, accents et espaces ignorés, archivés compris). */
export function validateNetworkName(name: string, list: SocialNetwork[], exceptId?: string): NetworkError[] {
  const errors: NetworkError[] = [];
  const n = name.trim();
  if (!n) errors.push('nom-vide');
  if (n.length > NETWORK_NAME_MAX) errors.push('nom-trop-long');
  if (n && list.some(x => x.id !== exceptId && fold(x.name) === fold(n))) errors.push('nom-en-double');
  return errors;
}

/** Nouveau réseau, placé en dernier. */
export function newNetwork(list: SocialNetwork[], id: string, name: string): SocialNetwork {
  return { id, name: name.trim(), position: list.reduce((m, n) => Math.max(m, n.position), 0) + 1, archived: false };
}

/** Liste de réseaux cohérente (serveur, restauration) : ids et noms uniques. */
export function networksListErrors(list: SocialNetwork[]): string[] {
  const errors: string[] = [];
  if (new Set(list.map(n => n.id)).size !== list.length) errors.push('réseau en double (id)');
  if (new Set(list.map(n => fold(n.name))).size !== list.length) errors.push('deux réseaux portent le même nom');
  return errors;
}

// ---------------------------------------------------------------------------
// Saisie d'un mois
// ---------------------------------------------------------------------------

/** Contenu d'une carte de saisie (texte brut des champs). */
export interface StatDraft { followers: string; posts: string; reach: string; comment: string }
export const EMPTY_DRAFT: StatDraft = { followers: '', posts: '', reach: '', comment: '' };

export function draftFromStat(s: SocialStat | undefined): StatDraft {
  if (!s) return { ...EMPTY_DRAFT };
  return { followers: String(s.followers), posts: s.posts === null ? '' : String(s.posts), reach: s.reach === null ? '' : String(s.reach), comment: s.comment };
}

export type DraftError = 'abonnes-requis' | 'nombre-invalide' | 'commentaire-trop-long' | 'mois-deja-saisi';
export const DRAFT_ERROR_LABEL: Record<DraftError, string> = {
  'abonnes-requis': 'Les abonnés sont obligatoires.',
  'nombre-invalide': 'Nombre entier positif attendu.',
  'commentaire-trop-long': `${SOCIAL_COMMENT_MAX} caractères au plus.`,
  'mois-deja-saisi': 'Mois déjà enregistré : il se corrige mais ne se vide pas.',
};

/** "" -> null ; entier positif borné -> nombre ; sinon NaN (invalide). Espaces de milliers tolérés (« 12 500 »). */
export function parseCount(raw: string): number | null {
  const t = raw.replace(/\s/g, ''); // \s couvre aussi les espaces insécables (fine ou non)
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return NaN;
  const n = Number(t);
  return n <= SOCIAL_NUMBER_MAX ? n : NaN;
}

export type ParsedDraft =
  | { kind: 'vide' }
  | { kind: 'erreur'; errors: DraftError[] }
  | { kind: 'valeurs'; followers: number; posts: number | null; reach: number | null; comment: string };

/** Lecture d'une carte. `existing` : le mois est déjà enregistré pour ce réseau. */
export function parseDraft(d: StatDraft, existing: boolean): ParsedDraft {
  const comment = d.comment.trim();
  const allEmpty = !d.followers.trim() && !d.posts.trim() && !d.reach.trim() && !comment;
  if (allEmpty) return existing ? { kind: 'erreur', errors: ['mois-deja-saisi'] } : { kind: 'vide' };
  const errors: DraftError[] = [];
  const followers = parseCount(d.followers);
  const posts = parseCount(d.posts);
  const reach = parseCount(d.reach);
  if (followers === null) errors.push(existing ? 'mois-deja-saisi' : 'abonnes-requis');
  if ([followers, posts, reach].some(v => Number.isNaN(v))) errors.push('nombre-invalide');
  if (comment.length > SOCIAL_COMMENT_MAX) errors.push('commentaire-trop-long');
  if (errors.length) return { kind: 'erreur', errors };
  return { kind: 'valeurs', followers: followers as number, posts, reach, comment };
}

export const findStat = (stats: SocialStat[], networkId: string, year: number, month: number) =>
  stats.find(s => s.networkId === networkId && s.year === year && s.month === month);

const sameValues = (a: SocialStat, b: Pick<SocialStat, 'followers' | 'posts' | 'reach' | 'comment'>) =>
  a.followers === b.followers && a.posts === b.posts && a.reach === b.reach && a.comment === b.comment;

export interface MonthSave {
  /** Lignes à enregistrer (nouvelles ou modifiées), prêtes à partir. */
  rows: SocialStat[];
  /** Erreurs par réseau : rien n'est enregistré tant qu'il en reste. */
  errors: Record<string, DraftError[]>;
}

/**
 * Prépare l'enregistrement d'un ou plusieurs mois de brouillons.
 * `drafts` : clé statKey -> carte. Les cartes inchangées ne produisent rien.
 */
export function buildSave(stats: SocialStat[], drafts: Record<string, StatDraft>, newId: () => string): MonthSave {
  const rows: SocialStat[] = [];
  const errors: Record<string, DraftError[]> = {};
  for (const [key, draft] of Object.entries(drafts)) {
    const [networkId, y, m] = key.split('|');
    const year = Number(y);
    const month = Number(m);
    const existing = findStat(stats, networkId, year, month);
    const parsed = parseDraft(draft, !!existing);
    if (parsed.kind === 'vide') continue;
    if (parsed.kind === 'erreur') { errors[key] = parsed.errors; continue; }
    const values = { followers: parsed.followers, posts: parsed.posts, reach: parsed.reach, comment: parsed.comment };
    if (existing && sameValues(existing, values)) continue;
    rows.push({ id: existing?.id ?? newId(), networkId, year, month, ...values });
  }
  return { rows, errors };
}

/**
 * Upsert par (réseau, année, mois) : une ligne déjà présente pour la même clé
 * garde SON id (celui du serveur ou d'un autre poste) et prend les nouvelles
 * valeurs. Aucune ligne n'est jamais retirée.
 */
export function mergeStats(list: SocialStat[], rows: SocialStat[]): SocialStat[] {
  const next = [...list];
  for (const r of rows) {
    const at = next.findIndex(s => statKey(s) === statKey(r));
    if (at === -1) next.push({ ...r });
    else next[at] = { ...r, id: next[at].id };
  }
  return next;
}

/** Règles d'une ligne (serveur, restauration, reducer). */
export function statErrors(s: SocialStat, networks: Pick<SocialNetwork, 'id'>[]): string[] {
  const errors: string[] = [];
  const count = (v: number | null, nullable: boolean) => (v === null ? nullable : Number.isInteger(v) && v >= 0 && v <= SOCIAL_NUMBER_MAX);
  if (!networks.some(n => n.id === s.networkId)) errors.push('réseau inconnu');
  if (!Number.isInteger(s.year) || s.year < 2000 || s.year > 2200) errors.push('année invalide');
  if (!Number.isInteger(s.month) || s.month < 1 || s.month > 12) errors.push('mois invalide');
  if (!count(s.followers, false)) errors.push('abonnés invalides');
  if (!count(s.posts, true)) errors.push('publications invalides');
  if (!count(s.reach, true)) errors.push('portée invalide');
  if (s.comment.length > SOCIAL_COMMENT_MAX) errors.push('commentaire trop long');
  return errors;
}

// ---------------------------------------------------------------------------
// Historique : variation, mois, courbe
// ---------------------------------------------------------------------------

export interface Variation {
  /** Écart d'abonnés avec le dernier mois saisi avant ; null s'il n'y en a pas. */
  delta: number | null;
  /** Mois de référence (null : aucun). */
  since: { year: number; month: number } | null;
  /** true si la référence est le mois calendaire précédent. */
  previousMonth: boolean;
}

export function followersVariation(stats: SocialStat[], networkId: string, year: number, month: number): Variation {
  const current = findStat(stats, networkId, year, month);
  const at = monthIndex(year, month);
  const before = stats
    .filter(s => s.networkId === networkId && monthIndex(s.year, s.month) < at)
    .sort((a, b) => monthIndex(b.year, b.month) - monthIndex(a.year, a.month))[0];
  if (!current || !before) return { delta: null, since: null, previousMonth: false };
  return {
    delta: current.followers - before.followers,
    since: { year: before.year, month: before.month },
    previousMonth: monthIndex(before.year, before.month) === at - 1,
  };
}

/** "+56", "−12", "0" (signe moins typographique). */
export function formatDelta(delta: number): string {
  const abs = Math.abs(delta).toLocaleString('fr-FR');
  return delta > 0 ? `+${abs}` : delta < 0 ? `−${abs}` : '0';
}

/** Mois ayant au moins une stat, du plus récent au plus ancien. */
export function historyMonths(stats: SocialStat[]): { year: number; month: number }[] {
  const seen = new Map<number, { year: number; month: number }>();
  for (const s of stats) seen.set(monthIndex(s.year, s.month), { year: s.year, month: s.month });
  return [...seen.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);
}

/** Réseaux affichés dans l'historique : actifs + archivés ayant au moins une stat. */
export function historyNetworks(networks: SocialNetwork[], stats: SocialStat[]): SocialNetwork[] {
  return orderedNetworks(networks).filter(n => !n.archived || stats.some(s => s.networkId === n.id));
}

/** Points de la courbe des abonnés : un point par mois saisi (ordre chronologique), une clé par réseau. */
export function followersSeries(stats: SocialStat[], networks: SocialNetwork[]): Array<Record<string, number | string | null>> {
  return historyMonths(stats).reverse().map(({ year, month }) => {
    const point: Record<string, number | string | null> = { mois: `${MONTH_NAMES[month - 1].slice(0, 4)}. ${String(year).slice(2)}`, cle: `${year}-${String(month).padStart(2, '0')}` };
    for (const n of networks) point[n.id] = findStat(stats, n.id, year, month)?.followers ?? null;
    return point;
  });
}
