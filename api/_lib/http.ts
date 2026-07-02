import type { VercelRequest, VercelResponse } from '@vercel/node';

// Erreur HTTP typée : portée jusqu'à l'enveloppe `route` qui la traduit en statut.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Garde d'API par JETON PARTAGÉ (Lot 4-6), en attendant l'auth réelle (Lot 7).
 * Le client enverra `Authorization: Bearer <API_SHARED_TOKEN>`. Si la variable
 * `API_SHARED_TOKEN` n'est pas définie côté serveur, l'API REFUSE tout (fail-safe :
 * jamais d'API ouverte par mégarde).
 */
export function requireToken(req: VercelRequest): void {
  const expected = process.env.API_SHARED_TOKEN;
  if (!expected) throw new HttpError(503, 'API non configurée (API_SHARED_TOKEN manquant côté serveur)');
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== expected) throw new HttpError(401, 'Non autorisé');
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;
type Methods = Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', Handler>>;

/**
 * Enveloppe commune à TOUTES les routes : garde par jeton, routage par méthode
 * (405 sinon), et gestion d'erreurs centralisée (HttpError -> son statut ; toute
 * autre erreur -> 500). Garantit un contrat homogène pour l'API.
 */
export function route(methods: Methods) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    try {
      requireToken(req);
      const handler = methods[req.method as keyof Methods];
      if (!handler) {
        res.setHeader('Allow', Object.keys(methods).join(', '));
        throw new HttpError(405, `Méthode ${req.method} non supportée`);
      }
      await handler(req, res);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, (e as Error).message);
      res.status(err.status).json({ error: err.message });
    }
  };
}

/** Id de chemin (`/api/leads/[id]`) ; 400 si absent. */
export function pathId(req: VercelRequest): string {
  const { id } = req.query;
  const value = Array.isArray(id) ? id[0] : id;
  if (!value) throw new HttpError(400, 'id manquant dans le chemin');
  return value;
}

/** Corps JSON de la requête (Vercel le parse déjà ; on tolère une string). */
export function body<T>(req: VercelRequest): T {
  const raw = req.body;
  if (raw == null) throw new HttpError(400, 'corps de requête requis');
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}
