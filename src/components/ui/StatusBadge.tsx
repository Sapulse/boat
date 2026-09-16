import type { LeadStatus, Temperature } from '../../data/types';
import { getStatusColor, getStatusLabel, getTemperatureInfo } from '../../data/constants';
import { cn } from '../../lib/utils';
import { CircleDashed, Flame, Snowflake, Sun } from 'lucide-react';

// Icône par température. Neutre : cercle en pointillés, « à qualifier ».
const TEMPERATURE_ICONS: Record<Temperature, typeof Flame> = {
  neutre: CircleDashed,
  froid: Snowflake,
  tiede: Sun,
  chaud: Flame,
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={cn('badge', getStatusColor(status))}>
      {getStatusLabel(status)}
    </span>
  );
}

export function TemperatureBadge({ temperature }: { temperature: Temperature }) {
  const info = getTemperatureInfo(temperature);
  // Icône dérivée de la valeur RÉSOLUE : une valeur inconnue s'affiche Neutre
  // de bout en bout (libellé ET icône), jamais un mélange.
  const Icon = TEMPERATURE_ICONS[info.value];
  return (
    <span className={cn('badge gap-1', info.color)}>
      <Icon className="w-3 h-3" />
      {info.label}
    </span>
  );
}

export function AlertDot({ level }: { level: 'none' | 'orange' | 'red' }) {
  if (level === 'none') return null;
  return (
    <span
      className={cn(
        'inline-block w-2.5 h-2.5 rounded-full shrink-0',
        level === 'red' ? 'bg-danger-500 animate-pulse' : 'bg-warning-500'
      )}
      title={level === 'red' ? 'Alerte urgente' : 'Attention requise'}
    />
  );
}
