import { progressPct, progressLevel, type ProgressLevel } from '../../lib/goals';
import { formatValue, type Unit } from './metricsConfig';

// Code couleur de la progression (vert >= 100 / orange >= 70 / rouge < 70).
const LEVEL_BAR: Record<ProgressLevel, string> = {
  vert: 'bg-success-500',
  orange: 'bg-warning-500',
  rouge: 'bg-danger-500',
};
const LEVEL_TEXT: Record<ProgressLevel, string> = {
  vert: 'text-success-700',
  orange: 'text-warning-600',
  rouge: 'text-danger-700',
};

/**
 * Carte d'un indicateur d'objectif : réalisé en héros, cible, barre, %. Rendu PUR
 * (pct/niveau via progressPct/progressLevel de lib/goals). Partagée entre la page
 * Objectifs (saisie/suivi) et l'Espace commercial (lecture seule).
 *  - `manual`  : le réalisé est SAISI dans la carte (cold-calls) ;
 *  - `compact` : version dense (Espace commercial), sans rappel « auto ».
 */
export default function MetricCard({
  label,
  hint,
  unit,
  realizedVal,
  target,
  autoVal,
  overridden,
  manual = false,
  realizedInput = '',
  onRealizedChange,
  compact = false,
}: {
  label: string;
  hint: string;
  unit: Unit;
  realizedVal: number | null;
  target: number | null;
  autoVal: number | null;
  overridden: boolean;
  manual?: boolean;
  realizedInput?: string;
  onRealizedChange?: (value: string) => void;
  compact?: boolean;
}) {
  const pct = progressPct(realizedVal, target);
  const level = progressLevel(pct);
  const heroColor = level ? LEVEL_TEXT[level] : 'text-gray-400';
  const heroSize = compact ? 'text-2xl' : 'text-3xl';
  return (
    <div className={`card ${compact ? 'p-4' : 'p-5'} flex flex-col gap-3 ${level ? '' : 'bg-gray-50/60'}`}>
      <div>
        <div className="text-sm font-medium text-gray-600">{label}</div>
        <div className="text-[11px] text-gray-400">{hint}</div>
      </div>
      <div>
        {manual ? (
          // Indicateur MANUEL (cold-calls) : le réalisé est SAISI dans la carte.
          <div className="flex items-baseline gap-1">
            <input
              type="number"
              min="0"
              inputMode="numeric"
              className={`w-28 ${heroSize} font-bold leading-tight border-b-2 border-gray-200 focus:border-primary-400 outline-none ${heroColor}`}
              value={realizedInput}
              onChange={(e) => onRealizedChange?.(e.target.value)}
              placeholder="0"
              aria-label={`Réalisé — ${label}`}
            />
            {unit && <span className="text-lg font-semibold text-gray-400">{unit}</span>}
          </div>
        ) : (
          <div className={`${heroSize} font-bold leading-tight ${heroColor}`}>
            {formatValue(realizedVal, unit)}
          </div>
        )}
        <div className="text-xs text-gray-400 mt-0.5">
          {target !== null ? `sur ${formatValue(target, unit)}` : "pas d'objectif"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`flex-1 ${compact ? 'h-2' : 'h-3'} rounded-full bg-gray-100 overflow-hidden`}>
          {pct !== null && level && (
            <div
              className={`h-full rounded-full ${LEVEL_BAR[level]}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          )}
        </div>
        <span className={`text-sm font-bold w-14 text-right ${level ? LEVEL_TEXT[level] : 'text-gray-300'}`}>
          {pct !== null ? `${pct} %` : '—'}
        </span>
      </div>
      {/* Rappel « auto X » : seulement en mode non-compact, pour les indicateurs
          AUTO corrigés (jamais pour un manuel : « auto 0 » serait trompeur). */}
      {!compact &&
        (manual ? (
          <div className="text-[11px] text-gray-400">réalisé saisi manuellement</div>
        ) : (
          overridden && <div className="text-[11px] text-gray-400">auto {formatValue(autoVal, unit)}</div>
        ))}
    </div>
  );
}
