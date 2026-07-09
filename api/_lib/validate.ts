import { z } from 'zod';
import { HttpError } from './http.js';

// Validation zod des ÉCRITURES (correctif audit #2). Principe : ne jamais faire
// confiance au client — l'API valide même ce que le front garantit. Réglages
// validés :
//  - bornes de taille LARGES mais finies (on attrape le déraisonnable, jamais
//    de champ illimité) ;
//  - enums validés STRICTEMENT contre les valeurs autorisées (cœur du correctif :
//    aucun statut/type inexistant ne doit atteindre la base) ;
//  - champs INCONNUS ignorés/strippés (tolérance aux évolutions front/API) —
//    comportement par défaut de z.object(). Conséquence utile : l'`id` n'étant
//    pas dans les schémas PATCH, il est strippé -> un PATCH ne peut jamais
//    renommer une clé primaire.
//  - sentinelles '' conservées (décision D3) : les champs "vides" du domaine
//    valent '' et restent valides.
//
// ⚠️ Listes d'enums DUPLIQUÉES ici (valeurs figées) volontairement : `api/` ne
// doit RIEN importer de `src/` au runtime (découplage Lot 4). Source de vérité =
// src/data/types.ts. À garder en phase si un enum évolue (rare).

const LEAD_STATUSES = ['nouveau', 'a_contacter', 'contacte', 'qualifie', 'devis_envoye', 'negociation', 'en_conclusion', 'signe', 'perdu', 'reporte'] as const;
const ACTION_TYPES = ['appel', 'email', 'sms', 'whatsapp', 'rdv', 'visite', 'devis', 'relance', 'negociation', 'conclusion', 'note', 'autre'] as const;
const TEMPERATURES = ['froid', 'tiede', 'chaud'] as const;
const PRIORITIES = ['basse', 'normale', 'haute', 'critique'] as const;
const BOAT_TYPES = ['Moteur', 'Voile', 'Semi-rigide'] as const;
const BOAT_CONDITIONS = ['Neuf', 'BO', 'DV'] as const;
const CALENDAR_CATEGORIES = ['reunion', 'conge', 'deplacement', 'perso', 'autre'] as const;
const TEMPLATE_TYPES = ['email', 'sms', 'whatsapp'] as const;

// --- briques communes (bornes larges mais finies) ---
const SHORT_MAX = 2_000;    // champs "courts" : noms, emails, sources, titres…
const LONG_MAX = 50_000;    // champs "longs" : commentaires, notes, corps de modèle…
const NUM_MAX = 1e15;       // borne numérique de bon sens (finie)
const BATCH_MAX = 2_000;    // taille max d'un enregistrement par lot

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'id mal formé');
const shortStr = z.string().max(SHORT_MAX, `trop long (max ${SHORT_MAX})`);
const longStr = z.string().max(LONG_MAX, `trop long (max ${LONG_MAX})`);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date attendue (YYYY-MM-DD)');
const dateOrEmpty = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'date attendue (YYYY-MM-DD) ou vide');
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'heure attendue (HH:mm)');
const num = z.number().finite().min(-NUM_MAX).max(NUM_MAX);
const year = z.number().int().min(1900).max(2200);
const month = z.number().int().min(1).max(12);

// enum strict OU sentinelle '' (champs du domaine à valeur vide légitime, D3).
const orEmpty = <T extends z.ZodTypeAny>(schema: T) => z.union([schema, z.literal('')]);

// --- schémas par entité (create = requis complets ; patch = .partial() SANS id) ---

const leadShape = {
  id,
  createdAt: dateStr,
  source: shortStr,
  commercialId: id,
  firstName: shortStr,
  lastName: shortStr,
  phone: shortStr,
  email: shortStr,
  boatType: orEmpty(z.enum(BOAT_TYPES)),
  boatCondition: orEmpty(z.enum(BOAT_CONDITIONS)),
  boatInterest: shortStr,
  brand: shortStr,
  budget: num.nullable(),
  status: z.enum(LEAD_STATUSES),
  contactDate: dateOrEmpty,
  quoteAmount: num.nullable(),
  probability: num.nullable(),
  currentBoat: shortStr,
  comments: longStr,
  deliveryDate: dateOrEmpty,
  temperature: z.enum(TEMPERATURES),
  priority: z.enum(PRIORITIES),
  nextActionType: orEmpty(z.enum(ACTION_TYPES)),
  nextActionDate: dateOrEmpty,
  nextActionTime: hhmm.nullish(),
  nextActionEndTime: hhmm.nullish(),
  lastActionDate: dateOrEmpty,
  lossReason: shortStr,
  signedAt: dateOrEmpty,
  lostAt: dateOrEmpty,
  reportedAt: dateOrEmpty,
};
const LeadCreate = z.object(leadShape);
const LeadPatch = z.object(leadShape).omit({ id: true }).partial();

// Import en masse (chantier import/export, Étape 3). Le client n'envoie NI id NI
// commercialId (générés/résolus côté serveur) : le lead référence son commercial
// PAR NOM. Bornes finies (garde-fou) : ≤ 200 commerciaux, ≤ 5000 leads par appel.
const ImportLead = z.object(leadShape).omit({ id: true, commercialId: true }).extend({
  commercialName: z.string().min(1, 'commercial requis').max(SHORT_MAX),
});
const ImportPayloadSchema = z.object({
  commercials: z.array(z.string().min(1).max(SHORT_MAX)).max(200),
  leads: z.array(ImportLead).max(5_000),
});

const actionShape = {
  id,
  leadId: id,
  authorId: id,
  type: z.enum(ACTION_TYPES),
  date: dateStr,
  result: shortStr,
  notes: longStr,
  newStatus: z.enum(LEAD_STATUSES).nullish(),
  nextActionType: z.enum(ACTION_TYPES).nullish(),
  nextActionDate: dateOrEmpty.nullish(),
};
const ActionCreate = z.object(actionShape);
const ActionPatch = z.object(actionShape).omit({ id: true }).partial();

const commercialShape = {
  id,
  name: z.string().min(1, 'nom requis').max(SHORT_MAX),
  active: z.boolean(),
  email: shortStr.nullish(),
  signature: longStr.nullish(),
};
const CommercialCreate = z.object(commercialShape);
const CommercialPatch = z.object(commercialShape).omit({ id: true }).partial();

const templateShape = {
  id,
  type: z.enum(TEMPLATE_TYPES),
  title: shortStr,
  subject: shortStr,
  body: longStr,
};
const TemplateCreate = z.object(templateShape);
const TemplatePatch = z.object(templateShape).omit({ id: true }).partial();

const calendarShape = {
  id,
  title: z.string().min(1, 'titre requis').max(SHORT_MAX),
  date: dateStr,
  time: hhmm.nullish(),
  endTime: hhmm.nullish(),
  commercialId: id.nullish(),
  category: z.enum(CALENDAR_CATEGORIES).nullish(),
  note: longStr.nullish(),
};
const CalendarCreate = z.object(calendarShape);
const CalendarPatch = z.object(calendarShape).omit({ id: true }).partial();

const metric = z.object({ target: num.nullable(), override: num.nullable() });
const Goal = z.object({
  id,
  commercialId: id,
  year,
  month,
  prospectsCreated: metric,
  coldCalls: metric,
  followups: metric,
  meetings: metric,
  revenue: metric,
  conversionRate: metric,
});
const GoalsBatch = z.array(Goal).max(BATCH_MAX).superRefine((goals, ctx) => {
  const seen = new Set<string>();
  for (const g of goals) {
    const key = `${g.commercialId}|${g.year}|${g.month}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `doublon (commercial, année, mois) : ${key}` });
    seen.add(key);
  }
});

const MonthlyStat = z.object({
  id,
  year,
  month,
  source: shortStr,
  budget: num.nullable(),
  leads: z.number().int().min(-NUM_MAX).max(NUM_MAX).nullable(),
});
const MonthlyStatsBatch = z.array(MonthlyStat).max(BATCH_MAX).superRefine((stats, ctx) => {
  const seen = new Set<string>();
  for (const s of stats) {
    const key = `${s.year}|${s.month}|${s.source}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `doublon (année, mois, source) : ${key}` });
    seen.add(key);
  }
});

const DefaultGoalSchema = z.object({
  prospectsCreated: num.nullable(),
  coldCalls: num.nullable(),
  followups: num.nullable(),
  meetings: num.nullable(),
  revenue: num.nullable(),
  conversionRate: num.nullable(),
});

// --- exécution : 400 clair (champ + problème), jamais de 500 zod ---
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, entity: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const detail = result.error.issues.slice(0, 3)
    .map(i => `champ « ${i.path.join('.') || '(racine)'} » : ${i.message}`)
    .join(' ; ');
  throw new HttpError(400, `${entity} invalide — ${detail}`);
}

export const parseLeadCreate = (d: unknown) => parse(LeadCreate, d, 'lead');
export const parseLeadPatch = (d: unknown) => parse(LeadPatch, d, 'lead');
export const parseActionCreate = (d: unknown) => parse(ActionCreate, d, 'action');
export const parseActionPatch = (d: unknown) => parse(ActionPatch, d, 'action');
export const parseCommercialCreate = (d: unknown) => parse(CommercialCreate, d, 'commercial');
export const parseCommercialPatch = (d: unknown) => parse(CommercialPatch, d, 'commercial');
export const parseTemplateCreate = (d: unknown) => parse(TemplateCreate, d, 'modèle');
export const parseTemplatePatch = (d: unknown) => parse(TemplatePatch, d, 'modèle');
export const parseCalendarCreate = (d: unknown) => parse(CalendarCreate, d, 'événement');
export const parseCalendarPatch = (d: unknown) => parse(CalendarPatch, d, 'événement');
export const parseGoalsBatch = (d: unknown) => parse(GoalsBatch, d, 'objectifs');
export const parseMonthlyStatsBatch = (d: unknown) => parse(MonthlyStatsBatch, d, 'stats mensuelles');
export const parseDefaultGoal = (d: unknown) => parse(DefaultGoalSchema, d, 'objectifs par défaut');
export const parseImportPayload = (d: unknown) => parse(ImportPayloadSchema, d, 'import');

// Restauration d'une sauvegarde complète (chantier import/export, Étape 5).
// Enveloppe versionnée { format, version, data: AppState } : format/version stricts
// (rejet clair si non reconnu) + CHAQUE entité validée par son schéma (ids inclus,
// préservés). Bornes finies (garde-fou). Champs d'enveloppe inconnus (appVersion,
// exportedAt) strippés/ignorés.
const RESTORE_MAX = 10_000;
const RestoreEnvelopeSchema = z.object({
  format: z.literal('bob-crm-backup'),
  version: z.literal(1),
  data: z.object({
    leads: z.array(z.object(leadShape)).max(RESTORE_MAX),
    actions: z.array(z.object(actionShape)).max(RESTORE_MAX),
    commercials: z.array(z.object(commercialShape)).max(RESTORE_MAX),
    templates: z.array(z.object(templateShape)).max(RESTORE_MAX),
    calendarEvents: z.array(z.object(calendarShape)).max(RESTORE_MAX),
    goals: z.array(Goal).max(RESTORE_MAX),
    monthlyStats: z.array(MonthlyStat).max(RESTORE_MAX),
    defaultGoal: DefaultGoalSchema,
  }),
});
export const parseRestorePayload = (d: unknown) => parse(RestoreEnvelopeSchema, d, 'sauvegarde');
