// Rate-limit du login par IP (durcissement auth, commit 2). Cœur PUR ici
// (aucune I/O) ; l'accès base (compteur atomique) vit dans store.ts.
//
// Faille corrigée : le délai anti-brute-force de handleLogin s'exécute PAR
// invocation serverless sans état partagé -> des centaines de requêtes
// parallèles ne sont pas ralenties dans l'agrégat. On sérialise le COMPTEUR
// dans Turso via un upsert atomique en une seule instruction (SQLite = writer
// unique) : N requêtes concurrentes obtiennent des comptes 1,2,3,…,N distincts,
// et celles au-delà du seuil sont refusées (429).
//
// Fenêtre FIXE par tranche (clé « ip:bucket ») : simple, atomique et
// auto-expirante (une nouvelle tranche = une nouvelle clé). Compromis assumé :
// un attaquant peut faire jusqu'à ~MAX tentatives par tranche, et un burst à
// cheval sur deux tranches en autorise 2×MAX — négligeable face à un mot de
// passe fort (le compteur n'est qu'une défense en profondeur, cf. commit 1).

export const RATE_LIMIT_MAX = 5;              // tentatives autorisées par fenêtre
export const RATE_LIMIT_WINDOW_SEC = 15 * 60; // fenêtre de 15 minutes

/**
 * IP cliente depuis les en-têtes Vercel. `x-forwarded-for` peut lister
 * « client, proxy1, proxy2 » -> on prend la PREMIÈRE (le client réel). Repli sur
 * une clé neutre si absent (jamais undefined -> le rate-limit s'applique quand même).
 */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const xff = headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = (raw ?? '').split(',')[0].trim();
  if (first) return first;
  const real = headers['x-real-ip'];
  const realStr = Array.isArray(real) ? real[0] : real;
  return (realStr ?? '').trim() || 'unknown';
}

/** Indice de la fenêtre courante (tranche fixe de `windowSec`). */
export function windowBucket(nowSec: number, windowSec: number = RATE_LIMIT_WINDOW_SEC): number {
  return Math.floor(nowSec / windowSec);
}

/** Début (epoch s) de la tranche — sert à purger les vieilles fenêtres. */
export function windowStartSec(bucket: number, windowSec: number = RATE_LIMIT_WINDOW_SEC): number {
  return bucket * windowSec;
}

/** Clé de compteur unique par IP et par fenêtre. Séparateur '|' (pas ':') car
 *  une IPv6 contient des ':' — sinon la clé serait ambiguë. */
export function attemptKey(ip: string, bucket: number): string {
  return `${ip}|${bucket}`;
}

/**
 * Décision de blocage. `count` = valeur du compteur APRÈS incrément atomique.
 * Bloqué dès que le compte dépasse le plafond (le (MAX+1)ᵉ essai est refusé).
 */
export function isRateLimited(count: number, max: number = RATE_LIMIT_MAX): boolean {
  return count > max;
}
