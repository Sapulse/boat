import type {
  ActionType, Commercial, Lead, LeadAction, LeadStatus, PlannedAction, PlannedActionPerson,
} from '../data/types.js';
// Suffixe .js : ce module est aussi chargé par l'API (restauration) en ESM Node.
import { ACTION_TYPES, NO_NEXT_ACTION_REASONS } from '../data/constants.js';

// ===========================================================================
// Actions programmées (lot 2 — « prochaine action obligatoire + agenda »).
// Module PUR (sans React ni I/O) : toute la logique métier du lot vit ici et
// est prouvée au harnais (scripts/harness-planned-actions.ts). Le reducer, la
// synchro et les écrans ne font qu'appeler ces fonctions.
//
// Décisions appliquées (validées le 2026-09-16) :
//  - UNE seule action « à faire » par lead. Reprogrammer met à jour cette
//    action ; si la DATE change, une trace « report » va dans l'historique.
//  - Les champs nextAction* du lead sont un RÉSUMÉ recalculé depuis l'action à
//    faire (summarizeNextAction) : alertes, colonnes et tableau de bord restent
//    branchés dessus sans réécriture.
//  - « Aucune prochaine action » : motif obligatoire (liste + Autre), expire dès
//    qu'une action est programmée. Proposition A pour les alertes (cf. utils).
//  - Reporté : prochaine action OBLIGATOIRE avec date (« Aucune » interdite).
//    Signé / Perdu : fenêtre avec « Passer ».
//  - Responsables / participants : commerciaux actifs de l'Équipe, « Non
//    attribué » exclu.
// ===========================================================================

// ---------------------------------------------------------------------------
// Petits utilitaires
// ---------------------------------------------------------------------------

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** "YYYY-MM-DD" -> "12/09" (année omise : lisible dans une ligne d'historique). */
function dayMonth(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso;
}

function whenLabel(date: string, time?: string): string {
  return time ? `${dayMonth(date)} à ${time}` : dayMonth(date);
}

/** Libellé humain d'une action programmée : le texte libre pour « Autre ». */
export function plannedActionLabel(pa: Pick<PlannedAction, 'type' | 'customLabel'>): string {
  if (pa.type === 'autre' && pa.customLabel.trim()) return pa.customLabel.trim();
  return ACTION_TYPES.find(t => t.value === pa.type)?.label ?? pa.type;
}

/**
 * Statuts « fermés » pour la planification : Signé et Perdu. Leurs actions à
 * faire ne sont ni en retard ni « à planifier ». Reporté N'EN FAIT PAS partie :
 * un lead reporté porte justement une action de reprise, qui doit apparaître
 * dans l'agenda et passer en retard si elle est oubliée.
 */
export const PLANNING_CLOSED_STATUSES: readonly LeadStatus[] = ['signe', 'perdu'];
export const isPlanningClosed = (status: LeadStatus) => PLANNING_CLOSED_STATUSES.includes(status);

// ---------------------------------------------------------------------------
// Personnes : responsables et participants
// ---------------------------------------------------------------------------

/** « Non attribué » est un commercial technique (import, boîte de réception), jamais une personne. */
export function isUnassignedCommercial(c: Pick<Commercial, 'name'>): boolean {
  return fold(c.name) === 'non attribue';
}

/** Commerciaux sélectionnables comme responsable / participant. */
export function eligibleCommercials(commercials: Commercial[]): Commercial[] {
  return commercials.filter(c => c.active && !isUnassignedCommercial(c));
}

/** Personnes par défaut : le commercial du lead en responsable — s'il est éligible. */
export function defaultPeople(lead: Pick<Lead, 'commercialId'>, commercials: Commercial[]): PlannedActionPerson[] {
  return eligibleCommercials(commercials).some(c => c.id === lead.commercialId)
    ? [{ commercialId: lead.commercialId, role: 'responsable' }]
    : [];
}

/** Dédoublonne par commercial ; une personne à la fois responsable et participante reste responsable. */
export function normalizePeople(people: PlannedActionPerson[]): PlannedActionPerson[] {
  const byId = new Map<string, PlannedActionPerson>();
  for (const p of people) {
    const prev = byId.get(p.commercialId);
    if (!prev || (prev.role === 'participant' && p.role === 'responsable')) byId.set(p.commercialId, { commercialId: p.commercialId, role: p.role });
  }
  return [...byId.values()];
}

/** L'action concerne-t-elle ce commercial (responsable OU participant) ? Base de l'agenda par personne. */
export function concernsCommercial(pa: Pick<PlannedAction, 'people'>, commercialId: string): boolean {
  return pa.people.some(p => p.commercialId === commercialId);
}

// ---------------------------------------------------------------------------
// Action à faire, résumé sur le lead, retard
// ---------------------------------------------------------------------------

const byWhen = (a: PlannedAction, b: PlannedAction) =>
  a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id);

/** L'action « à faire » du lead (la plus proche s'il en existait plusieurs — données anciennes). */
export function pendingActionOf(leadId: string, planned: PlannedAction[]): PlannedAction | undefined {
  return planned.filter(p => p.leadId === leadId && p.status === 'a_faire').sort(byWhen)[0];
}

export type NextActionSummary = Pick<Lead, 'nextActionType' | 'nextActionDate' | 'nextActionTime' | 'nextActionEndTime'>;

/** Champs résumés du lead depuis son action à faire (vides s'il n'y en a pas). */
export function summarizeNextAction(pending: PlannedAction | undefined): NextActionSummary {
  if (!pending) return { nextActionType: '', nextActionDate: '', nextActionTime: undefined, nextActionEndTime: undefined };
  return {
    nextActionType: pending.type,
    nextActionDate: pending.date,
    nextActionTime: pending.time || undefined,
    nextActionEndTime: pending.endTime || undefined,
  };
}

/**
 * Lead aligné sur ses actions programmées : résumé recalculé, et motif
 * « Aucune prochaine action » EFFACÉ dès qu'une action est à faire (il expire).
 * Renvoie la MÊME référence si rien ne change (pas de re-rendu inutile).
 */
export function withNextActionSummary(lead: Lead, planned: PlannedAction[]): Lead {
  const pending = pendingActionOf(lead.id, planned);
  const s = summarizeNextAction(pending);
  const clearReason = !!pending && !!(lead.noNextActionReason || lead.noNextActionAt);
  const same = lead.nextActionType === s.nextActionType && lead.nextActionDate === s.nextActionDate
    && (lead.nextActionTime || undefined) === s.nextActionTime && (lead.nextActionEndTime || undefined) === s.nextActionEndTime
    && !clearReason;
  if (same) return lead;
  return { ...lead, ...s, ...(clearReason ? { noNextActionReason: '', noNextActionAt: '' } : {}) };
}

/** Action à faire dont la date est passée, sur un lead non fermé (Signé / Perdu). Reste À SA DATE, en rouge. */
export function isPlannedActionOverdue(pa: PlannedAction, lead: Pick<Lead, 'status'> | undefined, todayISO: string): boolean {
  return pa.status === 'a_faire' && pa.date < todayISO && !!lead && !isPlanningClosed(lead.status);
}

/** Compteur « en retard » (pastille rouge du menu Agenda). Option : pour un seul commercial. */
export function countOverdue(planned: PlannedAction[], leads: Lead[], todayISO: string, commercialId?: string): number {
  const leadById = new Map(leads.map(l => [l.id, l]));
  return planned.filter(pa =>
    isPlannedActionOverdue(pa, leadById.get(pa.leadId), todayISO) && (!commercialId || concernsCommercial(pa, commercialId)),
  ).length;
}

/** Filtre « À planifier » : lead non fermé, sans action à faire ET sans « Aucune prochaine action » motivée. */
export function needsPlanning(lead: Lead): boolean {
  return !isPlanningClosed(lead.status) && !lead.nextActionDate && !lead.noNextActionReason;
}

// ---------------------------------------------------------------------------
// Indicateurs du tableau de bord (lot 4) — SOURCE UNIQUE partagée avec la
// pastille du menu Agenda (countOverdue), le bandeau des retards de l'Agenda et
// la vue « À planifier » des Leads (needsPlanning).
// ---------------------------------------------------------------------------

/**
 * a) Actions à faire AUJOURD'HUI. Décision du 17/09 : les actions des leads
 * Signés / Perdus sont INCLUSES (une livraison, un rendez-vous de signature
 * restent à faire). Une action à plusieurs compte UNE fois dans le total, et
 * une fois chez chaque personne concernée (filtre commercial).
 */
export function isDueToday(pa: PlannedAction, lead: Lead | undefined, todayISO: string): boolean {
  return pa.status === 'a_faire' && pa.date === todayISO && !!lead;
}

export function countDueToday(planned: PlannedAction[], leads: Lead[], todayISO: string, commercialId?: string): number {
  const leadById = new Map(leads.map(l => [l.id, l]));
  return planned.filter(pa =>
    isDueToday(pa, leadById.get(pa.leadId), todayISO) && (!commercialId || concernsCommercial(pa, commercialId)),
  ).length;
}

/** Actions en retard (liste), mêmes règles que countOverdue — bandeau de l'Agenda. Plus anciennes d'abord. */
export function overdueActions(planned: PlannedAction[], leads: Lead[], todayISO: string, commercialId?: string): PlannedAction[] {
  const leadById = new Map(leads.map(l => [l.id, l]));
  return planned
    .filter(pa => isPlannedActionOverdue(pa, leadById.get(pa.leadId), todayISO) && (!commercialId || concernsCommercial(pa, commercialId)))
    .sort(byWhen);
}

/**
 * Lead sans commercial RÉEL : « Non attribué » ou commercial inconnu (supprimé).
 * Sert à la part « non attribués » de l'indicateur « À planifier ».
 */
export function isUnassignedLead(lead: Pick<Lead, 'commercialId'>, commercials: Commercial[]): boolean {
  const c = commercials.find(x => x.id === lead.commercialId);
  return !c || isUnassignedCommercial(c);
}

export interface PlanningIndicators {
  /** a) à faire aujourd'hui */
  today: number;
  /** b) en retard (= pastille du menu) */
  overdue: number;
  /** c) leads à planifier (= vue « À planifier ») */
  toPlan: number;
  /** dont leads non attribués (total seulement : 0 quand un commercial est choisi) */
  toPlanUnassigned: number;
}

/** Les 3 indicateurs du haut du tableau de bord, pour tous ou pour UN commercial. */
export function planningIndicators(
  planned: PlannedAction[], leads: Lead[], commercials: Commercial[], todayISO: string, commercialId?: string,
): PlanningIndicators {
  const toPlanLeads = leads.filter(l => needsPlanning(l) && (!commercialId || l.commercialId === commercialId));
  return {
    today: countDueToday(planned, leads, todayISO, commercialId),
    overdue: countOverdue(planned, leads, todayISO, commercialId),
    toPlan: toPlanLeads.length,
    toPlanUnassigned: commercialId ? 0 : toPlanLeads.filter(l => isUnassignedLead(l, commercials)).length,
  };
}

/** « Aucune prochaine action » choisie et toujours valable (aucune action programmée depuis). */
export function hasExplicitNoNextAction(lead: Pick<Lead, 'noNextActionReason' | 'nextActionDate'>): boolean {
  return !!lead.noNextActionReason && !lead.nextActionDate;
}

// ---------------------------------------------------------------------------
// Historique : traces « report » et « sans suite »
// ---------------------------------------------------------------------------

/** « Appel prévu le 12/09 à 10:00, reporté au 18/09 » — ni dernière action ni objectifs (kind report). */
export function buildReportEntry(args: {
  id: string; previous: PlannedAction; newDate: string; newTime?: string; authorId: string; today: string;
}): LeadAction {
  const { id, previous, newDate, newTime, authorId, today } = args;
  return {
    id,
    leadId: previous.leadId,
    type: previous.type,
    date: today,
    result: `${plannedActionLabel(previous)} prévu le ${whenLabel(previous.date, previous.time)}, reporté au ${whenLabel(newDate, newTime)}`,
    notes: '',
    authorId,
    kind: 'report',
    plannedActionId: previous.id,
  };
}

/** « Aucune prochaine action — motif » (kind sans_suite, type note). */
export function buildNoNextActionEntry(args: { id: string; leadId: string; reason: string; authorId: string; today: string }): LeadAction {
  return {
    id: args.id, leadId: args.leadId, type: 'note', date: args.today,
    result: `Aucune prochaine action — ${args.reason}`, notes: '', authorId: args.authorId, kind: 'sans_suite',
  };
}

/** Une ligne d'historique met-elle à jour la dernière action et compte-t-elle dans les objectifs ? */
export const isRealizedAction = (a: Pick<LeadAction, 'kind'>) => (a.kind ?? 'realisee') === 'realisee';

// ---------------------------------------------------------------------------
// Programmer / réaliser / annuler (utilisés par le reducer)
// ---------------------------------------------------------------------------

export interface PlanInput {
  type: ActionType;
  customLabel: string;
  date: string;
  time?: string;
  endTime?: string;
  note: string;
  people: PlannedActionPerson[];
}

/**
 * Programme LA prochaine action du lead (règle : une seule à faire).
 *  - une action à faire existe : elle est MISE À JOUR (même id, originalDate
 *    conservée) ; si la DATE change, une trace « report » est produite ;
 *  - sinon : nouvelle action (id fourni), originalDate = sa date.
 */
export function planNextAction(
  planned: PlannedAction[],
  leadId: string,
  input: PlanInput,
  ids: { plannedId: string; reportEntryId: string },
  ctx: { authorId: string; today: string },
): { planned: PlannedAction[]; report?: LeadAction; plannedId: string } {
  const pending = pendingActionOf(leadId, planned);
  const fields = {
    type: input.type,
    customLabel: input.type === 'autre' ? input.customLabel.trim() : '',
    date: input.date,
    time: input.time || undefined,
    endTime: input.time && input.endTime ? input.endTime : undefined,
    note: input.note,
    people: normalizePeople(input.people),
  };
  if (pending) {
    const report = pending.date !== input.date
      ? buildReportEntry({ id: ids.reportEntryId, previous: pending, newDate: input.date, newTime: fields.time, authorId: ctx.authorId, today: ctx.today })
      : undefined;
    const updated: PlannedAction = { ...pending, ...fields, status: 'a_faire' };
    return { planned: planned.map(p => (p.id === pending.id ? updated : p)), report, plannedId: pending.id };
  }
  const created: PlannedAction = { id: ids.plannedId, leadId, ...fields, originalDate: input.date, status: 'a_faire' };
  return { planned: [...planned, created], plannedId: created.id };
}

/** Change seulement la date/l'heure (glisser-déposer, « Reporter ») : même règle de trace. */
export function reschedulePlannedAction(
  planned: PlannedAction[],
  plannedId: string,
  when: { date: string; time?: string; endTime?: string },
  ids: { reportEntryId: string },
  ctx: { authorId: string; today: string },
): { planned: PlannedAction[]; report?: LeadAction } {
  const pa = planned.find(p => p.id === plannedId);
  if (!pa || pa.status !== 'a_faire') return { planned };
  const report = pa.date !== when.date
    ? buildReportEntry({ id: ids.reportEntryId, previous: pa, newDate: when.date, newTime: when.time, authorId: ctx.authorId, today: ctx.today })
    : undefined;
  const moved: PlannedAction = { ...pa, date: when.date, time: when.time || undefined, endTime: when.time && when.endTime ? when.endTime : undefined };
  return { planned: planned.map(p => (p.id === plannedId ? moved : p)), report };
}

/** « Fait » : l'action passe à faite (grisée), liée à la ligne d'historique créée. « Pas fait » = ne rien appeler. */
export function completePlannedAction(planned: PlannedAction[], plannedId: string, done: { doneAt: string; doneActionId: string }): PlannedAction[] {
  return planned.map(p => (p.id === plannedId && p.status === 'a_faire' ? { ...p, status: 'faite', ...done } : p));
}

/** L'action à faire du lead n'est plus à faire (« Aucune prochaine action », effacement). Jamais supprimée. */
export function cancelPendingAction(planned: PlannedAction[], leadId: string): PlannedAction[] {
  return planned.map(p => (p.leadId === leadId && p.status === 'a_faire' ? { ...p, status: 'annulee' } : p));
}

// ---------------------------------------------------------------------------
// Reprise des prochaines actions déjà saisies (champs du lead, avant le lot 2)
// ---------------------------------------------------------------------------

/** Id DÉTERMINISTE de reprise : rejouer la reprise ne crée jamais de doublon. */
export const legacyPlannedId = (leadId: string) => `pa-reprise-${leadId}`;

/**
 * Actions programmées à créer depuis les champs nextAction* des leads (lots
 * précédents). Un lead est repris s'il a une date de prochaine action ET aucune
 * action programmée (quel que soit son état) — idempotent. Responsable = le
 * commercial du lead, tel quel (on reprend la donnée existante, sans filtrer
 * « Non attribué »). Les champs du lead ne sont PAS modifiés.
 */
export function migrateLegacyNextActions(leads: Lead[], planned: PlannedAction[]): PlannedAction[] {
  const hasAny = new Set(planned.map(p => p.leadId));
  return leads
    .filter(l => !!l.nextActionDate && !hasAny.has(l.id))
    .map(l => ({
      id: legacyPlannedId(l.id),
      leadId: l.id,
      type: (l.nextActionType || 'autre') as ActionType,
      customLabel: l.nextActionType ? '' : 'Prochaine action',
      date: l.nextActionDate,
      time: l.nextActionTime || undefined,
      endTime: l.nextActionTime && l.nextActionEndTime ? l.nextActionEndTime : undefined,
      originalDate: l.nextActionDate,
      note: '',
      status: 'a_faire' as const,
      people: [{ commercialId: l.commercialId, role: 'responsable' as const }],
    }));
}

// ---------------------------------------------------------------------------
// Quand la fenêtre « Prochaine action » s'ouvre, et ce qu'elle autorise
// ---------------------------------------------------------------------------

/**
 * obligatoire : planifier OU « Aucune » (motif) — impossible de fermer autrement ;
 * reprise     : planifier une date de reprise — « Aucune » INTERDITE (Reporté) ;
 * passable    : planifier, « Aucune » ou « Passer » (Signé / Perdu).
 */
export type NextActionWindowMode = 'obligatoire' | 'reprise' | 'passable';

function modeForStatus(status: LeadStatus | undefined): NextActionWindowMode {
  if (status === 'reporte') return 'reprise';
  if (status === 'signe' || status === 'perdu') return 'passable';
  return 'obligatoire';
}

/** Après la validation de N'IMPORTE QUELLE action : la fenêtre s'ouvre toujours. */
export function windowAfterAction(newStatus: LeadStatus | undefined, currentStatus: LeadStatus): NextActionWindowMode {
  return modeForStatus(newStatus ?? currentStatus);
}

/**
 * Après un CHANGEMENT DE STATUT seul (fiche, bouton suivant, pipeline) :
 *  - vers Reporté : fenêtre, date de reprise obligatoire ;
 *  - vers Signé / Perdu : fenêtre avec « Passer » ;
 *  - vers un autre statut actif : fenêtre obligatoire SEULEMENT si le lead n'a
 *    pas déjà une action à faire ; sinon aucune fenêtre (null).
 */
export function windowAfterStatusChange(target: LeadStatus, hasPendingAction: boolean): NextActionWindowMode | null {
  const mode = modeForStatus(target);
  if (mode !== 'obligatoire') return mode;
  return hasPendingAction ? null : 'obligatoire';
}

export type NextActionChoice =
  | ({ kind: 'planifier' } & PlanInput)
  | { kind: 'aucune'; reason: string; customReason: string }
  | { kind: 'passer' };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Motif final enregistré (texte libre pour « Autre »). */
export function resolveNoNextActionReason(reason: string, customReason: string): string {
  return reason === 'Autre' ? customReason.trim() : reason;
}

/**
 * Valide le choix de la fenêtre. Liste d'erreurs lisibles ; [] = valide.
 * `commercials` sert à vérifier que chaque personne est éligible.
 */
export function validateNextActionChoice(choice: NextActionChoice, mode: NextActionWindowMode, commercials: Commercial[]): string[] {
  const errors: string[] = [];
  if (choice.kind === 'passer') {
    if (mode !== 'passable') errors.push('« Passer » n\'est possible que pour un lead Signé ou Perdu.');
    return errors;
  }
  if (choice.kind === 'aucune') {
    if (mode === 'reprise') errors.push('Un lead Reporté doit avoir une date de reprise.');
    if (!(NO_NEXT_ACTION_REASONS as readonly string[]).includes(choice.reason)) errors.push('Choisissez un motif.');
    else if (choice.reason === 'Autre' && !choice.customReason.trim()) errors.push('Précisez le motif.');
    return errors;
  }
  if (!ACTION_TYPES.some(t => t.value === choice.type)) errors.push('Choisissez un type d\'action.');
  if (choice.type === 'autre' && !choice.customLabel.trim()) errors.push('Précisez le type d\'action.');
  if (!ISO_DAY.test(choice.date)) errors.push(mode === 'reprise' ? 'Choisissez la date de reprise.' : 'Choisissez une date.');
  if (choice.time && !HHMM.test(choice.time)) errors.push('Heure invalide.');
  if (choice.endTime) {
    if (!choice.time) errors.push('Une heure de fin demande une heure de début.');
    else if (!HHMM.test(choice.endTime) || choice.endTime <= choice.time) errors.push('L\'heure de fin doit suivre l\'heure de début.');
  }
  const people = normalizePeople(choice.people);
  if (!people.some(p => p.role === 'responsable')) errors.push('Choisissez au moins un responsable.');
  const eligible = new Set(eligibleCommercials(commercials).map(c => c.id));
  if (people.some(p => !eligible.has(p.commercialId))) errors.push('Seuls les commerciaux actifs de l\'Équipe peuvent être choisis (« Non attribué » exclu).');
  return errors;
}

/** Note d'appel : au moins 2 mots et 10 caractères (hors espaces de bord). */
export function isValidCallNote(note: string): boolean {
  const t = note.trim();
  return t.length >= 10 && t.split(/\s+/).filter(Boolean).length >= 2;
}

/**
 * Résultats d'un appel (puces). TOUS donnent une action RÉALISÉE : un appel sans
 * réponse est un appel passé — il compte dans les objectifs et met à jour la
 * dernière action. `noteRequired` : note récapitulative obligatoire (2 mots,
 * 10 caractères) seulement quand on a parlé au client.
 */
export const CALL_RESULTS = [
  { value: 'Joint', noteRequired: true },
  { value: 'Message laissé', noteRequired: false },
  { value: 'Pas de réponse', noteRequired: false },
  { value: 'Rappel demandé', noteRequired: true },
  { value: 'Mauvais numéro', noteRequired: false },
] as const;
export type CallResult = typeof CALL_RESULTS[number]['value'];

/** Validation de la fenêtre d'appel : puce obligatoire (aucune par défaut), note selon la puce. [] = valide. */
export function validateCallEntry(result: string | null, note: string): string[] {
  const def = CALL_RESULTS.find(r => r.value === result);
  if (!def) return ['Choisissez le résultat de l\'appel.'];
  if (def.noteRequired && !isValidCallNote(note)) return ['Note obligatoire : quelques mots au minimum (2 mots, 10 caractères).'];
  return [];
}

/** Libellé de l'historique : « Appel — Pas de réponse ». */
export const callResultLabel = (result: CallResult) => `Appel — ${result}`;

// ---------------------------------------------------------------------------
// Arrêt 2 — QUEL point d'entrée ouvre QUOI (source unique, prouvée au harnais)
// ---------------------------------------------------------------------------

/** Fenêtre à ouvrir : mode (ce qui est permis) + fermable ou non (croix / Échap / Annuler). */
export interface NextActionPrompt { mode: NextActionWindowMode; closable: boolean }

export type NextActionEntry =
  /** « + Action » de la fiche (newStatus éventuel choisi dans le formulaire). */
  | { kind: 'action_enregistree'; newStatus?: LeadStatus; currentStatus: LeadStatus }
  /** Appel : note validée puis enregistrée. */
  | { kind: 'appel_enregistre'; currentStatus: LeadStatus }
  /** Email / SMS / WhatsApp : « Avez-vous bien envoyé le message ? » -> Oui. */
  | { kind: 'message_confirme'; currentStatus: LeadStatus }
  /** … -> Non : rien n'est enregistré, rien ne s'ouvre. */
  | { kind: 'message_non_envoye' }
  /** Changement de statut seul : fiche, bouton suivant, confirmation Signé/Perdu, pipeline, formulaire du lead. */
  | { kind: 'statut_change'; target: LeadStatus; hadPendingAction: boolean }
  /** Création manuelle d'un lead (formulaire). */
  | { kind: 'lead_cree'; status: LeadStatus }
  /** Éditeur « Prochaine action » / « Relancer » de la fiche : planification volontaire. */
  | { kind: 'editeur_prochaine_action'; status: LeadStatus }
  /** Boîte de réception. */
  | { kind: 'boite_rattacher' }
  | { kind: 'boite_rouvrir'; hadPendingAction: boolean }
  | { kind: 'boite_accepter' }
  /** Lien « Planifier » du toast d'acceptation : planification volontaire. */
  | { kind: 'toast_planifier'; status: LeadStatus }
  /** Agenda : traité à l'arrêt 3. */
  | { kind: 'agenda_creer' }
  | { kind: 'agenda_reporter' };

export interface NextActionDecision {
  prompt: NextActionPrompt | null;
  /** Boîte de réception / acceptation : toast « Lead créé — Planifier » au lieu d'une fenêtre. */
  toastPlanifier?: boolean;
}

export function nextActionDecision(entry: NextActionEntry): NextActionDecision {
  switch (entry.kind) {
    case 'action_enregistree':
      return { prompt: { mode: windowAfterAction(entry.newStatus, entry.currentStatus), closable: false } };
    case 'appel_enregistre':
    case 'message_confirme':
      return { prompt: { mode: windowAfterAction(undefined, entry.currentStatus), closable: false } };
    case 'lead_cree':
      return { prompt: { mode: windowAfterAction(undefined, entry.status), closable: false } };
    case 'statut_change': {
      const mode = windowAfterStatusChange(entry.target, entry.hadPendingAction);
      return { prompt: mode ? { mode, closable: false } : null };
    }
    case 'boite_rouvrir': {
      // Rouvrir = passage en « À contacter » : même règle qu'un changement de statut.
      const mode = windowAfterStatusChange('a_contacter', entry.hadPendingAction);
      return { prompt: mode ? { mode, closable: false } : null };
    }
    case 'editeur_prochaine_action':
    case 'toast_planifier':
      // Planification VOLONTAIRE : fermable, mais les règles du statut s'appliquent
      // (Reporté : « Aucune » interdite ; Signé / Perdu : « Passer »).
      return { prompt: { mode: windowAfterAction(undefined, entry.status), closable: true } };
    case 'boite_accepter':
      return { prompt: null, toastPlanifier: true };
    case 'message_non_envoye':
    case 'boite_rattacher':
    case 'agenda_creer':
    case 'agenda_reporter':
      return { prompt: null };
  }
}
