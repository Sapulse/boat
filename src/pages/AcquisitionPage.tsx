import { useState, useMemo, type ReactNode } from 'react';
import { Save, DollarSign, Users, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { useApp } from '../context/useApp';
import PrintButton from '../components/print/PrintButton';
import PrintHeader from '../components/print/PrintHeader';
import { MONTHLY_STAT_SOURCES, ACQUISITION_SOURCES, ACQUISITION_SOURCES_ALL, MONTHS } from '../data/constants';
import { formatCurrency, generateId, buildYearRange } from '../lib/utils';
import { computeCpl, acquisitionTotals } from '../lib/acquisition';
import { useIsCompact, shortLabel } from '../lib/useIsCompact';
import type { MonthlyStat, AcquisitionVolume } from '../data/types';

type Tab = 'budget' | 'volumes' | 'saisie';

const COLORS = [
  '#3b82f6',
  '#0ea5e9',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#ef4444',
  '#22c55e',
  '#14b8a6',
  '#f97316',
  '#84cc16',
];

const CURRENT_YEAR = new Date().getFullYear();
// Plage DYNAMIQUE (annee courante +- amplitude, cf. buildYearRange / constants) :
// horizon glissant, plus aucune annee en dur, jamais de plafond de saisie future.
const YEAR_OPTIONS = buildYearRange();

// ---------------------------------------------------------------------------
// Tab 1 — Budget & CPL
// ---------------------------------------------------------------------------

function BudgetCplTab() {
  const { state } = useApp();
  const [year, setYear] = useState(CURRENT_YEAR);
  const stats = state.monthlyStats;

  const chartData = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const monthStats = stats.filter((s) => s.year === year && s.month === month);
      const totalBudget = monthStats.reduce((s, st) => s + (st.budget ?? 0), 0);
      const totalLeads = monthStats.reduce((s, st) => s + (st.leads ?? 0), 0);
      const cpl = totalLeads > 0 ? Math.round(totalBudget / totalLeads) : 0;
      return { name: name.slice(0, 4), budget: totalBudget, leads: totalLeads, cpl };
    });
  }, [stats, year]);

  const sourceSummary = useMemo(() => {
    return MONTHLY_STAT_SOURCES.map((source) => {
      const sourceStats = stats.filter((s) => s.year === year && s.source === source);
      const totalBudget = sourceStats.reduce((s, st) => s + (st.budget ?? 0), 0);
      const totalLeads = sourceStats.reduce((s, st) => s + (st.leads ?? 0), 0);
      const cpl = totalLeads > 0 ? Math.round(totalBudget / totalLeads) : null;
      return { source, budget: totalBudget, leads: totalLeads, cpl };
    });
  }, [stats, year]);

  const kpis = useMemo(() => {
    const yearStats = stats.filter((s) => s.year === year);
    const totalBudget = yearStats.reduce((s, st) => s + (st.budget ?? 0), 0);
    const totalLeads = yearStats.reduce((s, st) => s + (st.leads ?? 0), 0);
    const avgCpl = totalLeads > 0 ? Math.round(totalBudget / totalLeads) : null;
    return { totalBudget, totalLeads, avgCpl };
  }, [stats, year]);

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <select
          className="select w-auto"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Budget total</p>
              <p className="text-2xl font-bold mt-1 text-primary-600">
                {formatCurrency(kpis.totalBudget)}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-50 text-primary-600">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total leads</p>
              <p className="text-2xl font-bold mt-1 text-success-600">
                {kpis.totalLeads}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-50 text-success-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">CPL moyen</p>
              <p className="text-2xl font-bold mt-1 text-warning-600">
                {kpis.avgCpl !== null ? formatCurrency(kpis.avgCpl) : '-'}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-50 text-warning-600">
              <TrendingDown className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Budget &amp; Leads mensuels
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="budget"
                name="Budget (EUR)"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="leads"
                name="Leads"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">CPL mensuel</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v} EUR`, 'CPL']} />
              <Bar dataKey="cpl" name="CPL (EUR)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Source summary table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            Récapitulatif par source — {year}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Budget total
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Leads total
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  CPL moyen
                </th>
              </tr>
            </thead>
            <tbody>
              {sourceSummary.map((s) => (
                <tr key={s.source} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{s.source}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    {formatCurrency(s.budget)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{s.leads}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    {s.cpl !== null ? formatCurrency(s.cpl) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly input — read-only CPL display */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Aperçu CPL par source — {year}
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              CPL calculé automatiquement (budget ÷ leads)
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[130px]">
                  Source
                </th>
                {MONTHS.map((m, idx) => (
                  <th
                    key={idx}
                    className="px-2 py-2 text-center font-medium text-gray-600 min-w-[55px]"
                  >
                    {m.slice(0, 4)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTHLY_STAT_SOURCES.map((source) => (
                <tr key={source} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white">
                    {source}
                  </td>
                  {MONTHS.map((_, idx) => {
                    const month = idx + 1;
                    const stat = stats.find(
                      (s) => s.year === year && s.month === month && s.source === source
                    );
                    const cpl = stat?.cpl ?? null;
                    return (
                      <td key={idx} className="px-2 py-1.5 text-center text-gray-600">
                        {cpl !== null ? (
                          <span className="font-medium text-warning-600">
                            {cpl}€
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Volumes par plateforme
// ---------------------------------------------------------------------------

function VolumesTab() {
  const { state, saveAcquisitionVolumes } = useApp();
  const [year, setYear] = useState(CURRENT_YEAR);
  // Barres horizontales : YAxis reduit + libelles tronques sur ecran etroit.
  const compact = useIsCompact();
  const [volumes, setVolumes] = useState<AcquisitionVolume[]>(state.acquisitionVolumes);
  const [dirty, setDirty] = useState(false);

  const getValue = (source: string, month: number): string => {
    const v = volumes.find(
      (v) => v.year === year && v.month === month && v.source === source
    );
    return v ? String(v.leadCount) : '';
  };

  const updateValue = (source: string, month: number, value: string) => {
    setDirty(true);
    const count = value === '' ? 0 : Number(value);
    const idx = volumes.findIndex(
      (v) => v.year === year && v.month === month && v.source === source
    );
    if (idx >= 0) {
      const updated = [...volumes];
      updated[idx] = { ...updated[idx], leadCount: count };
      setVolumes(updated);
    } else {
      setVolumes((prev) => [
        ...prev,
        { id: generateId(), source, month, year, leadCount: count },
      ]);
    }
  };

  const handleSave = () => {
    saveAcquisitionVolumes(volumes);
    setDirty(false);
  };

  const monthlyTotals = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const total = volumes
        .filter((v) => v.year === year && v.month === month)
        .reduce((s, v) => s + v.leadCount, 0);
      return { name: name.slice(0, 4), total };
    });
  }, [volumes, year]);

  const sourceTotals = useMemo(() => {
    return ACQUISITION_SOURCES.map((source) => {
      const total = volumes
        .filter((v) => v.year === year && v.source === source)
        .reduce((s, v) => s + v.leadCount, 0);
      return { source, total };
    }).sort((a, b) => b.total - a.total);
  }, [volumes, year]);

  const sourceMonthly = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const row: Record<string, string | number> = { name: name.slice(0, 4) };
      ACQUISITION_SOURCES.forEach((source) => {
        const v = volumes.find(
          (v) => v.year === year && v.month === month && v.source === source
        );
        row[source] = v?.leadCount ?? 0;
      });
      return row;
    });
  }, [volumes, year]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <select
          className="select w-auto"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          onClick={handleSave}
          className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`}
          disabled={!dirty}
        >
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Total leads par mois
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyTotals}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" name="Leads" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Top sources — {year}
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sourceTotals.slice(0, 8)} layout="vertical" barSize={16}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                dataKey="source"
                type="category"
                width={compact ? 76 : 130}
                tick={{ fontSize: compact ? 9 : 10 }}
                tickFormatter={compact ? (v: string) => shortLabel(v) : undefined}
              />
              <Tooltip />
              <Bar dataKey="total" name="Leads" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Evolution line chart */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          Évolution mensuelle par source
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={sourceMonthly}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {ACQUISITION_SOURCES.slice(0, 6).map((source, idx) => (
              <Line
                key={source}
                type="monotone"
                dataKey={source}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Data entry table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            Volumes mensuels par plateforme — {year}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Saisissez le nombre de leads par source et par mois
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[140px]">
                  Source
                </th>
                {MONTHS.map((m, idx) => (
                  <th
                    key={idx}
                    className="px-2 py-2.5 text-center font-medium text-gray-600 min-w-[65px]"
                  >
                    {m.slice(0, 4)}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold text-gray-700 bg-gray-100">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {ACQUISITION_SOURCES.map((source) => {
                const rowTotal = volumes
                  .filter((v) => v.year === year && v.source === source)
                  .reduce((s, v) => s + v.leadCount, 0);
                return (
                  <tr key={source} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white">
                      {source}
                    </td>
                    {MONTHS.map((_, idx) => (
                      <td key={idx} className="px-1 py-1">
                        <input
                          className="w-full text-center border border-gray-200 rounded px-1 py-1 text-xs focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none"
                          type="number"
                          min="0"
                          value={getValue(source, idx + 1)}
                          onChange={(e) => updateValue(source, idx + 1, e.target.value)}
                          placeholder="-"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-center font-semibold text-gray-900 bg-gray-50">
                      {rowTotal > 0 ? rowTotal : '-'}
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
                <td className="px-3 py-2 text-gray-900 sticky left-0 bg-gray-100">
                  Total
                </td>
                {MONTHS.map((_, idx) => {
                  const month = idx + 1;
                  const colTotal = volumes
                    .filter((v) => v.year === year && v.month === month)
                    .reduce((s, v) => s + v.leadCount, 0);
                  return (
                    <td key={idx} className="px-2 py-2 text-center text-gray-900">
                      {colTotal > 0 ? colTotal : '-'}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-primary-700 bg-primary-50">
                  {volumes.filter((v) => v.year === year).reduce((s, v) => s + v.leadCount, 0) ||
                    '-'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Saisie mensuelle
// ---------------------------------------------------------------------------

// Champ de saisie numerique (budget / leads) — confortable, aligne a droite.
const ACQ_INPUT_CLS =
  'w-full text-right border border-gray-200 rounded px-2 py-1.5 text-sm ' +
  'focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none';

// Petite carte de total (budget / leads / CPL du mois affiche).
function TotalCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: 'primary' | 'success' | 'warning';
}) {
  const toneCls =
    tone === 'primary'
      ? 'text-primary-600'
      : tone === 'success'
        ? 'text-success-600'
        : 'text-warning-600';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</p>
        </div>
        <div className={`p-2.5 rounded-lg bg-gray-50 ${toneCls}`}>{icon}</div>
      </div>
    </div>
  );
}

function SaisieTab() {
  const { state, saveMonthlyStats } = useApp();
  const now = new Date();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [stats, setStats] = useState<MonthlyStat[]>(state.monthlyStats);
  const [dirty, setDirty] = useState(false);

  // Saisie centree sur le (mois, annee) selectionne -> plus de grille 12 mois.
  const findStat = (source: string) =>
    stats.find((s) => s.year === year && s.month === month && s.source === source);

  const fieldValue = (source: string, field: 'budget' | 'leads'): string => {
    const v = findStat(source)?.[field];
    return v !== null && v !== undefined ? String(v) : '';
  };

  const updateField = (source: string, field: 'budget' | 'leads', value: string) => {
    setDirty(true);
    const numVal = value === '' ? null : Number(value);
    setStats((prev) => {
      const idx = prev.findIndex(
        (s) => s.year === year && s.month === month && s.source === source
      );
      if (idx >= 0) {
        const updated = [...prev];
        const stat = { ...updated[idx], [field]: numVal };
        // CPL DERIVE (computeCpl). Le champ legacy `cpl` est garde EN PHASE le
        // temps que les lecteurs restants (dashboard/exports) migrent -> retire
        // en etape 3. Plus aucun calcul de CPL en dur ici.
        stat.cpl = computeCpl(stat.budget, stat.leads);
        updated[idx] = stat;
        return updated;
      }
      const budget = field === 'budget' ? numVal : null;
      const leads = field === 'leads' ? numVal : null;
      return [
        ...prev,
        { id: generateId(), year, month, source, budget, leads, cpl: computeCpl(budget, leads) },
      ];
    });
  };

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

  const handleSave = () => {
    saveMonthlyStats(stats);
    setDirty(false);
  };

  // Totaux du mois affiche (logique PURE, cf. lib/acquisition + harnais).
  const totals = useMemo(() => {
    const rows = ACQUISITION_SOURCES_ALL.map((src) => {
      const st = stats.find(
        (s) => s.year === year && s.month === month && s.source === src.name
      );
      return {
        budget: st?.budget ?? null,
        leads: st?.leads ?? null,
        paid: src.category === 'regie',
      };
    });
    return acquisitionTotals(rows);
  }, [stats, year, month]);

  const regies = ACQUISITION_SOURCES_ALL.filter((s) => s.category === 'regie');
  const plateformes = ACQUISITION_SOURCES_ALL.filter((s) => s.category === 'plateforme');

  return (
    <div className="space-y-6">
      {/* Navigation mois + annee + enregistrer */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Année"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`}
          disabled={!dirty}
        >
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>

      {/* Totaux du mois */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TotalCard
          label="Budget du mois"
          value={formatCurrency(totals.totalBudget)}
          icon={<DollarSign className="w-5 h-5" />}
          tone="primary"
        />
        <TotalCard
          label="Leads du mois"
          value={String(totals.totalLeads)}
          icon={<Users className="w-5 h-5" />}
          tone="success"
        />
        <TotalCard
          label="CPL moyen"
          value={totals.cpl !== null ? formatCurrency(totals.cpl) : '-'}
          icon={<TrendingDown className="w-5 h-5" />}
          tone="warning"
        />
      </div>

      {/* Grille de saisie : UNE ligne par source */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            Saisie — {MONTHS[month - 1]} {year}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Budget &amp; leads pour les régies (CPL calculé automatiquement), volume de leads
            pour les plateformes d&apos;annonces.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Source</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-44">Budget (€)</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-32">Leads</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-28">CPL</th>
            </tr>
          </thead>
          <tbody>
            {/* Régies payantes : budget + leads -> CPL */}
            <tr className="bg-gray-50/60">
              <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Régies payantes
              </td>
            </tr>
            {regies.map((src) => {
              const st = findStat(src.name);
              const cpl = computeCpl(st?.budget ?? null, st?.leads ?? null);
              return (
                <tr key={src.name} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-1.5 font-medium text-gray-700">{src.name}</td>
                  <td className="px-2 py-1">
                    <input
                      className={ACQ_INPUT_CLS}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={fieldValue(src.name, 'budget')}
                      onChange={(e) => updateField(src.name, 'budget', e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={ACQ_INPUT_CLS}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={fieldValue(src.name, 'leads')}
                      onChange={(e) => updateField(src.name, 'leads', e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-4 py-1.5 text-right font-medium">
                    {cpl !== null ? (
                      <span className="text-warning-600">{formatCurrency(cpl)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Plateformes d'annonces : volume de leads seul */}
            <tr className="bg-gray-50/60">
              <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Plateformes d&apos;annonces
              </td>
            </tr>
            {plateformes.map((src) => (
              <tr key={src.name} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-1.5 font-medium text-gray-700">{src.name}</td>
                <td className="px-4 py-1.5 text-right text-gray-300">—</td>
                <td className="px-2 py-1">
                  <input
                    className={ACQ_INPUT_CLS}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={fieldValue(src.name, 'leads')}
                    onChange={(e) => updateField(src.name, 'leads', e.target.value)}
                    placeholder="—"
                  />
                </td>
                <td className="px-4 py-1.5 text-right text-gray-300">—</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-gray-900">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{formatCurrency(totals.totalBudget)}</td>
              <td className="px-4 py-2 text-right">{totals.totalLeads}</td>
              <td className="px-4 py-2 text-right text-warning-700">
                {totals.cpl !== null ? formatCurrency(totals.cpl) : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page with tab navigation
// ---------------------------------------------------------------------------

const TABS: { id: Tab; label: string }[] = [
  { id: 'budget', label: 'Budget & CPL' },
  { id: 'volumes', label: 'Volumes par plateforme' },
  { id: 'saisie', label: 'Saisie mensuelle' },
];

export default function AcquisitionPage() {
  const [activeTab, setActiveTab] = useState<Tab>('budget');

  const activeLabel = TABS.find(t => t.id === activeTab)?.label ?? '';

  return (
    <div className="space-y-6">
      <PrintHeader title="Acquisition" subtitle={activeLabel} />

      {/* Page title */}
      <div className="flex items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Acquisition</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Suivi des budgets, CPL et volumes de leads par plateforme
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 no-print">
        <nav className="-mb-px flex gap-1" aria-label="Onglets">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors focus:outline-none',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 bg-primary-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'budget' && <BudgetCplTab />}
      {activeTab === 'volumes' && <VolumesTab />}
      {activeTab === 'saisie' && <SaisieTab />}
    </div>
  );
}
