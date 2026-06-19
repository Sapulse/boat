import { useState, useMemo, useEffect } from 'react';
import { Save, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useApp } from '../context/useApp';
import { generateId, buildYearRange } from '../lib/utils';
import CommercialHeader from '../components/commercial/CommercialHeader';
import MetricCard from '../components/objectifs/MetricCard';
import { METRICS, FAMILIES, formatValue, type MetricKey } from '../components/objectifs/metricsConfig';
import { computeAutoRealized, applyOverrides } from '../lib/goals';
import { MONTHS } from '../data/constants';
import type { CommercialGoal, GoalMetric } from '../data/types';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = buildYearRange();

const INPUT_CLS =
  'w-full text-right border border-gray-200 rounded px-2 py-1.5 text-sm ' +
  'focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none';

function emptyMetric(): GoalMetric {
  return { target: null, override: null };
}
function emptyGoal(commercialId: string, year: number, month: number): CommercialGoal {
  return {
    id: generateId(),
    commercialId,
    year,
    month,
    prospectsCreated: emptyMetric(),
    coldCalls: emptyMetric(),
    followups: emptyMetric(),
    meetings: emptyMetric(),
    revenue: emptyMetric(),
    conversionRate: emptyMetric(),
  };
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
  const [editOpen, setEditOpen] = useState(false);

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
      {/* Titre de page */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Objectifs</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cibles par commercial et par mois ; le réalisé est calculé automatiquement,
          corrigeable à la main.
        </p>
      </div>

      {/* Bandeau mono-poste (démonstration) */}
      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>Démonstration — données du poste ; vue équipe consolidée au backend.</span>
      </div>

      {activeCommercials.length === 0 ? (
        <div className="card p-6 text-sm text-gray-500">
          Aucun commercial actif. Ajoutez-en dans « Équipe » pour définir des objectifs.
        </div>
      ) : (
        <>
          {/* En-tête commercial (composant partagé) : "sur qui" + période + sélecteur */}
          <CommercialHeader
            commercialId={commercialId}
            commercials={state.commercials}
            month={month}
            year={year}
          >
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                Commercial
              </label>
              <select
                className="select w-auto min-w-[160px]"
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
          </CommercialHeader>

          {/* Période (groupe distinct du commercial) */}
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

          {/* ZONE SUIVI — cartes regroupées par famille (l'essentiel, consultation) */}
          {FAMILIES.map((fam) => (
            <div key={fam.id} className="space-y-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {fam.label}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {METRICS.filter((m) => m.family === fam.id).map((m) => (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    hint={m.hint}
                    unit={m.unit}
                    realizedVal={realized[m.key]}
                    target={currentGoal?.[m.key]?.target ?? null}
                    autoVal={auto[m.key]}
                    overridden={currentGoal?.[m.key]?.override != null}
                    manual={m.manual}
                    realizedInput={metricValue(m.key, 'override')}
                    onRealizedChange={(v) => updateMetric(m.key, 'override', v)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* ZONE SAISIE — repliable (édition en dessous de la consultation) */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200">
              <button
                onClick={() => setEditOpen((o) => !o)}
                className="flex items-center gap-2 text-left"
                aria-expanded={editOpen}
              >
                {editOpen ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-sm font-semibold text-gray-900">Définir les objectifs</span>
                <span className="text-xs text-gray-400">
                  — {MONTHS[month - 1]} {year}
                </span>
              </button>
              <button
                onClick={handleSave}
                className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`}
                disabled={!dirty}
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>

            {editOpen && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">Indicateur</th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-48">Objectif</th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-48">
                      Correction manuelle
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m) => (
                    <tr key={m.key} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-2">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
