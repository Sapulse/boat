import type { Commercial, WeeklyObjective } from '../data/types.js';
// Suffixe .js : ce module est aussi chargé par l'API (upsert, restauration) en ESM Node.
import { isUnassignedCommercial } from './plannedActions.js';

// ===========================================================================
// Objectifs de la semaine (lot 4) — module PUR, partagé app / API / harnais
// (scripts/harness-weekly-objectives.ts).
//
// Décisions du 17/09 :
//  - objectifs COMMUNS à l'équipe, 5 au plus par semaine (objectifs actifs) ;
//  - porteur FACULTATIF : un commercial de l'Équipe, jamais « Non attribué » ;
//  - JAMAIS de suppression : un objectif retiré passe active=false (réactivable) ;
//  - historique des semaines passées ; préparation de la semaine suivante ;
//  - « Reprendre la semaine suivante » : copie liée (copiedFromId), une seule fois ;
//  - une modification APRÈS la fin de sa semaine laisse une trace datée
//    (modifiedAfterWeekAt) — l'historique ne se réécrit pas en silence.
// Semaine = du lundi au dimanche, identifiée par la date de son lundi.
// ===========================================================================

export const MAX_ACTIVE_OBJECTIVES = 5;
export const OBJECTIVE_TEXT_MAX = 200;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function isISODate(s: string): boolean {
  return ISO.test(s) && !Number.isNaN(utc(s).getTime()) && iso(utc(s)) === s;
}

export function addDaysISO(day: string, n: number): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Lundi de la semaine qui contient ce jour. */
export function weekStartOf(day: string): string {
  const dow = utc(day).getUTCDay(); // 0 = dimanche
  return addDaysISO(day, dow === 0 ? -6 : 1 - dow);
}

export const isMonday = (day: string) => isISODate(day) && weekStartOf(day) === day;
export const addWeeksISO = (weekStart: string, n: number) => addDaysISO(weekStart, 7 * n);

/** La semaine est finie à partir du lundi suivant. */
export function isWeekEnded(weekStart: string, todayISO: string): boolean {
  return todayISO >= addWeeksISO(weekStart, 1);
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « du 14 au 20 septembre 2026 », « du 28 septembre au 4 octobre 2026 », « du 28 décembre 2026 au 3 janvier 2027 ». */
export function weekRangeLabel(weekStart: string): string {
  const end = addDaysISO(weekStart, 6);
  const [y1, m1, d1] = weekStart.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const endLabel = `${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (y1 !== y2) return `du ${d1} ${MONTHS[m1 - 1]} ${y1} au ${endLabel}`;
  if (m1 !== m2) return `du ${d1} ${MONTHS[m1 - 1]} au ${endLabel}`;
  return `du ${d1} au ${endLabel}`;
}

/** Date du jour à Paris (serveur en UTC) : la fin de semaine se juge à l'heure de l'équipe. */
export function parisTodayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const byPosition = (a: WeeklyObjective, b: WeeklyObjective) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Objectifs d'une semaine, dans l'ordre ; retirés exclus sauf demande. */
export function objectivesOfWeek(list: WeeklyObjective[], weekStart: string, opts: { includeInactive?: boolean } = {}): WeeklyObjective[] {
  return list.filter(o => o.weekStart === weekStart && (opts.includeInactive || o.active)).sort(byPosition);
}

export function activeCount(list: WeeklyObjective[], weekStart: string, exceptId?: string): number {
  return list.filter(o => o.weekStart === weekStart && o.active && o.id !== exceptId).length;
}

export const canAddToWeek = (list: WeeklyObjective[], weekStart: string) => activeCount(list, weekStart) < MAX_ACTIVE_OBJECTIVES;

/** Porteur valide : aucun, ou un commercial connu qui n'est pas « Non attribué ». */
export function isValidOwner(ownerId: string | null | undefined, commercials: Commercial[]): boolean {
  if (!ownerId) return true;
  const c = commercials.find(x => x.id === ownerId);
  return !!c && !isUnassignedCommercial(c);
}

/** Porteurs proposés : commerciaux actifs hors « Non attribué » (+ le porteur actuel s'il est désactivé). */
export function ownerChoices(commercials: Commercial[], currentOwnerId?: string | null): Commercial[] {
  return commercials.filter(c => !isUnassignedCommercial(c) && (c.active || c.id === currentOwnerId));
}

export type ObjectiveError = 'texte-vide' | 'texte-trop-long' | 'semaine-invalide' | 'porteur-invalide' | 'semaine-pleine';

export const OBJECTIVE_ERROR_LABEL: Record<ObjectiveError, string> = {
  'texte-vide': "Écrivez l'objectif.",
  'texte-trop-long': `${OBJECTIVE_TEXT_MAX} caractères au plus.`,
  'semaine-invalide': 'Semaine invalide.',
  'porteur-invalide': 'Porteur invalide (« Non attribué » exclu).',
  'semaine-pleine': `${MAX_ACTIVE_OBJECTIVES} objectifs au plus par semaine.`,
};

/** Règles d'un objectif dans sa liste (5 actifs max par semaine, en comptant les autres). */
export function validateObjective(o: Pick<WeeklyObjective, 'id' | 'text' | 'weekStart' | 'ownerId' | 'active'>, list: WeeklyObjective[], commercials: Commercial[]): ObjectiveError[] {
  const errors: ObjectiveError[] = [];
  const text = o.text.trim();
  if (!text) errors.push('texte-vide');
  if (text.length > OBJECTIVE_TEXT_MAX) errors.push('texte-trop-long');
  if (!isMonday(o.weekStart)) errors.push('semaine-invalide');
  if (!isValidOwner(o.ownerId, commercials)) errors.push('porteur-invalide');
  if (o.active && activeCount(list, o.weekStart, o.id) >= MAX_ACTIVE_OBJECTIVES) errors.push('semaine-pleine');
  return errors;
}

/** Champs qu'un utilisateur peut modifier. */
export interface ObjectivePatch { text?: string; ownerId?: string | null; done?: boolean; active?: boolean }

const nextPosition = (list: WeeklyObjective[], weekStart: string) =>
  list.filter(o => o.weekStart === weekStart).reduce((m, o) => Math.max(m, o.position), 0) + 1;

/** Nouvel objectif (placé en dernier). Trace si la semaine est déjà finie (ne devrait pas arriver par l'écran). */
export function newObjective(args: { id: string; weekStart: string; text: string; ownerId?: string | null; copiedFromId?: string | null; list: WeeklyObjective[]; todayISO: string; nowISO: string }): WeeklyObjective {
  return {
    id: args.id,
    weekStart: args.weekStart,
    position: nextPosition(args.list, args.weekStart),
    text: args.text.trim(),
    ownerId: args.ownerId || null,
    done: false,
    doneAt: null,
    active: true,
    copiedFromId: args.copiedFromId ?? null,
    modifiedAfterWeekAt: isWeekEnded(args.weekStart, args.todayISO) ? args.nowISO : null,
    createdAt: args.nowISO,
    updatedAt: args.nowISO,
  };
}

/**
 * Modification (texte, porteur, fait, retiré). Renvoie la MÊME référence si rien
 * ne change. doneAt suit done. Semaine finie -> modifiedAfterWeekAt = maintenant.
 */
export function applyObjectivePatch(o: WeeklyObjective, patch: ObjectivePatch, todayISO: string, nowISO: string): WeeklyObjective {
  const next: WeeklyObjective = { ...o };
  if (patch.text !== undefined) next.text = patch.text.trim();
  if (patch.ownerId !== undefined) next.ownerId = patch.ownerId || null;
  if (patch.active !== undefined) next.active = patch.active;
  if (patch.done !== undefined && patch.done !== o.done) {
    next.done = patch.done;
    next.doneAt = patch.done ? nowISO : null;
  }
  if (!objectiveContentChanged(o, next)) return o;
  next.updatedAt = nowISO;
  if (isWeekEnded(o.weekStart, todayISO)) next.modifiedAfterWeekAt = nowISO;
  return next;
}

/** Contenu visible modifié ? (position, dates techniques exclues) */
export function objectiveContentChanged(a: Pick<WeeklyObjective, 'text' | 'ownerId' | 'done' | 'active'>, b: Pick<WeeklyObjective, 'text' | 'ownerId' | 'done' | 'active'>): boolean {
  return a.text !== b.text || (a.ownerId || null) !== (b.ownerId || null) || a.done !== b.done || a.active !== b.active;
}

/** Semaine cible de « Reprendre » : la suivante de l'objectif, jamais avant la semaine en cours. */
export function carryOverTarget(o: Pick<WeeklyObjective, 'weekStart'>, todayISO: string): string {
  const next = addWeeksISO(o.weekStart, 1);
  const current = weekStartOf(todayISO);
  return next > current ? next : current;
}

export type CarryOverRefusal = 'deja-fait' | 'retire' | 'deja-repris' | 'semaine-pleine';
export const CARRY_OVER_REFUSAL_LABEL: Record<CarryOverRefusal, string> = {
  'deja-fait': 'Objectif déjà atteint.',
  retire: 'Objectif retiré.',
  'deja-repris': 'Déjà repris la semaine suivante.',
  'semaine-pleine': `La semaine suivante a déjà ${MAX_ACTIVE_OBJECTIVES} objectifs.`,
};

/** Copie déjà faite (active ou retirée) de cet objectif dans la semaine cible. */
export function existingCopy(list: WeeklyObjective[], sourceId: string, weekStart: string): WeeklyObjective | undefined {
  return list.find(o => o.copiedFromId === sourceId && o.weekStart === weekStart);
}

export function carryOverRefusal(list: WeeklyObjective[], o: WeeklyObjective, todayISO: string): CarryOverRefusal | null {
  if (o.done) return 'deja-fait';
  if (!o.active) return 'retire';
  const target = carryOverTarget(o, todayISO);
  if (existingCopy(list, o.id, target)) return 'deja-repris';
  if (activeCount(list, target) >= MAX_ACTIVE_OBJECTIVES) return 'semaine-pleine';
  return null;
}

/** « Reprendre la semaine suivante » : nouvel objectif lié, même texte et porteur. L'original n'est pas modifié. */
export function carryOverObjective(list: WeeklyObjective[], sourceId: string, newId: string, todayISO: string, nowISO: string): { objective: WeeklyObjective } | { refusal: CarryOverRefusal } | null {
  const source = list.find(o => o.id === sourceId);
  if (!source) return null;
  const refusal = carryOverRefusal(list, source, todayISO);
  if (refusal) return { refusal };
  return {
    objective: newObjective({
      id: newId, weekStart: carryOverTarget(source, todayISO), text: source.text, ownerId: source.ownerId,
      copiedFromId: source.id, list, todayISO, nowISO,
    }),
  };
}

/** Semaines passées ayant au moins un objectif (actif ou retiré), plus récente d'abord. */
export function historyWeeks(list: WeeklyObjective[], todayISO: string): string[] {
  const current = weekStartOf(todayISO);
  return [...new Set(list.map(o => o.weekStart).filter(w => w < current))].sort().reverse();
}

/** Bilan d'une semaine : atteints / actifs. */
export function weekScore(list: WeeklyObjective[], weekStart: string): { done: number; total: number } {
  const active = objectivesOfWeek(list, weekStart);
  return { done: active.filter(o => o.done).length, total: active.length };
}

/**
 * Upsert SERVEUR : l'état envoyé par le client est accepté, mais la trace
 * « modifié après la fin de semaine » et les dates sont décidées ICI (horloge du
 * serveur, heure de Paris) — un client ne peut ni l'effacer ni l'antidater.
 */
export function serverMergeObjective(existing: WeeklyObjective | undefined, incoming: WeeklyObjective, todayISO: string, nowISO: string): WeeklyObjective {
  const ended = isWeekEnded(incoming.weekStart, todayISO);
  if (!existing) {
    return {
      ...incoming,
      doneAt: incoming.done ? (incoming.doneAt || nowISO) : null,
      modifiedAfterWeekAt: ended ? nowISO : null,
    };
  }
  const changed = objectiveContentChanged(existing, incoming);
  const doneAt = incoming.done === existing.done ? existing.doneAt : (incoming.done ? (incoming.doneAt || nowISO) : null);
  return {
    ...incoming,
    weekStart: existing.weekStart,               // la semaine d'un objectif ne change pas
    copiedFromId: existing.copiedFromId,         // le lien de reprise non plus
    createdAt: existing.createdAt,
    doneAt,
    modifiedAfterWeekAt: changed && ended ? nowISO : existing.modifiedAfterWeekAt,
  };
}
