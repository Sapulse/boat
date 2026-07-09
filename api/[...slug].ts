import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireToken, HttpError, toHttpError, body } from './_lib/http.js';
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
} from './_lib/store.js';
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

// Point d'entrée unique : garde par jeton + parsing du chemin + dispatch, avec
// gestion d'erreurs homogène (HttpError -> son statut, sinon 500).
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requireToken(req);
    const [resource, id] = pathSegments(req.url);
    if (!resource) throw new HttpError(404, 'Ressource manquante');
    await dispatch(req, res, resource, id);
  } catch (e) {
    // Statuts précis : 400 validation/JSON/FK, 404 introuvable, 409 unicité, 500 sinon.
    const err = toHttpError(e);
    res.status(err.status).json({ error: err.message });
  }
}
