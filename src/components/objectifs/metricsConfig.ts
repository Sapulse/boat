import { formatCurrency } from '../../lib/utils';

export type Unit = '' | '€' | '%';

// Affichage d'une valeur d'indicateur selon son unité (nombre / € / %).
export function formatValue(value: number | null, unit: Unit): string {
  if (value === null || value === undefined) return '—';
  if (unit === '€') return formatCurrency(value);
  if (unit === '%') return `${value} %`;
  return String(value);
}

// Config UI des 6 indicateurs d'objectifs (3 familles), PARTAGÉE entre la page
// Objectifs (saisie + suivi) et l'Espace commercial (lecture seule). `manual` =
// réalisé purement saisi (cold-calls : aucune source auto).
export type MetricKey = 'prospectsCreated' | 'coldCalls' | 'followups' | 'meetings' | 'revenue' | 'conversionRate';
export type Family = 'prospection' | 'suivi' | 'resultat';

export const METRICS: { key: MetricKey; label: string; unit: Unit; hint: string; family: Family; manual?: boolean }[] = [
  { key: 'prospectsCreated', family: 'prospection', label: 'Leads rentrés', unit: '', hint: 'leads de prospection créés ce mois' },
  { key: 'coldCalls', family: 'prospection', manual: true, label: 'Appels à froid', unit: '', hint: 'réalisé saisi à la main' },
  { key: 'followups', family: 'suivi', label: 'Relances', unit: '', hint: 'appel + relance + email + sms + whatsapp' },
  { key: 'meetings', family: 'suivi', label: 'RDV / visites', unit: '', hint: 'rdv + visite' },
  { key: 'revenue', family: 'resultat', label: 'CA signé', unit: '€', hint: 'leads signés ce mois' },
  { key: 'conversionRate', family: 'resultat', label: 'Taux de transformation', unit: '%', hint: 'signés / (signés + perdus)' },
];

export const FAMILIES: { id: Family; label: string }[] = [
  { id: 'prospection', label: 'Prospection' },
  { id: 'suivi', label: 'Suivi' },
  { id: 'resultat', label: 'Résultat' },
];
