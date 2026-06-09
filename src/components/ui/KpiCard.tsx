import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  color?: string;
  trend?: string;
}

export default function KpiCard({ title, value, subtitle, icon, color = 'text-primary-600', trend }: KpiCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className={cn('text-2xl font-bold mt-1', color)}>{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
          {trend && <p className="text-xs text-success-600 mt-1 font-medium">{trend}</p>}
        </div>
        {icon && (
          <div className={cn('p-2.5 rounded-lg bg-gray-50', color)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
