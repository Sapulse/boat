import type { PrismaClient } from '@prisma/client';
import type {
  AppState, Lead, LeadAction, Commercial, MessageTemplate,
  MonthlyStat, CalendarEvent, CommercialGoal, DefaultGoal, GoalMetric,
} from '../../src/data/types.js';
import { HttpError } from './http.js';
import {
  parseLeadCreate, parseLeadPatch, parseActionCreate, parseActionPatch,
  parseCommercialCreate, parseCommercialPatch, parseTemplateCreate, parseTemplatePatch,
  parseCalendarCreate, parseCalendarPatch,
  parseGoalsBatch, parseMonthlyStatsBatch, parseDefaultGoal,
} from './validate.js';

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

function toTemplate(r: Record<string, unknown>): MessageTemplate {
  return {
    id: r.id as string,
    type: r.type as MessageTemplate['type'],
    title: r.title as string,
    subject: r.subject as string,
    body: r.body as string,
  };
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
export async function getState(prisma: PrismaClient): Promise<AppState> {
  const [leads, actions, commercials, monthlyStats, templates, calendarEvents, goals, dg] = await Promise.all([
    prisma.lead.findMany(),
    prisma.leadAction.findMany(),
    prisma.commercial.findMany(),
    prisma.monthlyStat.findMany(),
    prisma.messageTemplate.findMany(),
    prisma.calendarEvent.findMany(),
    prisma.commercialGoal.findMany(),
    prisma.defaultGoal.findUnique({ where: { id: 1 } }),
  ]);
  return {
    leads: leads.map(toLead),
    actions: actions.map(toAction),
    commercials: commercials.map(toCommercial),
    monthlyStats: monthlyStats.map(toStat),
    templates: templates.map(toTemplate),
    calendarEvents: calendarEvents.map(toCalendarEvent),
    goals: goals.map(toGoal),
    defaultGoal: dg ? toDefaultGoal(dg as Record<string, unknown>) : EMPTY_DEFAULT_GOAL,
  };
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
  const row = await prisma.lead.update({ where: { id }, data });
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
  const data = parseTemplateCreate(template) as unknown as MessageTemplate;
  const row = await prisma.messageTemplate.create({ data });
  return toTemplate(row as Record<string, unknown>);
}
export async function updateTemplate(prisma: PrismaClient, id: string, patch: Partial<MessageTemplate>): Promise<MessageTemplate> {
  const data = parseTemplatePatch(patch) as Partial<MessageTemplate>;
  const row = await prisma.messageTemplate.update({ where: { id }, data });
  return toTemplate(row as Record<string, unknown>);
}
export async function deleteTemplate(prisma: PrismaClient, id: string): Promise<void> {
  // Garde min-1 = règle CLIENT (reducer). L'API supprime sans état d'âme.
  await prisma.messageTemplate.delete({ where: { id } });
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

// Ré-exporté pour un message d'erreur homogène si besoin côté handlers.
export { HttpError };
