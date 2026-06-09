import { clsx, type ClassValue } from 'clsx';
import { differenceInDays, format, parseISO, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Lead, AlertLevel, LeadStatus } from '../data/types';
import { ACTIVE_STATUSES } from '../data/constants';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function generateId(): string {
  return crypto.randomUUID();
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

export function getAlertLevel(lead: Lead): AlertLevel {
  if (!ACTIVE_STATUSES.includes(lead.status)) return 'none';

  const lastAction = lead.lastActionDate || lead.createdAt;
  const days = daysSince(lastAction);

  if (lead.temperature === 'chaud' && !lead.nextActionDate) return 'red';
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

export type RiskItem = { label: string; severity: 'warning' | 'danger' };

export function getLeadRisks(lead: Lead): RiskItem[] {
  const risks: RiskItem[] = [];
  if (!isLeadActive(lead.status)) return risks;

  const days = daysSince(lead.lastActionDate || lead.createdAt);

  if (!lead.nextActionDate && !lead.nextActionType) {
    risks.push({ label: 'Aucune prochaine action planifiee', severity: lead.temperature === 'chaud' ? 'danger' : 'warning' });
  }
  if (lead.temperature === 'chaud' && days > 3) {
    risks.push({ label: 'Lead chaud inactif depuis ' + days + 'j', severity: 'danger' });
  }
  if (lead.status === 'devis_envoye' && days > 5) {
    risks.push({ label: 'Devis envoye sans relance depuis ' + days + 'j', severity: days > 10 ? 'danger' : 'warning' });
  }
  if (days >= 14) {
    risks.push({ label: 'Aucune action depuis ' + days + ' jours', severity: 'danger' });
  } else if (days >= 7) {
    risks.push({ label: 'Derniere action il y a ' + days + ' jours', severity: 'warning' });
  }
  if (lead.priority === 'critique' && days > 2) {
    risks.push({ label: 'Lead critique sans action recente', severity: 'danger' });
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
