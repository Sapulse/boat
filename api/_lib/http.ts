import type { VercelRequest } from '@vercel/node';

// Erreur HTTP typée : portée jusqu'à l'enveloppe `route` qui la traduit en statut.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Traduit toute erreur en HttpError au statut PRÉCIS (correctif audit #2/4.2) :
 * refus propre plutôt que 500 générique.
 *  - JSON malformé (SyntaxError du parse) -> 400 ;
 *  - Prisma P2025 (enregistrement introuvable sur update/delete) -> 404 ;
 *  - Prisma P2002 (violation d'unicité) -> 409 ;
 *  - Prisma P2003 (clé étrangère invalide, ex. leadId inconnu) -> 400 ;
 *  - reste -> 500.
 */
export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof SyntaxError) return new HttpError(400, 'JSON malformé');
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'P2025') return new HttpError(404, 'Ressource introuvable');
  if (code === 'P2002') return new HttpError(409, "Conflit d'unicité (enregistrement déjà existant)");
  if (code === 'P2003') return new HttpError(400, 'Référence invalide (clé étrangère inconnue)');
  return new HttpError(500, (e as Error).message);
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
