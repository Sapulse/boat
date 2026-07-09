import { randomBytes, scryptSync, createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { HttpError } from './http.js';

// Authentification à COMPTE UNIQUE PARTAGÉ (Lot 7 allégé). Zéro dépendance
// (node:crypto). Le mot de passe partagé est stocké HACHÉ (scrypt) en env var
// serveur ; la session est un cookie SIGNÉ (HMAC-SHA256) HttpOnly — AUCUN secret
// ne part dans le bundle client. Fonctions pures (nowSec/secret injectés) ->
// testables au harnais sans horloge ni env.

// --- Mot de passe : scrypt (sel aléatoire, format auto-descriptif) ---
const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_LEN = 16;

/** Hash d'un mot de passe -> `scrypt$N$r$p$selB64$hashB64`. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Vérifie un mot de passe contre un hash stocké (temps constant). */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(plain, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// --- Session : jeton signé HMAC-SHA256 `payloadB64url.sigB64url` ---
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 jours (secondes)
const COOKIE_NAME = 'session';

interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Signe une session (durée 30 j). `nowSec`/`secret` injectés (déterminisme). */
export function signSession(secret: string, nowSec: number): string {
  const payload: SessionPayload = { sub: 'team', iat: nowSec, exp: nowSec + SESSION_MAX_AGE };
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret).update(p).digest());
  return `${p}.${sig}`;
}

/** Vérifie signature + expiration. Renvoie le payload, ou null si invalide/expiré. */
export function verifySession(token: string, secret: string, nowSec: number): SessionPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const p = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret).update(p).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(p).toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  return payload;
}

// --- Cookies ---
/** Set-Cookie de session : HttpOnly + Secure + SameSite=Lax + 30 j. */
export function buildSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}
/** Set-Cookie d'effacement (logout). */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
/** Parse un header Cookie en dictionnaire. */
export function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Garde d'API par COOKIE de session (remplace l'ancien jeton statique). Fail-safe :
 * si `SESSION_SECRET` ou `APP_PASSWORD_HASH` manquent côté serveur -> 503 (jamais
 * d'API ouverte). Cookie absent/invalide/expiré -> 401.
 */
export function requireAuth(req: VercelRequest): void {
  const secret = process.env.SESSION_SECRET;
  const hash = process.env.APP_PASSWORD_HASH;
  if (!secret || !hash) throw new HttpError(503, 'Auth non configurée (SESSION_SECRET / APP_PASSWORD_HASH manquants côté serveur)');
  const token = parseCookie(req.headers['cookie'] as string | undefined)[COOKIE_NAME];
  const nowSec = Math.floor(Date.now() / 1000);
  if (!token || !verifySession(token, secret, nowSec)) throw new HttpError(401, 'Non authentifié');
}
