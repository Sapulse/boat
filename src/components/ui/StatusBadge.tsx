import type { LeadStatus, Temperature } from '../../data/types';
import { getStatusColor, getStatusLabel, getTemperatureInfo } from '../../data/constants';
import { cn } from '../../lib/utils';
import { Flame, Snowflake, Sun } from 'lucide-react';

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={cn('badge', getStatusColor(status))}>
      {getStatusLabel(status)}
    </span>
  );
}

export function TemperatureBadge({ temperature }: { temperature: Temperature }) {
  const info = getTemperatureInfo(temperature);
  const Icon = temperature === 'chaud' ? Flame : temperature === 'tiede' ? Sun : Snowflake;
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
