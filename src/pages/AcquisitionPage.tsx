import { useState, useMemo, useCallback } from 'react';
import { Save, DollarSign, Users, TrendingDown } from 'lucide-react';
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
import { useApp } from '../context/AppContext';
import PrintButton from '../components/print/PrintButton';
import PrintHeader from '../components/print/PrintHeader';
import { MONTHLY_STAT_SOURCES, ACQUISITION_SOURCES, MONTHS } from '../data/constants';
import { formatCurrency, generateId } from '../lib/utils';
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
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

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
                width={130}
                tick={{ fontSize: 10 }}
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

function SaisieTab() {
  const { state, saveMonthlyStats } = useApp();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [stats, setStats] = useState<MonthlyStat[]>(state.monthlyStats);
  const [dirty, setDirty] = useState(false);

  const getStatValue = useCallback(
    (source: string, month: number, field: 'budget' | 'leads'): string => {
      const stat = stats.find(
        (s) => s.year === year && s.month === month && s.source === source
      );
      if (!stat) return '';
      const val = stat[field];
      return val !== null && val !== undefined ? String(val) : '';
    },
    [stats, year]
  );

  const getCpl = useCallback(
    (source: string, month: number): number | null => {
      const stat = stats.find(
        (s) => s.year === year && s.month === month && s.source === source
      );
      return stat?.cpl ?? null;
    },
    [stats, year]
  );

  const updateStat = (
    source: string,
    month: number,
    field: 'budget' | 'leads',
    value: string
  ) => {
    setDirty(true);
    const numVal = value === '' ? null : Number(value);
    const idx = stats.findIndex(
      (s) => s.year === year && s.month === month && s.source === source
    );
    if (idx >= 0) {
      const updated = [...stats];
      const stat = { ...updated[idx], [field]: numVal };
      stat.cpl =
        stat.leads && stat.leads > 0 && stat.budget
          ? Math.round(stat.budget / stat.leads)
          : null;
      updated[idx] = stat;
      setStats(updated);
    } else {
      const budget = field === 'budget' ? numVal : null;
      const leads = field === 'leads' ? numVal : null;
      const cpl = leads && leads > 0 && budget ? Math.round(budget / leads) : null;
      setStats((prev) => [
        ...prev,
        { id: generateId(), year, month, source, budget, leads, cpl },
      ]);
    }
  };

  const handleSave = () => {
    saveMonthlyStats(stats);
    setDirty(false);
  };

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

      {/* Monthly input table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            Saisie mensuelle — {year}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Saisissez le budget et le nombre de leads par source et par mois. Le CPL est
            calculé automatiquement.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[120px]">
                  Source
                </th>
                {MONTHS.map((m, idx) => (
                  <th
                    key={idx}
                    className="px-2 py-2 text-center font-medium text-gray-600 min-w-[110px]"
                    colSpan={3}
                  >
                    {m.slice(0, 4)}
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50/50 border-b border-gray-200">
                <th className="px-3 py-1 sticky left-0 bg-gray-50" />
                {MONTHS.map((_, idx) => [
                  <th
                    key={`b-${idx}`}
                    className="px-1 py-1 text-center text-gray-400 font-normal text-[10px]"
                  >
                    Budget
                  </th>,
                  <th
                    key={`l-${idx}`}
                    className="px-1 py-1 text-center text-gray-400 font-normal text-[10px]"
                  >
                    Leads
                  </th>,
                  <th
                    key={`c-${idx}`}
                    className="px-1 py-1 text-center text-gray-400 font-normal text-[10px]"
                  >
                    CPL
                  </th>,
                ])}
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
                    const cpl = getCpl(source, month);
                    return [
                      <td key={`b-${idx}`} className="px-1 py-1">
                        <input
                          className="w-full text-center border border-gray-200 rounded px-1 py-1 text-xs focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none"
                          type="number"
                          value={getStatValue(source, month, 'budget')}
                          onChange={(e) =>
                            updateStat(source, month, 'budget', e.target.value)
                          }
                          placeholder="-"
                        />
                      </td>,
                      <td key={`l-${idx}`} className="px-1 py-1">
                        <input
                          className="w-full text-center border border-gray-200 rounded px-1 py-1 text-xs focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none"
                          type="number"
                          value={getStatValue(source, month, 'leads')}
                          onChange={(e) =>
                            updateStat(source, month, 'leads', e.target.value)
                          }
                          placeholder="-"
                        />
                      </td>,
                      <td
                        key={`c-${idx}`}
                        className="px-1 py-1.5 text-center font-medium"
                      >
                        {cpl !== null ? (
                          <span className="text-warning-600">{cpl}€</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>,
                    ];
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
