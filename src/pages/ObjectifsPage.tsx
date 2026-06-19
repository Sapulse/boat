import { useState, useMemo, useEffect } from 'react';
import { Save, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useApp } from '../context/useApp';
import { formatCurrency, generateId, buildYearRange } from '../lib/utils';
import {
  computeAutoRealized,
  applyOverrides,
  progressPct,
  progressLevel,
  type ProgressLevel,
} from '../lib/goals';
import { MONTHS } from '../data/constants';
import type { CommercialGoal, GoalMetric } from '../data/types';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = buildYearRange();

type MetricKey = 'calls' | 'followups' | 'meetings' | 'revenue' | 'conversionRate';
type Unit = '' | '€' | '%';

const METRICS: { key: MetricKey; label: string; unit: Unit; hint: string }[] = [
  { key: 'calls', label: 'Appels', unit: '', hint: "actions de type « appel »" },
  { key: 'followups', label: 'Relances', unit: '', hint: 'relance + email + sms + whatsapp' },
  { key: 'meetings', label: 'RDV / visites', unit: '', hint: 'rdv + visite' },
  { key: 'revenue', label: 'CA signé', unit: '€', hint: 'leads signés ce mois' },
  { key: 'conversionRate', label: 'Taux de transformation', unit: '%', hint: 'signés / (signés + perdus)' },
];

const INPUT_CLS =
  'w-full text-right border border-gray-200 rounded px-2 py-1.5 text-sm ' +
  'focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none';

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

function emptyMetric(): GoalMetric {
  return { target: null, override: null };
}
function emptyGoal(commercialId: string, year: number, month: number): CommercialGoal {
  return {
    id: generateId(),
    commercialId,
    year,
    month,
    calls: emptyMetric(),
    followups: emptyMetric(),
    meetings: emptyMetric(),
    revenue: emptyMetric(),
    conversionRate: emptyMetric(),
  };
}

// Affichage d'une valeur "realise" selon l'unite de l'indicateur.
function formatValue(value: number | null, unit: Unit): string {
  if (value === null || value === undefined) return '—';
  if (unit === '€') return formatCurrency(value);
  if (unit === '%') return `${value} %`;
  return String(value);
}

export default function ObjectifsPage() {
  const { state, saveGoals } = useApp();
  const now = new Date();
  const activeCommercials = state.commercials.filter((c) => c.active);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [commercialId, setCommercialId] = useState(activeCommercials[0]?.id ?? '');
  const [goals, setGoals] = useState<CommercialGoal[]>(state.goals);
  const [dirty, setDirty] = useState(false);

  // Garde anti-perte (comme Acquisition) : avertissement natif avant fermeture /
  // rechargement tant que des modifications sont en attente.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const currentGoal = goals.find(
    (g) => g.commercialId === commercialId && g.year === year && g.month === month,
  );

  // Realise AUTOMATIQUE (lib/goals — pur) + realise EFFECTIF (override ?? auto).
  const auto = useMemo(
    () => computeAutoRealized(state.actions, state.leads, commercialId, year, month),
    [state.actions, state.leads, commercialId, year, month],
  );
  const realized = useMemo(() => applyOverrides(auto, currentGoal), [auto, currentGoal]);

  const metricValue = (key: MetricKey, sub: 'target' | 'override'): string => {
    const v = currentGoal?.[key]?.[sub];
    return v !== null && v !== undefined ? String(v) : '';
  };

  const updateMetric = (key: MetricKey, sub: 'target' | 'override', value: string) => {
    if (!commercialId) return;
    setDirty(true);
    const numVal = value === '' ? null : Number(value);
    setGoals((prev) => {
      const idx = prev.findIndex(
        (g) => g.commercialId === commercialId && g.year === year && g.month === month,
      );
      if (idx >= 0) {
        const updated = [...prev];
        const g = updated[idx];
        updated[idx] = { ...g, [key]: { ...g[key], [sub]: numVal } };
        return updated;
      }
      const created = emptyGoal(commercialId, year, month);
      created[key] = { ...created[key], [sub]: numVal };
      return [...prev, created];
    });
  };

  // Garde au changement de contexte (mois / année / commercial) : si des
  // modifications sont en attente, on confirme ; abandonner -> on rejette la copie
  // de travail vers le dernier état enregistré (rien d'écrasé silencieusement).
  // (Quitter la page via le menu n'est pas bloquable avec HashRouter — beforeunload
  //  couvre la fermeture/rechargement ; même limite que sur Acquisition.)
  const confirmDiscardIfDirty = (): boolean => {
    if (!dirty) return true;
    const ok = window.confirm(
      'Vous avez des modifications non enregistrées. Quitter sans enregistrer ?',
    );
    if (ok) {
      setGoals(state.goals);
      setDirty(false);
    }
    return ok;
  };

  const goPrevMonth = () => {
    if (!confirmDiscardIfDirty()) return;
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (!confirmDiscardIfDirty()) return;
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const handleSave = () => {
    saveGoals(goals);
    setDirty(false);
  };

  return (
    <div className="space-y-6">
      {/* Titre */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Objectifs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cibles par commercial et par mois ; le réalisé est calculé automatiquement,
            corrigeable à la main.
          </p>
        </div>
        <button
          onClick={handleSave}
          className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`}
          disabled={!dirty}
        >
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>

      {/* Bandeau mono-poste (démonstration) */}
      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>Démonstration — données du poste ; vue équipe consolidée au backend.</span>
      </div>

      {/* Sélecteurs : mois + année + commercial */}
      <div className="flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrevMonth} className="btn-ghost btn-sm" aria-label="Mois précédent">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-base font-semibold text-gray-900 min-w-[150px] text-center">
            {MONTHS[month - 1]} {year}
          </div>
          <button onClick={goNextMonth} className="btn-ghost btn-sm" aria-label="Mois suivant">
            <ChevronRight className="w-4 h-4" />
          </button>
          <select
            className="select w-auto ml-2"
            value={year}
            onChange={(e) => {
              if (!confirmDiscardIfDirty()) return;
              setYear(Number(e.target.value));
            }}
            aria-label="Année"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <select
          className="select w-auto"
          value={commercialId}
          onChange={(e) => {
            if (!confirmDiscardIfDirty()) return;
            setCommercialId(e.target.value);
          }}
          aria-label="Commercial"
        >
          {activeCommercials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {activeCommercials.length === 0 ? (
        <div className="card p-6 text-sm text-gray-500">
          Aucun commercial actif. Ajoutez-en dans « Équipe » pour définir des objectifs.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">
              Objectifs &amp; réalisation — {MONTHS[month - 1]} {year}
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Saisissez l&apos;objectif (cible). Le réalisé auto vient des actions/leads du
              poste ; laissez la correction vide pour le garder automatique.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">Indicateur</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-36">Objectif</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-32">Réalisé</th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-40">Correction</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600 w-64">Progression</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const target = currentGoal?.[m.key]?.target ?? null;
                const overridden = currentGoal?.[m.key]?.override != null;
                const realizedVal = realized[m.key];
                const pct = progressPct(realizedVal, target);
                const level = progressLevel(pct);
                return (
                  <tr key={m.key} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-700">{m.label}</div>
                      <div className="text-[11px] text-gray-400">{m.hint}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          className={INPUT_CLS}
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={metricValue(m.key, 'target')}
                          onChange={(e) => updateMetric(m.key, 'target', e.target.value)}
                          placeholder="—"
                        />
                        {m.unit && <span className="text-gray-400 text-xs w-3">{m.unit}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="font-medium text-gray-900">{formatValue(realizedVal, m.unit)}</div>
                      {overridden && (
                        <div className="text-[11px] text-gray-400">auto {formatValue(auto[m.key], m.unit)}</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          className={INPUT_CLS}
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={metricValue(m.key, 'override')}
                          onChange={(e) => updateMetric(m.key, 'override', e.target.value)}
                          placeholder={formatValue(auto[m.key], m.unit)}
                        />
                        {m.unit && <span className="text-gray-400 text-xs w-3">{m.unit}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          {pct !== null && level && (
                            <div
                              className={`h-full rounded-full ${LEVEL_BAR[level]}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          )}
                        </div>
                        <span
                          className={`text-xs font-semibold w-14 text-right ${
                            level ? LEVEL_TEXT[level] : 'text-gray-300'
                          }`}
                        >
                          {pct !== null ? `${pct} %` : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
