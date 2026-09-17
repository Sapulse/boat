import type { PrismaClient } from '@prisma/client';
import type {
  AppState, Lead, LeadAction, Commercial, MessageTemplate,
  MonthlyStat, CalendarEvent, CommercialGoal, DefaultGoal, GoalMetric, PlannedAction, TemplateCategory,
} from '../../src/data/types.js';
import { HttpError } from './http.js';
import { randomUUID } from 'node:crypto';
import {
  parseLeadCreate, parseLeadPatch, parseActionCreate, parseActionPatch,
  parseCommercialCreate, parseCommercialPatch, parseTemplateCreate, parseTemplatePatch,
  parseCalendarCreate, parseCalendarPatch,
  parseGoalsBatch, parseMonthlyStatsBatch, parseDefaultGoal, parseImportPayload, parseRestorePayload,
  parsePlannedActionUpsert, parseTemplateLayout,
} from './validate.js';
// Logique PURE partagée (même patron qu'inboundStore -> lib/inbound) : la reprise
// des prochaines actions doit être IDENTIQUE côté app, script Turso et restauration.
import { migrateLegacyNextActions, pendingActionOf, summarizeNextAction } from '../../src/lib/plannedActions.js';
import { positionsFromBackup } from '../../src/lib/templateLayout.js';

// Objectifs par défaut « vides » — dupliqué de src/data/constants
// (EMPTY_DEFAULT_GOAL) : `api/` ne doit RIEN importer de `src/` au runtime.
const EMPTY_DEFAULT_GOAL: DefaultGoal = {
  prospectsCreated: null, coldCalls: null, followups: null,
  meetings: null, revenue: null, conversionRate: null,
};

// Accès aux données côté serveur (Lot 4). Fonctions PURES d'I/O (prennent un
// PrismaClient) -> testables au harnais SANS HTTP ni cloud (scripts/harness-api.ts).
// Les handlers /api/** ne sont que de fines enveloppes autour d'elles.
//
// LE SERVEUR EST MINCE (décision D10, synchro optimiste) : la logique métier
// dérivée (jalons de dates, lastActionDate non-régressif, garde min-1 templates)
// reste dans le REDUCER partagé, calculée CÔTÉ CLIENT ; l'API ne fait que
// persister ce qu'on lui envoie. Les seuls invariants côté base sont ceux du
// schéma : cascade lead->actions (FK) et clés UNIQUE.
//
// Les mappers traduisent entre la forme DOMAINE (types AppState) et la forme
// Prisma : on masque les colonnes d'audit (createdAt/updatedAt DateTime) à la
// lecture, on aplatit/déplie GoalMetric (12 colonnes), et on convertit les
// `null` des colonnes FACULTATIVES en `undefined` (fidélité aux types du domaine ;
// les champs `number | null` du domaine — budget, cibles… — gardent leur null).

// --- helpers ---
const undef = <T>(v: T | null): T | undefined => (v == null ? undefined : v);

// --- Lead ---
type LeadRow = Record<string, unknown>;
function toLead(r: LeadRow): Lead {
  return {
    id: r.id as string,
    createdAt: r.createdAt as string,
    source: r.source as string,
    commercialId: r.commercialId as string,
    firstName: r.firstName as string,
    lastName: r.lastName as string,
    phone: r.phone as string,
    email: r.email as string,
    boatType: r.boatType as Lead['boatType'],
    boatCondition: r.boatCondition as Lead['boatCondition'],
    boatInterest: r.boatInterest as string,
    brand: r.brand as string,
    budget: (r.budget as number | null),
    status: r.status as Lead['status'],
    contactDate: r.contactDate as string,
    quoteAmount: (r.quoteAmount as number | null),
    probability: (r.probability as number | null),
    currentBoat: r.currentBoat as string,
    comments: r.comments as string,
    deliveryDate: r.deliveryDate as string,
    temperature: r.temperature as Lead['temperature'],
    priority: r.priority as Lead['priority'],
    nextActionType: r.nextActionType as Lead['nextActionType'],
    nextActionDate: r.nextActionDate as string,
    nextActionTime: undef(r.nextActionTime as string | null),
    nextActionEndTime: undef(r.nextActionEndTime as string | null),
    lastActionDate: r.lastActionDate as string,
    lossReason: r.lossReason as string,
    signedAt: r.signedAt as string,
    lostAt: r.lostAt as string,
    reportedAt: r.reportedAt as string,
    noNextActionReason: (r.noNextActionReason as string | undefined) ?? '',
    noNextActionAt: (r.noNextActionAt as string | undefined) ?? '',
  };
}

// --- PlannedAction (lot 2) --- personnes ACTIVES seulement (retrait = active false).
type PlannedRow = Record<string, unknown> & { people?: Record<string, unknown>[] };
function toPlannedAction(r: PlannedRow): PlannedAction {
  return {
    id: r.id as string,
    leadId: r.leadId as string,
    type: r.type as PlannedAction['type'],
    customLabel: r.customLabel as string,
    date: r.date as string,
    time: undef(r.time as string | null),
    endTime: undef(r.endTime as string | null),
    originalDate: r.originalDate as string,
    note: r.note as string,
    status: r.status as PlannedAction['status'],
    doneAt: undef(r.doneAt as string | null),
    doneActionId: undef(r.doneActionId as string | null),
    people: (r.people ?? [])
      .filter(p => p.active !== false)
      .map(p => ({ commercialId: p.commercialId as string, role: p.role as 'responsable' | 'participant' }))
      .sort((a, b) => (a.role === b.role ? a.commercialId.localeCompare(b.commercialId) : a.role === 'responsable' ? -1 : 1)),
  };
}

/** Colonnes d'une action programmée (sans id ni personnes). */
function plannedColumns(p: PlannedAction) {
  return {
    leadId: p.leadId, type: p.type, customLabel: p.customLabel, date: p.date,
    time: p.time ?? null, endTime: p.endTime ?? null, originalDate: p.originalDate, note: p.note,
    status: p.status, doneAt: p.doneAt ?? null, doneActionId: p.doneActionId ?? null,
  };
}

// --- LeadAction ---
function toAction(r: Record<string, unknown>): LeadAction {
  return {
    id: r.id as string,
    leadId: r.leadId as string,
    type: r.type as LeadAction['type'],
    date: r.date as string,
    result: r.result as string,
    notes: r.notes as string,
    authorId: r.authorId as string,
    newStatus: undef(r.newStatus as LeadAction['newStatus'] | null) as LeadAction['newStatus'],
    nextActionType: undef(r.nextActionType as LeadAction['nextActionType'] | null) as LeadAction['nextActionType'],
    nextActionDate: undef(r.nextActionDate as string | null),
    kind: ((r.kind as LeadAction['kind'] | undefined) ?? 'realisee'),
    plannedActionId: undef(r.plannedActionId as string | null),
  };
}

// --- Commercial --- (createdAt = colonne d'audit DateTime ; le domaine ne
// l'expose pas au-delà d'un optionnel jamais lu -> on l'omet).
function toCommercial(r: Record<string, unknown>): Commercial {
  return {
    id: r.id as string,
    name: r.name as string,
    active: r.active as boolean,
    email: undef(r.email as string | null),
    signature: undef(r.signature as string | null),
  };
}

// SEUL mapper à exposer une colonne d'AUDIT : `createdAt` date les modèles pour
// le tri « dernier créé en premier » de la page Modèles (lib/templates). Rien à
// migrer — la colonne existe depuis le Lot 1 avec @default(now()), donc les
// modèles déjà en base portent leur vraie date. `undefined` si absente (le tri
// les traite alors comme les plus anciens).
function toTemplate(r: Record<string, unknown>): MessageTemplate {
  return {
    id: r.id as string,
    type: r.type as MessageTemplate['type'],
    title: r.title as string,
    subject: r.subject as string,
    body: r.body as string,
    createdAt: (r.createdAt as Date | undefined)?.toISOString(),
    // Lot 3 : absents d'une base pas encore migrée (lecture « avant lot 3 »).
    ...(typeof r.categoryId === 'string' ? { categoryId: r.categoryId } : {}),
    ...(typeof r.position === 'number' ? { position: r.position } : {}),
  };
}

function toTemplateCategory(r: Record<string, unknown>): TemplateCategory {
  return { id: r.id as string, name: r.name as string, position: r.position as number };
}

/** '' ou catégorie inconnue -> null (« Non classés ») : jamais d'erreur de clé étrangère pour un rangement obsolète. */
async function knownCategoryId(prisma: Pick<PrismaClient, 'templateCategory'>, categoryId: string | null | undefined): Promise<string | null | undefined> {
  if (categoryId === undefined) return undefined;
  if (!categoryId) return null;
  return (await prisma.templateCategory.findUnique({ where: { id: categoryId } })) ? categoryId : null;
}

function toStat(r: Record<string, unknown>): MonthlyStat {
  return {
    id: r.id as string,
    year: r.year as number,
    month: r.month as number,
    source: r.source as string,
    budget: r.budget as number | null,
    leads: r.leads as number | null,
  };
}

function toCalendarEvent(r: Record<string, unknown>): CalendarEvent {
  return {
    id: r.id as string,
    title: r.title as string,
    date: r.date as string,
    time: undef(r.time as string | null),
    endTime: undef(r.endTime as string | null),
    commercialId: undef(r.commercialId as string | null),
    category: undef(r.category as CalendarEvent['category'] | null) as CalendarEvent['category'],
    note: undef(r.note as string | null),
  };
}

// --- CommercialGoal : 12 colonnes aplaties <-> 6 GoalMetric ---
const metric = (t: number | null, o: number | null): GoalMetric => ({ target: t, override: o });
function toGoal(r: Record<string, unknown>): CommercialGoal {
  return {
    id: r.id as string,
    commercialId: r.commercialId as string,
    year: r.year as number,
    month: r.month as number,
    prospectsCreated: metric(r.prospectsCreatedTarget as number | null, r.prospectsCreatedOverride as number | null),
    coldCalls: metric(r.coldCallsTarget as number | null, r.coldCallsOverride as number | null),
    followups: metric(r.followupsTarget as number | null, r.followupsOverride as number | null),
    meetings: metric(r.meetingsTarget as number | null, r.meetingsOverride as number | null),
    revenue: metric(r.revenueTarget as number | null, r.revenueOverride as number | null),
    conversionRate: metric(r.conversionRateTarget as number | null, r.conversionRateOverride as number | null),
  };
}
function fromGoal(g: CommercialGoal) {
  return {
    id: g.id,
    commercialId: g.commercialId,
    year: g.year,
    month: g.month,
    prospectsCreatedTarget: g.prospectsCreated.target,
    prospectsCreatedOverride: g.prospectsCreated.override,
    coldCallsTarget: g.coldCalls.target,
    coldCallsOverride: g.coldCalls.override,
    followupsTarget: g.followups.target,
    followupsOverride: g.followups.override,
    meetingsTarget: g.meetings.target,
    meetingsOverride: g.meetings.override,
    revenueTarget: g.revenue.target,
    revenueOverride: g.revenue.override,
    conversionRateTarget: g.conversionRate.target,
    conversionRateOverride: g.conversionRate.override,
  };
}

function toDefaultGoal(r: Record<string, unknown>): DefaultGoal {
  return {
    prospectsCreated: r.prospectsCreated as number | null,
    coldCalls: r.coldCalls as number | null,
    followups: r.followups as number | null,
    meetings: r.meetings as number | null,
    revenue: r.revenue as number | null,
    conversionRate: r.conversionRate as number | null,
  };
}

// ---------------------------------------------------------------------------
// Hydratation : AppState complet en une lecture (couvre getInitialState du repo).
// ---------------------------------------------------------------------------
/** Colonnes des leads / de l'historique AVANT le lot 2 (lecture d'une base pas encore migrée). */
const LEGACY_LEAD_SELECT = Object.fromEntries(['id', 'createdAt', 'source', 'commercialId', 'firstName', 'lastName', 'phone', 'email', 'boatType', 'boatCondition', 'boatInterest', 'brand', 'budget', 'status', 'contactDate', 'quoteAmount', 'probability', 'currentBoat', 'comments', 'deliveryDate', 'temperature', 'priority', 'nextActionType', 'nextActionDate', 'nextActionTime', 'nextActionEndTime', 'lastActionDate', 'lossReason', 'signedAt', 'lostAt', 'reportedAt'].map(k => [k, true]));
const LEGACY_ACTION_SELECT = Object.fromEntries(['id', 'leadId', 'authorId', 'type', 'date', 'result', 'notes', 'newStatus', 'nextActionType', 'nextActionDate'].map(k => [k, true]));

/**
 * Le schéma de la base contient-il le lot 2 ? Utilisé par la SAUVEGARDE, qui
 * doit pouvoir lire une base PAS ENCORE migrée (procédure : sauvegarde AVANT la
 * migration). L'app, elle, n'appelle jamais ce test (base déjà migrée).
 */
export async function hasLot2Schema(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: number | bigint }[]>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='planned_actions'`);
  return Number(rows[0]?.n ?? 0) === 1;
}

/**
 * Évolutions de schéma présentes dans la base (lots 2 à 5). La SAUVEGARDE doit
 * lire une base où seules certaines migrations sont passées (fenêtre de
 * maintenance : sauvegarde avant tout, puis sauvegardes intégrées entre deux
 * scripts). L'app, elle, tourne toujours sur une base complète.
 */
export interface SchemaFeatures {
  lot2: boolean;            // actions programmées
  templateLayout: boolean;  // lot 3 : catégories + ordre des modèles
}
export const ALL_FEATURES: SchemaFeatures = { lot2: true, templateLayout: true };

export async function detectSchema(prisma: PrismaClient): Promise<SchemaFeatures> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table'`);
  const has = (t: string) => tables.some(r => r.name === t);
  return { lot2: has('planned_actions'), templateLayout: has('template_categories') };
}

/** Colonnes des modèles AVANT le lot 3. */
const LEGACY_TEMPLATE_SELECT = { id: true, createdAt: true, type: true, title: true, subject: true, body: true } as const;

/**
 * `schema: 'avant-lot2'` (sauvegarde d'une base non migrée) : leads et historique
 * lus SANS les colonnes du lot 2, et `plannedActions` ABSENT de l'état renvoyé —
 * restaurer ce fichier déclenchera la reprise des prochaines actions.
 * `features` (plus fin) : lot par lot ; `schema: 'avant-lot2'` = aucune évolution.
 */
export async function getState(prisma: PrismaClient, opts: { schema?: 'courant' | 'avant-lot2'; features?: SchemaFeatures } = {}): Promise<AppState> {
  const f: SchemaFeatures = opts.features ?? (opts.schema === 'avant-lot2' ? { lot2: false, templateLayout: false } : ALL_FEATURES);
  const legacy = !f.lot2;
  const [leads, actions, commercials, monthlyStats, templates, calendarEvents, goals, dg, planned] = await Promise.all([
    legacy ? prisma.lead.findMany({ select: LEGACY_LEAD_SELECT }) : prisma.lead.findMany(),
    legacy ? prisma.leadAction.findMany({ select: LEGACY_ACTION_SELECT }) : prisma.leadAction.findMany(),
    prisma.commercial.findMany(),
    prisma.monthlyStat.findMany(),
    // Plus récent d'abord : la page Modèles retrie de toute façon (lib/templates,
    // pour couvrir le mode localStorage et les créations optimistes), mais autant
    // que la lecture serveur arrive déjà dans le bon ordre.
    f.templateLayout
      ? prisma.messageTemplate.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'desc' }] })
      : prisma.messageTemplate.findMany({ select: LEGACY_TEMPLATE_SELECT, orderBy: { createdAt: 'desc' } }),
    prisma.calendarEvent.findMany(),
    prisma.commercialGoal.findMany(),
    prisma.defaultGoal.findUnique({ where: { id: 1 } }),
    legacy ? Promise.resolve([]) : prisma.plannedAction.findMany({ include: { people: true } }),
  ]);
  const categories = f.templateLayout ? (await prisma.templateCategory.findMany({ orderBy: { position: 'asc' } })).map(r => toTemplateCategory(r as unknown as Record<string, unknown>)) : undefined;
  const withLayout = <T extends object>(st: T): T => (categories ? { ...st, templateCategories: categories } : st);
  if (legacy) {
    const state = {
      leads: leads.map(l => { const x = toLead(l as LeadRow); delete x.noNextActionReason; delete x.noNextActionAt; return x; }),
      actions: actions.map(a => { const x = toAction(a as Record<string, unknown>); delete x.kind; delete x.plannedActionId; return x; }),
      commercials: commercials.map(toCommercial),
      monthlyStats: monthlyStats.map(toStat),
      templates: templates.map(toTemplate),
      calendarEvents: calendarEvents.map(toCalendarEvent),
      goals: goals.map(toGoal),
      defaultGoal: dg ? toDefaultGoal(dg as Record<string, unknown>) : EMPTY_DEFAULT_GOAL,
    };
    return withLayout(state) as unknown as AppState; // plannedActions volontairement absent
  }
  return withLayout({
    leads: leads.map(l => toLead(l as LeadRow)),
    actions: actions.map(a => toAction(a as Record<string, unknown>)),
    commercials: commercials.map(toCommercial),
    monthlyStats: monthlyStats.map(toStat),
    templates: templates.map(toTemplate),
    calendarEvents: calendarEvents.map(toCalendarEvent),
    goals: goals.map(toGoal),
    defaultGoal: dg ? toDefaultGoal(dg as Record<string, unknown>) : EMPTY_DEFAULT_GOAL,
    plannedActions: planned.map(p => toPlannedAction(p as unknown as PlannedRow)),
  });
}

// ---------------------------------------------------------------------------
// Actions programmées (lot 2) — PUT /api/planned-actions/:id = UPSERT complet,
// idempotent (le client renvoie l'état post-reducer). Personnes : upsert par
// (action, commercial) ; une personne absente du corps passe active=false
// (aucun DELETE). Une seule transaction.
// ---------------------------------------------------------------------------
export async function upsertPlannedAction(prisma: PrismaClient, id: string, body: unknown): Promise<PlannedAction> {
  const p = parsePlannedActionUpsert(body) as unknown as PlannedAction;
  if (p.id !== id) throw new HttpError(400, 'action programmée invalide — id du corps différent de celui du chemin');
  const cols = plannedColumns(p);
  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.plannedAction.findUnique({ where: { id } });
    if (existing && existing.leadId !== p.leadId) throw new HttpError(400, 'action programmée invalide — le lead ne peut pas changer');
    await tx.plannedAction.upsert({ where: { id }, create: { id, ...cols }, update: cols });
    for (const person of p.people) {
      await tx.plannedActionPerson.upsert({
        where: { plannedActionId_commercialId: { plannedActionId: id, commercialId: person.commercialId } },
        create: { id: `${id}:${person.commercialId}`, plannedActionId: id, commercialId: person.commercialId, role: person.role, active: true },
        update: { role: person.role, active: true },
      });
    }
    await tx.plannedActionPerson.updateMany({
      where: { plannedActionId: id, commercialId: { notIn: p.people.map(x => x.commercialId) }, active: true },
      data: { active: false },
    });
    await realignLeadSummary(tx, p.leadId);
    return tx.plannedAction.findUniqueOrThrow({ where: { id }, include: { people: true } });
  });
  return toPlannedAction(row as unknown as PlannedRow);
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Le SERVEUR fait foi pour le résumé nextAction* d'un lead qui a des actions
 * programmées : il est recalculé depuis l'action à faire après chaque écriture
 * de lead ou d'action programmée. Un onglet resté ouvert (données locales en
 * retard) ne peut donc plus ramener une ancienne date sur le lead pendant que
 * l'agenda affiche la nouvelle — et le résultat ne dépend pas de l'ordre
 * d'arrivée des écritures (PATCH lead / PUT action).
 *  - lead SANS aucune action programmée : champs laissés tels quels (import,
 *    données d'avant le lot 2 — la reprise les convertit) ;
 *  - le motif « Aucune prochaine action » n'est JAMAIS touché ici (l'effacer
 *    dépendrait de l'ordre des écritures) : c'est le client qui l'expire.
 */
async function realignLeadSummary(tx: Tx, leadId: string): Promise<void> {
  const rows = await tx.plannedAction.findMany({ where: { leadId }, include: { people: true } });
  if (rows.length === 0) return;
  const s = summarizeNextAction(pendingActionOf(leadId, rows.map(r => toPlannedAction(r as unknown as PlannedRow))));
  await tx.lead.updateMany({
    where: { id: leadId },
    data: { nextActionType: s.nextActionType, nextActionDate: s.nextActionDate, nextActionTime: s.nextActionTime ?? null, nextActionEndTime: s.nextActionEndTime ?? null },
  });
}

// ---------------------------------------------------------------------------
// Leads (l'id est fourni par le client — génération côté client conservée).
// ---------------------------------------------------------------------------
export async function createLead(prisma: PrismaClient, lead: Lead): Promise<Lead> {
  // Validation zod AVANT toute écriture ; on persiste le résultat PARSÉ
  // (champs inconnus strippés -> jamais transmis à Prisma).
  const data = parseLeadCreate(lead) as unknown as Lead;
  const row = await prisma.lead.create({ data });
  return toLead(row as LeadRow);
}
export async function updateLead(prisma: PrismaClient, id: string, patch: Partial<Lead>): Promise<Lead> {
  // Le schéma PATCH n'a pas de champ `id` -> strippé : un PATCH ne peut jamais
  // renommer une clé primaire (l'id du chemin fait foi).
  const data = parseLeadPatch(patch) as Partial<Lead>;
  const row = await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data });
    await realignLeadSummary(tx, id);
    return tx.lead.findUniqueOrThrow({ where: { id } });
  });
  return toLead(row as LeadRow);
}
export async function deleteLead(prisma: PrismaClient, id: string): Promise<void> {
  // La cascade lead->actions est assurée par la FK (ON DELETE CASCADE, Lot 1).
  await prisma.lead.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Actions.
// ---------------------------------------------------------------------------
export async function createAction(prisma: PrismaClient, action: LeadAction): Promise<LeadAction> {
  const data = parseActionCreate(action) as unknown as LeadAction;
  const row = await prisma.leadAction.create({ data });
  return toAction(row as Record<string, unknown>);
}
export async function updateAction(prisma: PrismaClient, id: string, patch: Partial<LeadAction>): Promise<LeadAction> {
  const data = parseActionPatch(patch) as Partial<LeadAction>;
  const row = await prisma.leadAction.update({ where: { id }, data });
  return toAction(row as Record<string, unknown>);
}
export async function deleteAction(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.leadAction.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Commerciaux (addCommercial/updateCommercial/toggleCommercial : toggle = PATCH
// active côté client, l'API pose juste la valeur).
// ---------------------------------------------------------------------------
export async function createCommercial(prisma: PrismaClient, commercial: Commercial): Promise<Commercial> {
  const data = parseCommercialCreate(commercial) as unknown as Commercial;
  const row = await prisma.commercial.create({ data });
  return toCommercial(row as Record<string, unknown>);
}
export async function updateCommercial(prisma: PrismaClient, id: string, patch: Partial<Commercial>): Promise<Commercial> {
  const data = parseCommercialPatch(patch) as Partial<Commercial>;
  const row = await prisma.commercial.update({ where: { id }, data });
  return toCommercial(row as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Modèles de message.
// ---------------------------------------------------------------------------
export async function createTemplate(prisma: PrismaClient, template: MessageTemplate): Promise<MessageTemplate> {
  const parsed = parseTemplateCreate(template) as unknown as MessageTemplate & { categoryId?: string | null };
  const data = { ...parsed, categoryId: await knownCategoryId(prisma, parsed.categoryId) };
  const row = await prisma.messageTemplate.create({ data });
  return toTemplate(row as Record<string, unknown>);
}
export async function updateTemplate(prisma: PrismaClient, id: string, patch: Partial<MessageTemplate>): Promise<MessageTemplate> {
  const parsed = parseTemplatePatch(patch) as Partial<MessageTemplate> & { categoryId?: string | null };
  const data = { ...parsed, categoryId: await knownCategoryId(prisma, parsed.categoryId) };
  const row = await prisma.messageTemplate.update({ where: { id }, data });
  return toTemplate(row as Record<string, unknown>);
}
export async function deleteTemplate(prisma: PrismaClient, id: string): Promise<void> {
  // Garde min-1 = règle CLIENT (reducer). L'API supprime sans état d'âme.
  await prisma.messageTemplate.delete({ where: { id } });
}

/**
 * Lot 3 — rangement groupé (PUT /template-layout) : liste COMPLÈTE des catégories
 * + placement (catégorie, rang) des modèles, en UNE transaction.
 *  1. catégories créées / renommées / réordonnées (upsert) ;
 *  2. placements appliqués aux modèles EXISTANTS (un modèle supprimé ailleurs
 *     est ignoré ; catégorie inconnue -> « Non classés ») ;
 *  3. catégories absentes de la liste = supprimées, SEULEMENT si vides :
 *     sinon 409, rien n'est écrit (jamais de modèle supprimé ni déplacé en cascade).
 */
export async function saveTemplateLayout(prisma: PrismaClient, body: unknown): Promise<{ categories: TemplateCategory[] }> {
  const { categories, placements } = parseTemplateLayout(body);
  const ids = new Set(categories.map(c => c.id));
  const saved = await prisma.$transaction(async (tx) => {
    for (const c of categories) {
      await tx.templateCategory.upsert({ where: { id: c.id }, create: { id: c.id, name: c.name, position: c.position }, update: { name: c.name, position: c.position } });
    }
    for (const p of placements) {
      const categoryId = p.categoryId && ids.has(p.categoryId) ? p.categoryId : null;
      await tx.messageTemplate.updateMany({ where: { id: p.id }, data: { categoryId, position: p.position } });
    }
    const removed = await tx.templateCategory.findMany({ where: { id: { notIn: [...ids] } } });
    for (const r of removed) {
      const n = await tx.messageTemplate.count({ where: { categoryId: r.id } });
      if (n > 0) throw new HttpError(409, `La catégorie « ${r.name} » contient encore ${n} modèle(s) : suppression refusée.`);
      await tx.templateCategory.delete({ where: { id: r.id } });
    }
    return tx.templateCategory.findMany({ orderBy: { position: 'asc' } });
  });
  return { categories: saved.map(r => toTemplateCategory(r as unknown as Record<string, unknown>)) };
}

// ---------------------------------------------------------------------------
// Événements d'agenda libres.
// ---------------------------------------------------------------------------
export async function createCalendarEvent(prisma: PrismaClient, event: CalendarEvent): Promise<CalendarEvent> {
  const data = parseCalendarCreate(event) as unknown as CalendarEvent;
  const row = await prisma.calendarEvent.create({ data });
  return toCalendarEvent(row as Record<string, unknown>);
}
export async function updateCalendarEvent(prisma: PrismaClient, id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const data = parseCalendarPatch(patch) as Partial<CalendarEvent>;
  const row = await prisma.calendarEvent.update({ where: { id }, data });
  return toCalendarEvent(row as Record<string, unknown>);
}
export async function deleteCalendarEvent(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.calendarEvent.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Batch (les actions « remplace tout le tableau » du reducer -> upsert/delete
// différentiel, décision D10). Transaction : on supprime ce qui n'est plus là,
// on upsert le reste.
// ---------------------------------------------------------------------------
export async function saveGoals(prisma: PrismaClient, goals: CommercialGoal[]): Promise<CommercialGoal[]> {
  // Valide AVANT la transaction : tableau exigé (fini le TypeError sur un objet),
  // month 1-12, unicité intra-payload (commercial, année, mois).
  const parsed = parseGoalsBatch(goals) as unknown as CommercialGoal[];
  const ids = parsed.map(g => g.id);
  await prisma.$transaction([
    prisma.commercialGoal.deleteMany({ where: { id: { notIn: ids } } }),
    ...parsed.map(g => prisma.commercialGoal.upsert({ where: { id: g.id }, create: fromGoal(g), update: fromGoal(g) })),
  ]);
  return parsed;
}

export async function saveMonthlyStats(prisma: PrismaClient, stats: MonthlyStat[]): Promise<MonthlyStat[]> {
  const parsed = parseMonthlyStatsBatch(stats) as unknown as MonthlyStat[];
  const ids = parsed.map(s => s.id);
  const data = (s: MonthlyStat) => ({ id: s.id, year: s.year, month: s.month, source: s.source, budget: s.budget, leads: s.leads });
  await prisma.$transaction([
    prisma.monthlyStat.deleteMany({ where: { id: { notIn: ids } } }),
    ...parsed.map(s => prisma.monthlyStat.upsert({ where: { id: s.id }, create: data(s), update: data(s) })),
  ]);
  return parsed;
}

export async function saveDefaultGoal(prisma: PrismaClient, dg: DefaultGoal): Promise<DefaultGoal> {
  const parsed = parseDefaultGoal(dg) as DefaultGoal;
  await prisma.defaultGoal.upsert({ where: { id: 1 }, create: { id: 1, ...parsed }, update: { ...parsed } });
  return parsed;
}

// ---------------------------------------------------------------------------
// Import en masse (chantier import/export, Étape 3). UNE transaction atomique :
// commerciaux manquants d'abord (FK), puis leads. Idempotent sur les commerciaux
// (résolus PAR NOM). Toute la validation zod (schémas existants) se fait AVANT la
// transaction -> une entité invalide = 0 écriture. Le client n'envoie ni id ni
// commercialId : ids générés serveur, commercialId résolu depuis le nom.
// ---------------------------------------------------------------------------
export interface ImportPayload {
  commercials: string[];
  leads: Array<Omit<Lead, 'id' | 'commercialId'> & { commercialName: string }>;
}
export interface ImportReport {
  commercialsCreated: number;
  commercialsExisting: number;
  leadsCreated: number;
}

// Même normalisation de nom que le client (casse + accents) pour un matching stable.
const normName = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export async function bulkImport(prisma: PrismaClient, payload: ImportPayload): Promise<ImportReport> {
  const { commercials, leads } = parseImportPayload(payload) as unknown as ImportPayload;

  // 1) Map nom -> id des commerciaux EXISTANTS (source d'idempotence).
  const existing = await prisma.commercial.findMany({ select: { id: true, name: true } });
  const byName = new Map<string, string>();
  for (const c of existing) byName.set(normName(c.name), c.id);

  // 2) Commerciaux à créer : noms demandés absents (dédupliqués).
  const toCreate: { id: string; name: string; active: boolean }[] = [];
  const requested = new Set<string>();
  for (const name of commercials) {
    const key = normName(name);
    if (requested.has(key)) continue;
    requested.add(key);
    if (byName.has(key)) continue;
    const c = parseCommercialCreate({ id: randomUUID(), name, active: true }) as unknown as Commercial;
    byName.set(key, c.id);
    toCreate.push({ id: c.id, name: c.name, active: c.active });
  }

  // 3) Leads : résolution commercialId PAR NOM + validation zod (id/commercialId ajoutés).
  const leadData = leads.map((l, i) => {
    const cid = byName.get(normName(l.commercialName));
    if (!cid) throw new HttpError(400, `ligne d'import ${i + 1} : commercial « ${l.commercialName} » introuvable`);
    // parseLeadCreate strippe la clé inconnue `commercialName`.
    return parseLeadCreate({ ...l, id: randomUUID(), commercialId: cid }) as unknown as Lead;
  });

  // 4) Écriture ATOMIQUE : commerciaux (FK) puis leads. createMany -> 2 statements.
  await prisma.$transaction([
    ...(toCreate.length ? [prisma.commercial.createMany({ data: toCreate })] : []),
    ...(leadData.length ? [prisma.lead.createMany({ data: leadData })] : []),
  ]);

  return {
    commercialsCreated: toCreate.length,
    commercialsExisting: requested.size - toCreate.length,
    leadsCreated: leadData.length,
  };
}

// ---------------------------------------------------------------------------
// Restauration d'une sauvegarde complète (chantier import/export, Étape 5).
// REMPLACEMENT TOTAL, ATOMIQUE, id-préservant. UNE transaction : (1) valider
// l'enveloppe + chaque entité AVANT (fichier invalide -> 400, base intacte) ;
// (2) vider toutes les tables ordre FK-safe (enfants d'abord) ; (3) recréer avec
// les ids d'origine, ordre FK (commerciaux -> leads -> actions -> reste). Erreur
// en cours -> rollback complet. Distinct de bulkImport : ids conservés, tout
// l'AppState, sémantique de remplacement.
// ---------------------------------------------------------------------------
export interface RestorePayload {
  format: string;
  version: number;
  data: AppState;
}
export interface RestoreReport {
  commercials: number; leads: number; actions: number;
  templates: number; calendarEvents: number; goals: number; monthlyStats: number;
  plannedActions: number;
  templateCategories: number;
}

export async function restoreBackup(prisma: PrismaClient, payload: RestorePayload): Promise<RestoreReport> {
  // Valide l'enveloppe + toutes les entités (ids inclus) AVANT toute écriture.
  // Les objets renvoyés sont nettoyés (clés inconnues + colonnes d'audit strippées).
  const { data: d } = parseRestorePayload(payload) as unknown as { data: AppState };

  // Lot 2 : une sauvegarde d'AVANT le lot 2 n'a pas de `plannedActions`. Ses
  // prochaines actions (champs du lead) sont alors reprises exactement comme par
  // le script de migration — sinon elles disparaîtraient de l'agenda.
  const rawPlanned = (payload as { data?: { plannedActions?: unknown } } | null)?.data?.plannedActions;
  const planned: PlannedAction[] = rawPlanned === undefined ? migrateLegacyNextActions(d.leads, []) : d.plannedActions;
  const people = planned.flatMap(p => p.people.map(x => ({
    id: `${p.id}:${x.commercialId}`, plannedActionId: p.id, commercialId: x.commercialId, role: x.role, active: true,
  })));
  // Lot 3 : l'ordre d'affichage du fichier est FIGÉ en positions (la restauration
  // remet createdAt à l'heure du jour) ; catégorie inconnue -> « Non classés ».
  const categories = d.templateCategories ?? [];
  // La validation retire createdAt (colonne d'audit) : on le relit dans le fichier
  // BRUT, le temps de calculer l'ordre, puis on ne l'écrit pas.
  const rawTemplates = ((payload as { data?: { templates?: unknown } } | null)?.data?.templates ?? []) as { id?: string; createdAt?: string }[];
  const rawCreated = new Map(rawTemplates.map(t => [t.id, typeof t.createdAt === 'string' ? t.createdAt : undefined]));
  const templates = positionsFromBackup(d.templates.map(t => ({ ...t, createdAt: rawCreated.get(t.id) })), categories)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ createdAt: _c, ...t }) => ({ ...t, categoryId: t.categoryId ?? null }));

  await prisma.$transaction([
    // (2) Purge FK-safe : enfants d'abord.
    prisma.plannedActionPerson.deleteMany(),
    prisma.plannedAction.deleteMany(),
    prisma.leadAction.deleteMany(),
    prisma.commercialGoal.deleteMany(),
    prisma.calendarEvent.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.commercial.deleteMany(),
    prisma.messageTemplate.deleteMany(),
    prisma.templateCategory.deleteMany(),
    prisma.monthlyStat.deleteMany(),
    prisma.defaultGoal.deleteMany(),
    // (3) Recréation ordre FK : commerciaux -> leads -> actions -> reste.
    ...(d.commercials.length ? [prisma.commercial.createMany({ data: d.commercials })] : []),
    ...(d.leads.length ? [prisma.lead.createMany({ data: d.leads })] : []),
    ...(d.actions.length ? [prisma.leadAction.createMany({ data: d.actions })] : []),
    ...(planned.length ? [prisma.plannedAction.createMany({ data: planned.map(p => ({ id: p.id, ...plannedColumns(p) })) })] : []),
    ...(people.length ? [prisma.plannedActionPerson.createMany({ data: people })] : []),
    ...(categories.length ? [prisma.templateCategory.createMany({ data: categories.map(c => ({ id: c.id, name: c.name, position: c.position })) })] : []),
    ...(templates.length ? [prisma.messageTemplate.createMany({ data: templates })] : []),
    ...(d.calendarEvents.length ? [prisma.calendarEvent.createMany({ data: d.calendarEvents })] : []),
    ...(d.goals.length ? [prisma.commercialGoal.createMany({ data: d.goals.map(fromGoal) })] : []),
    ...(d.monthlyStats.length ? [prisma.monthlyStat.createMany({ data: d.monthlyStats })] : []),
    prisma.defaultGoal.create({ data: { id: 1, ...d.defaultGoal } }),
  ]);

  return {
    commercials: d.commercials.length, leads: d.leads.length, actions: d.actions.length,
    templates: d.templates.length, calendarEvents: d.calendarEvents.length,
    goals: d.goals.length, monthlyStats: d.monthlyStats.length,
    plannedActions: planned.length,
    templateCategories: categories.length,
  };
}

// ============================================================
// Rate-limit du login (durcissement auth, commit 2) — accès à la table isolée
// login_attempts. Le cœur pur (fenêtrage, décision) vit dans loginRateLimit.ts.
// ============================================================

/**
 * Incrémente ATOMIQUEMENT le compteur de la clé (ip|fenêtre) et renvoie sa
 * nouvelle valeur. `INSERT … ON CONFLICT DO UPDATE … RETURNING` = une seule
 * instruction SQLite (writer unique) -> N requêtes parallèles obtiennent des
 * comptes distincts, sans lecture-puis-écriture concurrente. Paramétré (pas
 * d'interpolation) -> pas d'injection.
 */
export async function bumpLoginAttempt(prisma: PrismaClient, key: string, windowStart: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    INSERT INTO login_attempts ("key", "count", "windowStart")
    VALUES (${key}, 1, ${windowStart})
    ON CONFLICT("key") DO UPDATE SET "count" = "count" + 1
    RETURNING "count"
  `;
  return Number(rows[0]?.count ?? 0);
}

/** Réinitialise le compteur d'une fenêtre (appelé sur login RÉUSSI : l'utilisateur
 *  légitime n'est pas pénalisé par ses fautes de frappe de la même fenêtre).
 *  Correspondance EXACTE sur la clé (pas de LIKE sur une IP d'en-tête falsifiable). */
export async function clearLoginAttempt(prisma: PrismaClient, key: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM login_attempts WHERE "key" = ${key}`;
}

/** Purge best-effort des fenêtres passées (borne la taille de la table). Filtre
 *  sur la colonne entière windowStart -> aucune surface d'injection. */
export async function purgeOldLoginAttempts(prisma: PrismaClient, cutoffSec: number): Promise<void> {
  await prisma.$executeRaw`DELETE FROM login_attempts WHERE "windowStart" < ${cutoffSec}`;
}

// Ré-exporté pour un message d'erreur homogène si besoin côté handlers.
export { HttpError };
