import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Info, DollarSign, Percent } from 'lucide-react';
import { useApp } from '../context/useApp';
import { buildYearRange, formatCurrency } from '../lib/utils';
import { MONTHS } from '../data/constants';
import CommercialHeader from '../components/commercial/CommercialHeader';
import MetricCard from '../components/objectifs/MetricCard';
import { METRICS } from '../components/objectifs/metricsConfig';
import {
  computeAutoRealized,
  applyOverrides,
  sumSignedRevenue,
  conversionRate,
} from '../lib/goals';
import type { ReactNode } from 'react';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = buildYearRange();

// Placeholder de bloc (étape 3 : Pipeline / Agenda).
function BlockPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-400 mt-2">{note}</p>
    </div>
  );
}

// Tuile KPI simple (bloc Performances).
function Kpi({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      </div>
      <div className="p-2 rounded-lg bg-gray-50 text-gray-400">{icon}</div>
    </div>
  );
}

export default function EspaceCommercialPage() {
  const { state } = useApp();
  const now = new Date();
  const activeCommercials = state.commercials.filter((c) => c.active);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [commercialId, setCommercialId] = useState(activeCommercials[0]?.id ?? '');

  // Objectifs (lecture seule) : réalisé auto + override, pour ce commercial/mois.
  const auto = useMemo(
    () => computeAutoRealized(state.actions, state.leads, commercialId, year, month),
    [state.actions, state.leads, commercialId, year, month],
  );
  const goal = state.goals.find(
    (g) => g.commercialId === commercialId && g.year === year && g.month === month,
  );
  const realized = useMemo(() => applyOverrides(auto, goal), [auto, goal]);

  // Performances du mois (lib/goals — purs).
  const caSigne = sumSignedRevenue(state.leads, commercialId, year, month);
  const tauxTransfo = conversionRate(state.leads, commercialId, year, month);

  const goPrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Titre de page */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Espace commercial</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Synthèse par commercial : objectifs, performances, pipeline et agenda — regroupés en
          une vue. Lecture seule (la saisie reste sur chaque page dédiée).
        </p>
      </div>

      {/* Bandeau mono-poste (démonstration) */}
      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>Démonstration — données du poste ; vue par rôle réelle au backend.</span>
      </div>

      {activeCommercials.length === 0 ? (
        <div className="card p-6 text-sm text-gray-500">
          Aucun commercial actif. Ajoutez-en dans « Équipe » pour ouvrir un espace commercial.
        </div>
      ) : (
        <>
          {/* En-tête commercial (composant partagé) + sélecteur */}
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
                onChange={(e) => setCommercialId(e.target.value)}
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

          {/* Période + portée du sélecteur */}
          <div className="flex items-center gap-2 flex-wrap">
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
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="Année"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-400 ml-2">
              Le mois pilote <strong className="font-medium">Objectifs</strong> &amp;{' '}
              <strong className="font-medium">Performances</strong> · Pipeline = état courant ·
              Agenda = à venir
            </span>
          </div>

          {/* Bloc OBJECTIFS — 6 indicateurs condensés, lecture seule */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Objectifs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {METRICS.map((m) => (
                <MetricCard
                  key={m.key}
                  compact
                  label={m.label}
                  hint={m.hint}
                  unit={m.unit}
                  realizedVal={realized[m.key]}
                  target={goal?.[m.key]?.target ?? null}
                  autoVal={auto[m.key]}
                  overridden={goal?.[m.key]?.override != null}
                />
              ))}
            </div>
          </div>

          {/* Bloc PERFORMANCES — CA signé + taux de transfo du mois */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Performances — {MONTHS[month - 1]} {year}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Kpi
                label="CA signé"
                value={formatCurrency(caSigne)}
                icon={<DollarSign className="w-5 h-5" />}
              />
              <Kpi
                label="Taux de transformation"
                value={tauxTransfo !== null ? `${tauxTransfo} %` : '—'}
                icon={<Percent className="w-5 h-5" />}
              />
            </div>
          </div>

          {/* Blocs PIPELINE + AGENDA — étape 3 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BlockPlaceholder
              title="Pipeline"
              note="Leads par étape + chauds, état courant — à venir (étape 3)."
            />
            <BlockPlaceholder
              title="Agenda"
              note="Prochaines actions / RDV à venir — à venir (étape 3)."
            />
          </div>
        </>
      )}
    </div>
  );
}
