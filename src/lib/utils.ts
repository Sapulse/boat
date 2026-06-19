import { clsx, type ClassValue } from 'clsx';
import { differenceInDays, format, parseISO, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Lead, AlertLevel, LeadStatus } from '../data/types';
import { ACTIVE_STATUSES, YEAR_RANGE_BACK, YEAR_RANGE_FORWARD } from '../data/constants';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Plage d'annees DYNAMIQUE autour de l'annee courante, pour les selecteurs
 * d'annee (stats acquisition). Bornes incluses : [current - back .. current + forward].
 *
 * Horizon glissant : recalcule a partir de l'annee courante -> aucune annee codee
 * en dur, jamais de plafond a reconduire. Volontairement large vers le futur pour
 * ne JAMAIS bloquer une saisie a venir. `current` est injectable (tests purs).
 */
export function buildYearRange(
  back: number = YEAR_RANGE_BACK,
  forward: number = YEAR_RANGE_FORWARD,
  current: number = new Date().getFullYear(),
): number[] {
  const start = current - back;
  const end = current + forward;
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function formatDate(date: string): string {
  if (!date) return '-';
  const d = parseISO(date);
  if (!isValid(d)) return '-';
  return format(d, 'dd/MM/yyyy', { locale: fr });
}

export function formatDateShort(date: string): string {
  if (!date) return '-';
  const d = parseISO(date);
  if (!isValid(d)) return '-';
  return format(d, 'dd MMM', { locale: fr });
}

export function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return '-';
  return new Intl.NumberFormat('fr-FR').format(n);
}

export function daysSince(date: string): number {
  if (!date) return Infinity;
  const d = parseISO(date);
  if (!isValid(d)) return Infinity;
  return differenceInDays(new Date(), d);
}

/**
 * Source de verite UNIQUE : une prochaine action n'est reellement "planifiee"
 * que si elle a une DATE (un type sans date n'est pas actionnable).
 * getAlertLevel, getLeadRisks et tous les predicats UI (Dashboard, vue Leads,
 * fiche lead) passent par ce helper — ne jamais re-tester nextActionDate /
 * nextActionType en dur ailleurs.
 */
export function hasPlannedNextAction(lead: Pick<Lead, 'nextActionDate'>): boolean {
  return !!lead.nextActionDate;
}

/**
 * Source de verite UNIQUE de la regle metier (v3.4) : une prochaine action
 * planifiee dans le FUTUR (date strictement posterieure a aujourd'hui) SUSPEND
 * les alertes et risques d'INACTIVITE — le rappel est pose, il n'y a rien a
 * relancer d'ici la. EXCEPTION geree par les appelants : un lead CHAUD reste
 * signalable meme avec une action future (un chaud silencieux est preoccupant).
 * Une date d'AUJOURD'HUI ou PASSEE ne suspend rien (echue = risque dedie).
 */
export function hasFutureNextAction(lead: Pick<Lead, 'nextActionDate'>): boolean {
  return !!lead.nextActionDate && lead.nextActionDate > toISODate(new Date());
}

export function getAlertLevel(lead: Lead): AlertLevel {
  if (!ACTIVE_STATUSES.includes(lead.status)) return 'none';

  const lastAction = lead.lastActionDate || lead.createdAt;
  const days = daysSince(lastAction);

  if (lead.temperature === 'chaud' && !hasPlannedNextAction(lead)) return 'red';
  // Action future planifiee -> pas d'alerte d'inactivite (seuils 7/14j),
  // SAUF lead chaud : les seuils restent actifs (exception metier).
  if (hasFutureNextAction(lead) && lead.temperature !== 'chaud') return 'none';
  if (days >= 14) return 'red';
  if (days >= 7) return 'orange';
  return 'none';
}

export function isLeadActive(status: LeadStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function getLeadFullName(lead: Lead): string {
  return `${lead.firstName} ${lead.lastName}`.trim() || 'Sans nom';
}

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Date ISO (yyyy-mm-dd, UTC) d'il y a `days` jours. STRICTEMENT le meme calcul
 * que l'ancien inline `new Date(Date.now() - days * 86400000).toISOString()
 * .slice(0, 10)` des filtres periode — simplement sorti du render (regle
 * react-hooks/purity), au meme titre que daysSince.
 */
export function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Predicat partage entre le KPI Dashboard "Sans action >7j" et la vue
 * "Inactifs" de la page Leads (correspondance compteur <-> liste garantie).
 * Simple predicat d'AFFICHAGE : volontairement distinct de getLeadRisks /
 * getAlertLevel (qui restent les sources de verite des risques et alertes).
 */
export function isInactiveOverWeek(lead: Lead): boolean {
  // Une action future planifiee suspend l'inactivite (regle v3.4) — coherent
  // avec getAlertLevel/getLeadRisks. Pas d'exception chaud ici : ce predicat
  // compte les leads SANS suivi prevu ; le chaud silencieux est porte par
  // l'alerte et le risque "chaud inactif".
  return isLeadActive(lead.status)
    && !hasFutureNextAction(lead)
    && daysSince(lead.lastActionDate || lead.createdAt) > 7;
}

export type RiskItem = { label: string; severity: 'warning' | 'danger' };

export function getLeadRisks(lead: Lead): RiskItem[] {
  const risks: RiskItem[] = [];
  if (!isLeadActive(lead.status)) return risks;

  const days = daysSince(lead.lastActionDate || lead.createdAt);

  // Prochaine action : deux cas MUTUELLEMENT EXCLUSIFS (if/else sur la date).
  // - manquante (pas de date) : meme predicat que getAlertLevel via le helper,
  //   libelle differencie si un type a ete saisi sans date ;
  // - echue (date passee) : planifiee mais depassee — warning jusqu'a 3 jours
  //   de retard, danger au-dela (meme seuil que "chaud inactif > 3j").
  if (!hasPlannedNextAction(lead)) {
    risks.push({
      label: lead.nextActionType ? 'Prochaine action sans date' : 'Aucune prochaine action planifiée',
      severity: lead.temperature === 'chaud' ? 'danger' : 'warning',
    });
  } else {
    const overdueDays = daysSince(lead.nextActionDate);
    if (overdueDays > 0) {
      risks.push({
        label: 'Action planifiée dépassée de ' + overdueDays + 'j',
        severity: overdueDays > 3 ? 'danger' : 'warning',
      });
    }
  }
  // Regle v3.4 : une action future planifiee SUSPEND les risques d'inactivite
  // ci-dessous (le rappel est pose) — SAUF "lead chaud inactif", qui reste
  // actif quoi qu'il arrive (un chaud silencieux est preoccupant meme avec un
  // rdv lointain). Le risque "echue" plus haut n'est pas concerne (date passee).
  const inactivitySuspended = hasFutureNextAction(lead);

  if (lead.temperature === 'chaud' && days > 3) {
    risks.push({ label: 'Lead chaud inactif depuis ' + days + 'j', severity: 'danger' });
  }
  if (!inactivitySuspended && lead.status === 'devis_envoye' && days > 5) {
    risks.push({ label: 'Devis envoyé sans relance depuis ' + days + 'j', severity: days > 10 ? 'danger' : 'warning' });
  }
  if (!inactivitySuspended && days >= 14) {
    risks.push({ label: 'Aucune action depuis ' + days + ' jours', severity: 'danger' });
  } else if (!inactivitySuspended && days >= 7) {
    risks.push({ label: 'Dernière action il y a ' + days + ' jours', severity: 'warning' });
  }
  if (!inactivitySuspended && lead.priority === 'critique' && days > 2) {
    risks.push({ label: 'Lead critique sans action récente', severity: 'danger' });
  }
  return risks;
}

export function safeParseJSON<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Statuts dont l'atteinte implique qu'un contact a eu lieu -> posent contactDate.
 * Volontairement SANS perdu / reporte : un lead peut etre perdu ou reporte sans
 * contact (mauvais numero, doublon), on ne presume donc pas de contact.
 */
const CONTACT_IMPLIED_STATUSES: LeadStatus[] = [
  'contacte', 'qualifie', 'devis_envoye', 'negociation', 'en_conclusion', 'signe',
];

/**
 * Source de verite unique des dates de jalon pilotees par le statut.
 *
 * - signedAt / lostAt / reportedAt : jalons "terminaux". Poses a l'entree du
 *   statut concerne si pas deja definis (preserve l'historique), et NETTOYES des
 *   qu'on quitte ce statut.
 * - contactDate : jalon "amont". Pose (si vide) des qu'on atteint un statut
 *   impliquant un contact (cf. CONTACT_IMPLIED_STATUSES), et JAMAIS nettoye :
 *   un contact passe reste un fait acquis meme si le lead recule ou devient
 *   perdu/reporte. Une date deja saisie est toujours preservee.
 *
 * A appeler dans le reducer pour chaque changement de statut.
 */
export function statusMilestoneDates(
  prev: Pick<Lead, 'contactDate' | 'signedAt' | 'lostAt' | 'reportedAt'>,
  newStatus: LeadStatus,
  date: string,
): Pick<Lead, 'contactDate' | 'signedAt' | 'lostAt' | 'reportedAt'> {
  return {
    contactDate:
      CONTACT_IMPLIED_STATUSES.includes(newStatus) && !prev.contactDate
        ? date
        : prev.contactDate,
    signedAt: newStatus === 'signe' ? (prev.signedAt || date) : '',
    lostAt: newStatus === 'perdu' ? (prev.lostAt || date) : '',
    reportedAt: newStatus === 'reporte' ? (prev.reportedAt || date) : '',
  };
}
