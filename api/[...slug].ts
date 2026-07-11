import type { VercelRequest, VercelResponse } from '@vercel/node';
import { HttpError, toHttpError, body } from './_lib/http.js';
import { requireAuth, verifyPassword, signSession, buildSessionCookie, clearSessionCookie } from './_lib/auth.js';
import { prisma } from './_lib/prisma.js';
import {
  getState,
  createLead, updateLead, deleteLead,
  createAction, updateAction, deleteAction,
  createCommercial, updateCommercial,
  createTemplate, updateTemplate, deleteTemplate,
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  saveGoals, saveMonthlyStats, saveDefaultGoal,
  bulkImport, type ImportPayload,
  restoreBackup, type RestorePayload,
  bumpLoginAttempt, clearLoginAttempt, purgeOldLoginAttempts,
} from './_lib/store.js';
import {
  clientIp, windowBucket, windowStartSec, attemptKey, isRateLimited,
  RATE_LIMIT_WINDOW_SEC,
} from './_lib/loginRateLimit.js';
import type {
  Lead, LeadAction, Commercial, MessageTemplate,
  CalendarEvent, CommercialGoal, MonthlyStat, DefaultGoal,
} from '../src/data/types.js';

// Fonction API UNIQUE (chantier migration, Lot 4 — regroupement). Vercel route
// TOUT /api/* vers ce catch-all -> 1 seule fonction (limite Hobby : 12). Les URLs
// publiques et les réponses sont RIGOUREUSEMENT IDENTIQUES à l'ancien découpage
// (un fichier par entité) : /api/leads, /api/leads/:id, /api/state, etc.
//
// La logique reste dans _lib/store.ts (inchangé) ; ce fichier n'est qu'un routeur
// (garde par jeton -> dispatch resource/méthode/id -> store). Mêmes statuts :
// 201 (create), 204 (delete), 200 + JSON (sinon).

function sendJson(res: VercelResponse, status: number, data: unknown): void {
  res.status(status).json(data);
}
function sendEmpty(res: VercelResponse, status: number): void {
  res.status(status).end();
}

async function dispatch(req: VercelRequest, res: VercelResponse, resource: string, id: string | undefined): Promise<void> {
  const m = req.method;

  switch (resource) {
    case 'state':
      if (!id && m === 'GET') return sendJson(res, 200, await getState(prisma));
      break;

    case 'leads':
      if (!id && m === 'POST') return sendJson(res, 201, await createLead(prisma, body<Lead>(req)));
      if (id && m === 'PATCH') return sendJson(res, 200, await updateLead(prisma, id, body<Partial<Lead>>(req)));
      if (id && m === 'DELETE') { await deleteLead(prisma, id); return sendEmpty(res, 204); }
      break;

    case 'actions':
      if (!id && m === 'POST') return sendJson(res, 201, await createAction(prisma, body<LeadAction>(req)));
      if (id && m === 'PATCH') return sendJson(res, 200, await updateAction(prisma, id, body<Partial<LeadAction>>(req)));
      if (id && m === 'DELETE') { await deleteAction(prisma, id); return sendEmpty(res, 204); }
      break;

    case 'commercials':
      if (!id && m === 'POST') return sendJson(res, 201, await createCommercial(prisma, body<Commercial>(req)));
      if (id && m === 'PATCH') return sendJson(res, 200, await updateCommercial(prisma, id, body<Partial<Commercial>>(req)));
      break;

    case 'templates':
      if (!id && m === 'POST') return sendJson(res, 201, await createTemplate(prisma, body<MessageTemplate>(req)));
      if (id && m === 'PATCH') return sendJson(res, 200, await updateTemplate(prisma, id, body<Partial<MessageTemplate>>(req)));
      if (id && m === 'DELETE') { await deleteTemplate(prisma, id); return sendEmpty(res, 204); }
      break;

    case 'calendar-events':
      if (!id && m === 'POST') return sendJson(res, 201, await createCalendarEvent(prisma, body<CalendarEvent>(req)));
      if (id && m === 'PATCH') return sendJson(res, 200, await updateCalendarEvent(prisma, id, body<Partial<CalendarEvent>>(req)));
      if (id && m === 'DELETE') { await deleteCalendarEvent(prisma, id); return sendEmpty(res, 204); }
      break;

    case 'goals':
      if (!id && m === 'PUT') return sendJson(res, 200, await saveGoals(prisma, body<CommercialGoal[]>(req)));
      break;

    case 'monthly-stats':
      if (!id && m === 'PUT') return sendJson(res, 200, await saveMonthlyStats(prisma, body<MonthlyStat[]>(req)));
      break;

    case 'default-goal':
      if (!id && m === 'PUT') return sendJson(res, 200, await saveDefaultGoal(prisma, body<DefaultGoal>(req)));
      break;

    case 'import':
      // Import en masse (chantier import/export) : écriture atomique, compte-rendu.
      if (!id && m === 'POST') return sendJson(res, 201, await bulkImport(prisma, body<ImportPayload>(req)));
      break;

    case 'restore':
      // Restauration d'une sauvegarde : REMPLACEMENT TOTAL atomique, id-préservant.
      if (!id && m === 'POST') return sendJson(res, 201, await restoreBackup(prisma, body<RestorePayload>(req)));
      break;

    case 'session':
      // Sonde d'authentification (le client teste au chargement). On n'arrive ici
      // qu'après requireAuth -> session valide.
      if (!id && m === 'GET') return sendJson(res, 200, { authenticated: true });
      break;
  }

  // Route ou méthode non prise en charge (resource inconnue, méthode non gérée,
  // ou id présent/absent incohérent).
  throw new HttpError(405, `Route non supportée : ${m} /api/${resource}${id ? '/' + id : ''}`);
}

// Segments du chemin APRÈS /api, extraits de req.url (et NON de req.query.slug :
// pour une fonction @vercel/node brute, les segments de [...slug] ne sont pas
// injectés dans req.query — seul req.url est fiable). Robuste aux query strings
// et à la présence ou non du préfixe "api". Ex. "/api/leads/42?x=1" -> ["leads","42"].
function pathSegments(url: string | undefined): string[] {
  const pathname = new URL(url ?? '', 'http://localhost').pathname;
  const segs = pathname.split('/').filter(Boolean);
  return segs[0] === 'api' ? segs.slice(1) : segs;
}

// --- Auth : compte unique partagé (Lot 7 allégé) -------------------------------

// POST /api/login : vérifie identifiant + mot de passe (haché scrypt) -> pose le
// cookie de session signé. Échec -> délai anti-brute-force puis 401 (message
// générique). Hors garde (c'est la porte d'entrée). Env manquant -> 503.
async function handleLogin(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  const hash = process.env.APP_PASSWORD_HASH;
  const username = process.env.APP_USERNAME;
  if (!secret || !hash || !username) { res.status(503).json({ error: 'Auth non configurée côté serveur' }); return; }

  // Rate-limit par IP (durcissement) : compteur ATOMIQUE en base -> les requêtes
  // parallèles ne contournent plus le délai anti-brute-force. On incrémente
  // d'ABORD ; au-delà du plafond, on refuse (429) sans même vérifier le mot de
  // passe. Fail-open : si la base est injoignable, on loggue et on continue —
  // le mot de passe fort reste la barrière (cf. commit 1), on ne bloque pas
  // tout le monde sur un hoquet Turso.
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = windowBucket(nowSec);
  const key = attemptKey(clientIp(req.headers), bucket);
  try {
    const count = await bumpLoginAttempt(prisma, key, windowStartSec(bucket));
    void purgeOldLoginAttempts(prisma, nowSec - RATE_LIMIT_WINDOW_SEC).catch(() => {}); // best-effort
    if (isRateLimited(count)) {
      res.status(429).json({ error: 'Trop de tentatives de connexion — réessayez dans quelques minutes.' });
      return;
    }
  } catch (e) {
    console.warn('[login] rate-limit indisponible, fail-open :', e);
  }

  const creds = body<{ username?: unknown; password?: unknown }>(req);
  const ok = typeof creds.username === 'string' && typeof creds.password === 'string'
    && creds.username === username && verifyPassword(creds.password, hash);
  if (!ok) {
    await new Promise(r => setTimeout(r, 700)); // ralentit le brute-force (mdp partagé unique)
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
  // Login réussi : on efface le compteur de la fenêtre (fautes de frappe légitimes
  // non pénalisées). Best-effort — un échec de purge ne doit pas rater le login.
  await clearLoginAttempt(prisma, key).catch(() => {});
  res.setHeader('Set-Cookie', buildSessionCookie(signSession(secret, nowSec)));
  res.status(200).json({ ok: true });
}

// POST /api/logout : efface le cookie de session. Hors garde.
function handleLogout(_req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(200).json({ ok: true });
}

// Point d'entrée unique : /login|/logout hors garde ; TOUT le reste exige un
// COOKIE de session valide (requireAuth). Gestion d'erreurs homogène.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const [resource, id] = pathSegments(req.url);
    if (!resource) throw new HttpError(404, 'Ressource manquante');
    if (resource === 'login') {
      if (req.method === 'POST') return await handleLogin(req, res);
      throw new HttpError(405, 'Route non supportée : POST /api/login attendu');
    }
    if (resource === 'logout') {
      if (req.method === 'POST') return handleLogout(req, res);
      throw new HttpError(405, 'Route non supportée : POST /api/logout attendu');
    }
    requireAuth(req); // cookie de session — couvre session/state/écritures/import/restore
    await dispatch(req, res, resource, id);
  } catch (e) {
    // Statuts précis : 400 validation/JSON/FK, 404 introuvable, 409 unicité, 500 sinon.
    const err = toHttpError(e);
    res.status(err.status).json({ error: err.message });
  }
}
