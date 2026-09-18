import type { VercelRequest } from '@vercel/node';

// Erreur HTTP typée : portée jusqu'à l'enveloppe `route` qui la traduit en statut.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Message des erreurs serveur INATTENDUES : volontairement muet (cf. toHttpError). */
export const GENERIC_SERVER_ERROR = 'Erreur interne du serveur';

/**
 * Traduit toute erreur en HttpError au statut PRÉCIS (correctif audit #2/4.2) :
 * refus propre plutôt que 500 générique.
 *  - JSON malformé (SyntaxError du parse) -> 400 ;
 *  - Prisma P2025 (enregistrement introuvable sur update/delete) -> 404 ;
 *  - Prisma P2002 (violation d'unicité) -> 409 ;
 *  - Prisma P2003 (clé étrangère invalide, ex. leadId inconnu) -> 400 ;
 *  - reste -> 500 au message GÉNÉRIQUE.
 *
 * Le message d'une erreur INATTENDUE ne sort JAMAIS vers le client (correctif
 * audit sécurité) : `(e as Error).message` porte des internes — noms de
 * colonnes, chemins de fichiers, fragments de SQL Prisma — qui cartographient
 * le serveur pour un attaquant. Le détail est loggué côté serveur par
 * l'enveloppe `handler` (api/[...slug].ts), qui a l'erreur d'origine en main.
 *
 * Les HttpError DÉLIBÉRÉES passent inchangées (early return ci-dessous) : leur
 * message est rédigé POUR le client (validation validate.ts, 503 de config…).
 */
/**
 * Marqueur STABLE (lu par le client) d'une base dont le schéma est en retard sur
 * le code : typiquement le code du lot 2 déployé AVANT la migration Turso. L'app
 * affiche alors un écran explicite au lieu d'un échec de chargement anonyme.
 */
export const SCHEMA_NOT_MIGRATED = 'SCHEMA_NON_MIGRE';

/**
 * Marqueur STABLE (lu par le client) d'une sauvegarde PRISE AVANT le lot salons
 * alors que la base contient des participations à une campagne. La restaurer les
 * effacerait — sans ce refus, en SILENCE : une vieille sauvegarde n'a pas de clé
 * `campagnes`, donc rien n'aurait signalé la perte. Le client affiche le nombre
 * et le nom de la campagne, et ne repasse qu'avec une confirmation explicite.
 */
export const SAUVEGARDE_ANTERIEURE_SALONS = 'SAUVEGARDE_ANTERIEURE_LOT_SALONS';

/** Table ou colonne absente (Prisma P2021 / P2022, ou erreur SQLite remontée par l'adaptateur libSQL). */
export function isMissingSchemaError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; cause?: unknown } | null;
  if (err?.code === 'P2021' || err?.code === 'P2022') return true;
  const text = `${String(err?.message ?? '')} ${String((err?.cause as { message?: unknown } | undefined)?.message ?? '')} ${String((err as { name?: unknown } | null)?.name ?? '')}`;
  return /no such (table|column)|ColumnNotFound|TableDoesNotExist/i.test(text);
}

export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof SyntaxError) return new HttpError(400, 'JSON malformé');
  if (isMissingSchemaError(e)) {
    return new HttpError(503, `${SCHEMA_NOT_MIGRATED} : la base n'est pas encore migrée pour cette version de l'application (mise à jour en cours).`);
  }
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'P2025') return new HttpError(404, 'Ressource introuvable');
  if (code === 'P2002') return new HttpError(409, "Conflit d'unicité (enregistrement déjà existant)");
  if (code === 'P2003') return new HttpError(400, 'Référence invalide (clé étrangère inconnue)');
  return new HttpError(500, GENERIC_SERVER_ERROR);
}

// NB : l'ancienne garde par JETON PARTAGÉ (requireToken / API_SHARED_TOKEN,
// Lots 4-6) a été REMPLACÉE par l'auth à cookie de session (Lot 7 allégé,
// `_lib/auth.ts` -> requireAuth). Plus aucun jeton statique côté serveur ni client.

/** Corps JSON de la requête (Vercel le parse déjà ; on tolère une string). */
export function body<T>(req: VercelRequest): T {
  const raw = req.body;
  if (raw == null) throw new HttpError(400, 'corps de requête requis');
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}
