import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from './http.js';
import { createLead } from './store.js';
import { fetchRecentSourceEmails, toParseInput, DEFAULT_COLLECT_CAP } from './inboundCollect.js';
import type { GraphEnv } from './graph.js';
import { parseEmail } from '../../src/lib/email/parseEmail.js';
import { buildLeadFromInbound } from '../../src/lib/inbound.js';
import type { InboundEmail, InboundExtracted, Lead } from '../../src/data/types.js';

// Couche d'accès de la file d'import email (Étape B) — même rôle que store.ts
// pour les entités métier. Périmètre d'écriture STRICT :
//  - collectInbound : INSERT ... ON CONFLICT DO NOTHING dans inbound_emails
//    UNIQUEMENT (idempotence par internetMessageId, prouvée au harnais) ;
//  - acceptInbound : CRÉE un lead (jamais de suppression nulle part) + marque
//    l'email accepté ; rejectInbound : marque rejeté ;
//  - purgeRejectedInbound : le SEUL DELETE du module (rétention RGPD), ajouté le
//    2026-07-30. Périmètre étroit et prouvé au harnais : uniquement des lignes
//    inbound_emails au statut 'rejete' hors délai. Aucun lead n'est jamais
//    supprimé, ici ni ailleurs.
// Lecture seule côté Outlook (Mail.Read).

// ---------------------------------------------------------------------------
// Mapping ligne <-> domaine (extracted/scoreReasons stockés en JSON texte).
// ---------------------------------------------------------------------------

const EMPTY_EXTRACTED: InboundExtracted = { firstName: '', lastName: '', email: '', phone: '', boatInterest: '', brand: '' };

interface InboundRow {
  id: string; graphId: string; internetMessageId: string; receivedAt: string;
  fromAddress: string; subject: string; excerpt: string; source: string;
  sourceLabel: string; sourceDetail: string | null; leadSource: string;
  extracted: string; score: number; scoreReasons: string; status: string; leadId: string | null;
}

function toInbound(r: InboundRow): InboundEmail {
  let extracted: InboundExtracted;
  let reasons: string[];
  try { extracted = { ...EMPTY_EXTRACTED, ...JSON.parse(r.extracted) as Partial<InboundExtracted> }; } catch { extracted = { ...EMPTY_EXTRACTED }; }
  try { reasons = JSON.parse(r.scoreReasons) as string[]; } catch { reasons = []; }
  return {
    id: r.id,
    receivedAt: r.receivedAt,
    fromAddress: r.fromAddress,
    subject: r.subject,
    excerpt: r.excerpt,
    sourceLabel: r.sourceLabel,
    sourceDetail: r.sourceDetail ?? undefined,
    leadSource: r.leadSource,
    score: r.score,
    scoreReasons: reasons,
    extracted,
    status: r.status as InboundEmail['status'],
    leadId: r.leadId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Collecte (déclenchement MANUEL — aucun cron n'appelle ceci).
// ---------------------------------------------------------------------------

export interface CollectReport {
  windowSince: string;
  scanned: number;
  inserted: number;
  alreadySeen: number;
  autoRejected: number; // administratif Band of Boats, tracé en statut rejeté
  truncated: boolean;
  errors: string[];
}

/** Plancher de collecte : IMPORT_EMAILS_SINCE si valide, sinon J-7. */
export function computeSinceFloor(env: NodeJS.ProcessEnv, nowMs: number): string {
  const raw = env.IMPORT_EMAILS_SINCE?.trim();
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date(nowMs - 7 * 86_400_000).toISOString();
}

export async function collectInbound(
  prisma: PrismaClient,
  graphEnv: GraphEnv,
  opts: { sinceFloorIso: string; cap?: number; fetchFn?: typeof fetch },
): Promise<CollectReport> {
  // Curseur dérivé de la table (max receivedAt), reculé d'1 h de chevauchement —
  // l'idempotence absorbe le recouvrement. Le plancher reste infranchissable.
  const last = await prisma.inboundEmail.aggregate({ _max: { receivedAt: true } });
  const maxSeen = last._max.receivedAt;
  let since = opts.sinceFloorIso;
  if (maxSeen) {
    const cursor = new Date(Date.parse(maxSeen) - 3_600_000).toISOString();
    if (cursor > since) since = cursor;
  }

  const { messages, truncated, errors } = await fetchRecentSourceEmails(graphEnv, {
    sinceIso: since, cap: opts.cap ?? DEFAULT_COLLECT_CAP, fetchFn: opts.fetchFn,
  });

  let inserted = 0;
  let autoRejected = 0;
  for (const msg of messages) {
    const p = parseEmail(toParseInput(msg));
    const isAdmin = p.scoreReasons.some(r => r.includes('Administratif'));
    const status = isAdmin ? 'rejete' : 'a_traiter';
    const excerpt = [p.excerpt, ...p.notes].filter(Boolean).join('\n\n').slice(0, 4000);
    // ON CONFLICT DO NOTHING + RETURNING : rejeu structurellement sans effet,
    // comptage exact des nouveaux. ($queryRaw paramétré, patron login_attempts.)
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO inbound_emails (
        id, graphId, internetMessageId, receivedAt, fromAddress, subject, excerpt,
        source, sourceLabel, sourceDetail, leadSource, extracted, score, scoreReasons,
        status, updatedAt
      ) VALUES (
        ${randomUUID()}, ${msg.graphId}, ${msg.internetMessageId}, ${msg.receivedAt},
        ${msg.fromAddress}, ${msg.subject}, ${excerpt}, ${p.source}, ${p.sourceLabel},
        ${p.sourceDetail ?? null}, ${p.leadSource}, ${JSON.stringify(p.extracted)},
        ${p.score}, ${JSON.stringify(p.scoreReasons)}, ${status}, CURRENT_TIMESTAMP
      )
      ON CONFLICT(internetMessageId) DO NOTHING
      RETURNING id`;
    if (rows.length > 0) {
      inserted++;
      if (isAdmin) autoRejected++;
    }
  }

  return {
    windowSince: since,
    scanned: messages.length,
    inserted,
    alreadySeen: messages.length - inserted,
    autoRejected,
    truncated,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Liste pour l'écran : tous les « à traiter » + les 50 derniers traités.
// ---------------------------------------------------------------------------

export async function listInbound(prisma: PrismaClient): Promise<InboundEmail[]> {
  const pending = await prisma.inboundEmail.findMany({ where: { status: 'a_traiter' }, orderBy: { receivedAt: 'desc' } });
  const processed = await prisma.inboundEmail.findMany({
    where: { status: { in: ['accepte', 'rejete'] } }, orderBy: { updatedAt: 'desc' }, take: 50,
  });
  return [...pending, ...processed].map(r => toInbound(r as unknown as InboundRow));
}

// ---------------------------------------------------------------------------
// Accepter / Rejeter (PATCH /api/inbound/:id, action dans le corps).
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const extractedSchema = z.object({
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  email: z.string().max(320),
  phone: z.string().max(60),
  boatInterest: z.string().max(300),
  brand: z.string().max(120),
}).partial().strip();

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    // '' = « Non attribué » -> résolu vers le commercial du même nom (créé au
    // besoin), comme à l'import en masse : la FK leads.commercialId reste saine.
    commercialId: z.union([z.string().regex(ID_RE), z.literal('')]),
    extracted: extractedSchema.optional(),
  }).strip(),
  z.object({ action: z.literal('reject') }).strip(),
]);

const UNASSIGNED_NAME = 'Non attribué';

async function resolveCommercialId(prisma: PrismaClient, requested: string): Promise<string> {
  if (requested !== '') {
    const found = await prisma.commercial.findUnique({ where: { id: requested } });
    if (!found) throw new HttpError(400, 'Commercial inconnu');
    return requested;
  }
  const existing = await prisma.commercial.findFirst({ where: { name: UNASSIGNED_NAME } });
  if (existing) return existing.id;
  const created = await prisma.commercial.create({ data: { id: randomUUID(), name: UNASSIGNED_NAME, active: false } });
  return created.id;
}

export async function patchInbound(prisma: PrismaClient, id: string, rawBody: unknown): Promise<{ inbound: InboundEmail; lead?: Lead }> {
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) throw new HttpError(400, 'Corps invalide : action accept/reject attendue');
  const body = parsed.data;

  const row = await prisma.inboundEmail.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, 'Email introuvable dans la file');
  if (row.status !== 'a_traiter') throw new HttpError(409, 'Email déjà traité (rechargez la file)');

  if (body.action === 'reject') {
    const updated = await prisma.inboundEmail.update({ where: { id }, data: { status: 'rejete' } });
    return { inbound: toInbound(updated as unknown as InboundRow) };
  }

  // ACCEPT — transaction : création du lead (jamais de suppression) + marquage.
  const base = toInbound(row as unknown as InboundRow);
  const extracted: InboundExtracted = { ...base.extracted, ...(body.extracted ?? {}) };
  const commercialId = await resolveCommercialId(prisma, body.commercialId);
  const todayISO = new Date().toISOString().slice(0, 10);
  const leadPayload: Lead = {
    id: randomUUID(),
    ...buildLeadFromInbound({ ...base, extracted }, commercialId, todayISO),
  };

  const result = await prisma.$transaction(async (tx) => {
    const lead = await createLead(tx as PrismaClient, leadPayload);
    const updated = await tx.inboundEmail.update({
      where: { id },
      data: { status: 'accepte', leadId: lead.id, extracted: JSON.stringify(extracted) },
    });
    return { lead, updated };
  });

  return { inbound: toInbound(result.updated as unknown as InboundRow), lead: result.lead };
}

// ---------------------------------------------------------------------------
// Purge de rétention (RGPD) — le SEUL DELETE de ce module.
// ---------------------------------------------------------------------------

/** Durée de conservation des emails REJETÉS, en jours (politique RGPD du projet). */
export const INBOUND_RETENTION_DAYS = 90;

/** Borne : tout email rejeté dont l'horodatage est antérieur est hors délai. */
export function inboundRetentionCutoff(now: Date, days = INBOUND_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Les emails rejetés hors délai, SANS RIEN SUPPRIMER : c'est ce que le mode « à
 * blanc » du script de purge affiche avant que l'utilisateur décide.
 */
export async function listPurgeableInbound(prisma: PrismaClient, before: Date) {
  return prisma.inboundEmail.findMany({
    where: { status: 'rejete', updatedAt: { lt: before } },
    orderBy: { updatedAt: 'asc' },
  });
}

/**
 * Supprime les emails REJETÉS hors délai. Périmètre volontairement étroit :
 *  - `status: 'rejete'` UNIQUEMENT. Un 'a_traiter' est du travail en attente ;
 *    un 'accepte' porte le lien `leadId` vers le lead créé — donc la trace de
 *    l'origine d'un lead réel, qu'on ne casse pas.
 *  - rien d'autre que `inbound_emails` : aucun lead n'est touché.
 *
 * La borne porte sur `updatedAt`, c'est-à-dire l'INSTANT DU REJET (rien ne remet
 * un email rejeté à jour ensuite, et les administratifs auto-rejetés le sont dès
 * l'insertion) : la règle est donc « 90 jours après le rejet », ce qui est la
 * formulation défendable côté RGPD.
 *
 * Renvoie le nombre de lignes supprimées.
 */
export async function purgeRejectedInbound(prisma: PrismaClient, before: Date): Promise<number> {
  const { count } = await prisma.inboundEmail.deleteMany({
    where: { status: 'rejete', updatedAt: { lt: before } },
  });
  return count;
}
