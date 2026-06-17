import {
  COMMERCIAL_COLORS, NEUTRAL_COMMERCIAL_COLOR,
  AGENDA_HOUR_START, AGENDA_HOUR_END, AGENDA_SLOT_MIN,
} from '../data/constants';
import { isLeadActive } from './utils';
import type { Lead, Commercial, ActionType } from '../data/types';

// Module PUR (sans React ni JSX) : helpers de l'agenda, testables au harnais.

export type CommercialColor =
  | (typeof COMMERCIAL_COLORS)[number]
  | typeof NEUTRAL_COMMERCIAL_COLOR;

/**
 * Couleur d'un commercial, DETERMINISTE par sa POSITION dans la liste : stable
 * au rechargement, rien a persister sur le type Commercial. Au-dela de la
 * palette on cycle (modulo). commercialId introuvable -> repli neutre (gris),
 * jamais d'erreur.
 */
export function getCommercialColor(commercialId: string, commercials: Commercial[]): CommercialColor {
  const idx = commercials.findIndex(c => c.id === commercialId);
  if (idx === -1) return NEUTRAL_COMMERCIAL_COLOR;
  return COMMERCIAL_COLORS[idx % COMMERCIAL_COLORS.length];
}

export type EventStatus = 'overdue' | 'today' | 'future';

/**
 * Statut temporel d'une action planifiee, par comparaison de chaines ISO
 * (YYYY-MM-DD, comparables lexicographiquement). Coherent avec la regle metier
 * existante (risque "Action planifiee depassee" : date < aujourd'hui = echue).
 */
export function eventStatus(dateISO: string, todayISO: string): EventStatus {
  if (dateISO < todayISO) return 'overdue';
  if (dateISO === todayISO) return 'today';
  return 'future';
}

export interface AgendaEvent {
  leadId: string;
  leadName: string;
  commercialId: string;
  type: ActionType | '';
  date: string; // ISO YYYY-MM-DD (= lead.nextActionDate)
  time?: string; // "HH:mm" optionnel (= lead.nextActionTime) ; absent = all-day
  endTime?: string; // "HH:mm" fin optionnelle (= lead.nextActionEndTime) -> duree
  status: EventStatus;
}

/**
 * Construit les evenements de l'agenda = les PROCHAINES actions planifiees
 * (lead.nextActionDate posee), PAS l'historique realise (state.actions). Un
 * lead a un creneau de prochaine action UNIQUE -> au plus 1 evenement par lead.
 * On se limite aux leads ACTIFS (coherence app-wide : alertes/risques sont
 * suspendus pour les statuts terminaux signe/perdu/reporte).
 */
export function buildAgendaEvents(leads: Lead[], todayISO: string): AgendaEvent[] {
  return leads
    .filter(l => !!l.nextActionDate && isLeadActive(l.status))
    .map(l => ({
      leadId: l.id,
      leadName: `${l.firstName} ${l.lastName}`.trim() || 'Sans nom',
      commercialId: l.commercialId,
      type: l.nextActionType,
      date: l.nextActionDate,
      time: l.nextActionTime || undefined,
      endTime: l.nextActionEndTime || undefined,
      status: eventStatus(l.nextActionDate, todayISO),
    }));
}

/**
 * Predicat PUR : l'heure de fin est-elle valide (posterieure STRICTEMENT au
 * debut) ? Les deux doivent etre des "HH:mm" valides. Sert a la saisie
 * (editeur/createur) ET au rendu defensif du bloc (fin invalide -> ponctuel).
 */
export function isEndAfterStart(start: string, end: string): boolean {
  const s = parseHHmm(start);
  const e = parseHHmm(end);
  return s !== null && e !== null && e > s;
}

/**
 * Ordre d'affichage des evenements d'un MEME jour : les sans-heure d'abord
 * ("a faire dans la journee", convention Google/Outlook), puis les creneaux par
 * heure croissante. Comparaison de chaines "HH:mm" (lexicographique = horaire).
 */
function compareDayEvents(a: AgendaEvent, b: AgendaEvent): number {
  if (!a.time && !b.time) return 0;
  if (!a.time) return -1;
  if (!b.time) return 1;
  return a.time.localeCompare(b.time);
}

/**
 * Leads eligibles a la CREATION d'une action depuis l'agenda : actifs ET SANS
 * action deja planifiee. Le creneau nextAction etant UNIQUE par lead, exclure
 * les leads deja planifies rend l'ecrasement impossible PAR CONSTRUCTION (pas de
 * confirmation a coder) ; deplacer une action existante = replanification.
 */
export function getCreatableLeads(leads: Lead[]): Lead[] {
  return leads.filter(l => !l.nextActionDate && isLeadActive(l.status));
}

/**
 * Indexe les evenements par jour ISO -> lookup O(1) depuis les cellules d'une
 * grille (semaine / mois / journee). N'altere pas l'ordre d'insertion.
 */
export function groupEventsByDay(events: AgendaEvent[]): Map<string, AgendaEvent[]> {
  const map = new Map<string, AgendaEvent[]>();
  for (const e of events) {
    const arr = map.get(e.date);
    if (arr) arr.push(e);
    else map.set(e.date, [e]);
  }
  // Tri intra-jour : sans-heure d'abord, puis par heure croissante (toutes les
  // vues consomment cette Map, donc l'ordre est garanti partout).
  for (const arr of map.values()) arr.sort(compareDayEvents);
  return map;
}

// ---------------------------------------------------------------------------
// Grille horaire (lot agenda-grille-horaire) — helpers PURS
// ---------------------------------------------------------------------------

/** "HH:mm" -> minutes depuis minuit ; null si format invalide. */
export function parseHHmm(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHHmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Liste ordonnee des creneaux affiches : ["08:00", "08:30", ...] sur
 * [AGENDA_HOUR_START:00, AGENDA_HOUR_END:00), pas de AGENDA_SLOT_MIN minutes.
 */
export function buildTimeSlots(): string[] {
  const slots: string[] = [];
  for (let m = AGENDA_HOUR_START * 60; m < AGENDA_HOUR_END * 60; m += AGENDA_SLOT_MIN) {
    slots.push(minutesToHHmm(m));
  }
  return slots;
}

/**
 * Classe un evenement par rapport a la grille :
 *  - 'none' : pas d'heure (action "toute la journee") ou heure invalide ;
 *  - 'out'  : heure hors plage affichee (avant START ou >= END) ;
 *  - { slot } : creneau d'accueil (arrondi PLANCHER au pas de SLOT, ex. 14:15 -> 14:00).
 * Garantit qu'AUCUN evenement n'est perdu (tout retombe dans none/out/slot).
 */
export function eventSlot(event: AgendaEvent): 'none' | 'out' | { slot: string } {
  if (!event.time) return 'none';
  const mins = parseHHmm(event.time);
  if (mins === null) return 'none';
  const startMin = AGENDA_HOUR_START * 60;
  const endMin = AGENDA_HOUR_END * 60;
  if (mins < startMin || mins >= endMin) return 'out';
  const floored = startMin + Math.floor((mins - startMin) / AGENDA_SLOT_MIN) * AGENDA_SLOT_MIN;
  return { slot: minutesToHHmm(floored) };
}

export interface DayLayout {
  allDay: AgendaEvent[];                  // sans heure ("toute la journee")
  outOfRange: AgendaEvent[];              // heure hors plage affichee
  bySlot: Map<string, AgendaEvent[]>;     // "HH:mm" creneau -> evenements
}

/**
 * Repartit les evenements d'UN jour pour la grille horaire : sans-heure,
 * hors-plage, et par creneau. Preserve l'ordre d'entree (deja trie par
 * groupEventsByDay). Aucun evenement n'est perdu.
 */
// Evenement positionne dans la grille horaire (vues Semaine/Journee en blocs).
export interface PositionedEvent {
  event: AgendaEvent;
  startIndex: number; // index du creneau de debut (0-based)
  span: number;       // nombre de creneaux couverts (>= 1)
  lane: number;       // couloir attribue (0-based) en cas de chevauchement
  lanes: number;      // nb total de couloirs du cluster (largeur = 1 / lanes)
}

export interface DayGridLayout {
  allDay: AgendaEvent[];          // sans heure
  outOfRange: AgendaEvent[];      // debut hors plage affichee
  positioned: PositionedEvent[];  // evenements horodates, places + couloirs
  slotCount: number;              // nb de creneaux de la grille (hauteur)
}

/**
 * Place les evenements d'UN jour dans la grille horaire en BLOCS :
 *  - `startIndex` = creneau de debut (arrondi plancher) ;
 *  - `span` = nb de creneaux couverts : de debut a fin si fin valide (clamp a la
 *    fin de plage 18h), sinon 1 (action ponctuelle / fin incoherente) ;
 *  - `lane`/`lanes` = couloirs cote a cote pour les chevauchements (assignation
 *    gloutonne par cluster). Aucun evenement perdu (all-day / hors-plage / place).
 * Helper PUR (constantes de plage), testable au harnais.
 */
export function layoutDayGrid(events: AgendaEvent[]): DayGridLayout {
  const startMin = AGENDA_HOUR_START * 60;
  const endMin = AGENDA_HOUR_END * 60;
  const slotMin = AGENDA_SLOT_MIN;
  const slotCount = Math.max(0, Math.floor((endMin - startMin) / slotMin));

  const allDay: AgendaEvent[] = [];
  const outOfRange: AgendaEvent[] = [];
  const timed: { event: AgendaEvent; startIndex: number; span: number }[] = [];

  for (const e of events) {
    if (!e.time) { allDay.push(e); continue; }
    const mins = parseHHmm(e.time);
    if (mins === null) { allDay.push(e); continue; }
    if (mins < startMin || mins >= endMin) { outOfRange.push(e); continue; }
    const startIndex = Math.floor((mins - startMin) / slotMin);
    let span = 1;
    if (e.endTime && isEndAfterStart(e.time, e.endTime)) {
      const endParsed = parseHHmm(e.endTime);
      if (endParsed !== null) {
        const endM = Math.min(endParsed, endMin); // clamp a la fin de plage
        span = Math.ceil((endM - startMin) / slotMin) - startIndex;
      }
    }
    span = Math.max(1, Math.min(span, slotCount - startIndex)); // jamais hors grille
    timed.push({ event: e, startIndex, span });
  }

  // Couloirs (lanes) par cluster de chevauchement : tri par debut, puis
  // assignation gloutonne du 1er couloir libre ; tous les events d'un cluster
  // partagent le meme nb de couloirs (largeurs egales).
  timed.sort((a, b) => a.startIndex - b.startIndex || b.span - a.span);
  const positioned: PositionedEvent[] = [];
  let i = 0;
  while (i < timed.length) {
    let clusterEnd = timed[i].startIndex + timed[i].span;
    let j = i + 1;
    while (j < timed.length && timed[j].startIndex < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, timed[j].startIndex + timed[j].span);
      j++;
    }
    const cluster = timed.slice(i, j);
    const laneEnds: number[] = [];
    const laneIdx = cluster.map(it => {
      let lane = laneEnds.findIndex(end => end <= it.startIndex);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.startIndex + it.span;
      return lane;
    });
    const lanes = laneEnds.length;
    cluster.forEach((it, k) => positioned.push({ event: it.event, startIndex: it.startIndex, span: it.span, lane: laneIdx[k], lanes }));
    i = j;
  }

  return { allDay, outOfRange, positioned, slotCount };
}

export function layoutDayEvents(events: AgendaEvent[]): DayLayout {
  const allDay: AgendaEvent[] = [];
  const outOfRange: AgendaEvent[] = [];
  const bySlot = new Map<string, AgendaEvent[]>();
  for (const e of events) {
    const s = eventSlot(e);
    if (s === 'none') { allDay.push(e); continue; }
    if (s === 'out') { outOfRange.push(e); continue; }
    const arr = bySlot.get(s.slot);
    if (arr) arr.push(e);
    else bySlot.set(s.slot, [e]);
  }
  return { allDay, outOfRange, bySlot };
}
