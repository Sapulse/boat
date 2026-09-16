import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from './http.js';
import { createLead, createAction } from './store.js';
import { fetchRecentSourceEmails, toParseInput, DEFAULT_COLLECT_CAP } from './inboundCollect.js';
import type { GraphEnv } from './graph.js';
import { parseEmail } from '../../src/lib/email/parseEmail.js';
import { buildLeadFromInbound, filterProcessedInbound } from '../../src/lib/inbound.js';
import type { ProcessedPage, ProcessedStatusFilter } from '../../src/lib/inbound.js';
import type { InboundEmail, InboundExtracted, InboundStatus, Lead, LeadAction } from '../../src/data/types.js';

// Couche d'accès de la file d'import email (Étape B) — même rôle que store.ts
// pour les entités métier. Périmètre d'écriture STRICT :
//  - collectInbound : INSERT ... ON CONFLICT DO NOTHING dans inbound_emails
//    UNIQUEMENT (idempotence par internetMessageId, prouvée au harnais) ;
//  - purgeRejectedInbound : le SEUL DELETE du module (rétention RGPD), ajouté le
//    2026-07-30. Périmètre étroit et prouvé au harnais : uniquement des lignes
//    inbound_emails au statut 'rejete' hors délai. Aucun lead n'est jamais
//    supprimé, ici ni ailleurs.
// Lecture seule côté Outlook (Mail.Read).
//
// MODÈLE D'ACTIONS de la file (retour terrain 2026-08, `patchInbound`) — quatre
// issues, dont les transitions autorisées vivent dans ALLOWED_FROM :
//  - accept : CRÉE un lead ;
//  - attach : AJOUTE une action d'historique à un lead EXISTANT. C'est la
//    troisième issue qui manquait : un prospect qui refait la même demande ne
//    doit ni créer un doublon (accept) ni voir sa demande perdue (reject). Aucun
//    lead n'est créé, et depuis 2026-09 aucun lead n'est MODIFIÉ non plus (le
//    système ne pose plus la température) ;
//  - reject : écarte ;
//  - reopen : remet en file un email REJETÉ — le seul état réversible, parce que
//    c'est le seul qui n'a créé aucune donnée à défaire.

// ---------------------------------------------------------------------------
// Mapping ligne <-> domaine (extracted/scoreReasons stockés en JSON texte).
// ---------------------------------------------------------------------------

const EMPTY_EXTRACTED: InboundExtracted = { firstName: '', lastName: '', email: '', phone: '', boatInterest: '', brand: '' };

interface InboundRow {
  id: string; graphId: string; internetMessageId: string; receivedAt: string;
  fromAddress: string; subject: string; excerpt: string; source: string;
  sourceLabel: string; sourceDetail: string | null; leadSource: string;
  extracted: string; score: number; scoreReasons: string; status: string; leadId: string | null;
  updatedAt: Date;
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
    // `updatedAt` est maintenu par Prisma (@updatedAt) : pour un email traité, il
    // marque l'instant de la décision. Inutile tant qu'il est « à traiter ».
    processedAt: r.status === 'a_traiter' ? undefined : r.updatedAt.toISOString(),
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
    where: { status: { in: ['accepte', 'rejete', 'rattache'] } }, orderBy: { updatedAt: 'desc' }, take: 50,
  });
  return [...pending, ...processed].map(r => toInbound(r as unknown as InboundRow));
}

// ---------------------------------------------------------------------------
// « Traités » paginés (GET /api/inbound/processed) — étape B : la liste
// ci-dessus plafonnait à 50 sur 143, les rejets anciens étaient INACCESSIBLES
// et « Remettre en file » ne pouvait donc pas les atteindre. Lecture seule.
// ---------------------------------------------------------------------------

/**
 * Pagination par DÉCALAGE, pas par curseur de date : en prod `updatedAt` a deux
 * formats de stockage (CURRENT_TIMESTAMP « AAAA-MM-JJ HH:MM:SS » des rejets
 * automatiques à la collecte, ISO des mises à jour Prisma). Une borne `lt` sur
 * la date comparerait des chaînes hétérogènes et pourrait sauter des lignes. Le
 * tri (updatedAt desc, id desc) est, lui, déterministe : les pages ne se
 * recouvrent pas tant que la file ne bouge pas, et l'écran recharge dès qu'elle
 * bouge.
 *
 * Filtrage en deux temps pour une sémantique IDENTIQUE au mode démo
 * (filterProcessedInbound, insensible aux accents — ce que LIKE ne sait pas) :
 * une projection LÉGÈRE (sans l'extrait, jusqu'à 4 000 caractères) sert au
 * filtre et aux comptes, puis seules les lignes de la page sont lues en entier.
 */
export async function listProcessedInbound(
  prisma: PrismaClient,
  params: { status: ProcessedStatusFilter; q: string; offset: number; limit: number },
): Promise<ProcessedPage> {
  const light = await prisma.inboundEmail.findMany({
    where: { status: { in: ['accepte', 'rejete', 'rattache'] } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true, subject: true, fromAddress: true, extracted: true },
  });
  const projected = light.map(r => {
    let extracted: InboundExtracted;
    try { extracted = { ...EMPTY_EXTRACTED, ...JSON.parse(r.extracted) as Partial<InboundExtracted> }; } catch { extracted = { ...EMPTY_EXTRACTED }; }
    return { id: r.id, status: r.status as InboundStatus, subject: r.subject, fromAddress: r.fromAddress, extracted };
  });
  const { matches, counts } = filterProcessedInbound(projected, params.status, params.q);
  const pageIds = matches.slice(params.offset, params.offset + params.limit).map(m => m.id);
  const rows = pageIds.length ? await prisma.inboundEmail.findMany({ where: { id: { in: pageIds } } }) : [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const items = pageIds.flatMap(id => {
    const r = byId.get(id);
    return r ? [toInbound(r as unknown as InboundRow)] : [];
  });
  const end = params.offset + pageIds.length;
  return { items, total: matches.length, nextOffset: end < matches.length ? end : undefined, counts };
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
  // RATTACHER à un lead EXISTANT (retour terrain) : pas de nouveau lead, une
  // ACTION d'historique sur celui qui existe déjà.
  z.object({ action: z.literal('attach'), leadId: z.string().regex(ID_RE) }).strip(),
  // REMETTRE EN FILE un email rejeté par erreur.
  z.object({ action: z.literal('reopen') }).strip(),
]);

type PatchAction = z.infer<typeof patchSchema>['action'];

/**
 * Transitions AUTORISÉES — source de vérité UNIQUE du cycle de vie de la file.
 *
 * `reopen` n'est permis QUE depuis `rejete`, et c'est un choix assumé, pas un
 * oubli : un rejet n'a créé aucune donnée, donc le défaire ne laisse rien
 * derrière. Un `accepte` a créé un LEAD et un `rattache` a créé une ACTION sur un
 * lead existant — les défaire supposerait de supprimer des données métier, ce que
 * ce module ne fait jamais. Dans ces deux cas la correction se fait depuis la
 * fiche du lead, et le message d'erreur le dit.
 */
const ALLOWED_FROM: Record<PatchAction, InboundStatus[]> = {
  accept: ['a_traiter'],
  reject: ['a_traiter'],
  attach: ['a_traiter'],
  reopen: ['rejete'],
};

/** Refus EXPLIQUÉ : l'utilisateur doit savoir quoi faire, pas juste que c'est non. */
function transitionError(action: PatchAction, current: InboundStatus): HttpError {
  if (action === 'reopen') {
    if (current === 'a_traiter') return new HttpError(409, 'Cet email est déjà dans la file à traiter.');
    if (current === 'accepte') {
      return new HttpError(409,
        'Impossible de remettre en file : cet email a créé un lead. Corrigez depuis la fiche du lead.');
    }
    return new HttpError(409,
      'Impossible de remettre en file : cet email a été rattaché à un lead. Corrigez depuis la fiche du lead.');
  }
  return new HttpError(409, 'Email déjà traité (rechargez la file)');
}

/** Date de l'action d'historique : le jour de RÉCEPTION, pas aujourd'hui, pour que
 *  la frise du lead reste chronologiquement honnête. Tolère l'ISO du collecteur
 *  comme le « YYYY-MM-DD HH:mm » des fixtures ; repli sur aujourd'hui si illisible. */
function receivedDayISO(receivedAt: string): string {
  const day = receivedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10);
}

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

export async function patchInbound(
  prisma: PrismaClient, id: string, rawBody: unknown,
): Promise<{ inbound: InboundEmail; lead?: Lead; action?: LeadAction }> {
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new HttpError(400, 'Corps invalide : action accept / reject / attach / reopen attendue');
  }
  const body = parsed.data;

  const row = await prisma.inboundEmail.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, 'Email introuvable dans la file');
  const current = row.status as InboundStatus;
  if (!ALLOWED_FROM[body.action].includes(current)) throw transitionError(body.action, current);

  if (body.action === 'reject') {
    const updated = await prisma.inboundEmail.update({ where: { id }, data: { status: 'rejete' } });
    return { inbound: toInbound(updated as unknown as InboundRow) };
  }

  // REOPEN — remise en file d'un rejet. On efface aussi `leadId` par précaution :
  // un rejeté n'en porte pas, mais la file ne doit jamais afficher un lien mort.
  if (body.action === 'reopen') {
    const updated = await prisma.inboundEmail.update({
      where: { id }, data: { status: 'a_traiter', leadId: null },
    });
    return { inbound: toInbound(updated as unknown as InboundRow) };
  }

  // ATTACH — la demande rejoint un lead EXISTANT : aucune création de lead, donc
  // aucun doublon. Transaction : action d'historique + marquage de l'email (le
  // lead lui-même n'est pas modifié, cf. plus bas).
  if (body.action === 'attach') {
    const target = await prisma.lead.findUnique({ where: { id: body.leadId } });
    if (!target) throw new HttpError(400, 'Lead cible introuvable');
    const base = toInbound(row as unknown as InboundRow);
    const via = base.sourceDetail ? `${base.sourceLabel} — ${base.sourceDetail}` : base.sourceLabel;

    const out = await prisma.$transaction(async (tx) => {
      // Type 'note' VOLONTAIREMENT : 'email' appartient à FOLLOWUP_TYPES
      // (lib/goals.ts) et créditerait le commercial d'une relance qu'il n'a pas
      // faite dans ses objectifs du mois. 'note' n'entre dans aucun compteur.
      const created = await createAction(tx as PrismaClient, {
        id: randomUUID(),
        leadId: target.id,
        authorId: target.commercialId,
        type: 'note',
        date: receivedDayISO(base.receivedAt),
        result: `Demande entrante — ${via}`,
        notes: `Objet : ${base.subject}\n\n${base.excerpt}`,
      } as LeadAction);

      // Le lead cible n'est PAS modifié. Il repassait en chaud jusqu'ici (revenir
      // sur le même bateau est un signal d'achat fort, et un lead chaud sans
      // prochaine action passe en ROUGE) — mais depuis le retour terrain 2026-09
      // le système ne pose plus la température, c'est le commercial qui décide.
      //
      // Ce qui reste : l'action « Demande entrante » dans l'historique de la
      // fiche, et l'email en « Traités » dans la file. `lastActionDate` n'est
      // toujours pas touchée — personne n'a encore rappelé ce prospect, donc les
      // alertes d'inactivité continuent de le signaler, et c'est VRAI.
      const updated = await tx.inboundEmail.update({
        where: { id }, data: { status: 'rattache', leadId: target.id },
      });
      return { created, updated };
    });

    // Pas de `lead` dans la réponse : aucun lead n'a été modifié, en annoncer un
    // laisserait croire le contraire (le champ est optionnel, cf. patchInbound).
    return { inbound: toInbound(out.updated as unknown as InboundRow), action: out.created };
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
