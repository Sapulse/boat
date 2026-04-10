import { useState, useMemo, useCallback } from 'react';
import { Save } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useApp } from '../context/AppContext';
import { MONTHLY_STAT_SOURCES, MONTHS } from '../data/constants';
import { formatCurrency, generateId } from '../lib/utils';
import type { MonthlyStat } from '../data/types';

export default function StatsPage() {
  const { state, saveMonthlyStats } = useApp();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [stats, setStats] = useState<MonthlyStat[]>(state.monthlyStats);
  const [dirty, setDirty] = useState(false);

  const getStatValue = useCallback((source: string, month: number, field: 'budget' | 'leads'): string => {
    const stat = stats.find(s => s.year === year && s.month === month && s.source === source);
    if (!stat) return '';
    const val = stat[field];
    return val !== null && val !== undefined ? String(val) : '';
  }, [stats, year]);

  const updateStat = (source: string, month: number, field: 'budget' | 'leads', value: string) => {
    setDirty(true);
    const numVal = value === '' ? null : Number(value);
    const idx = stats.findIndex(s => s.year === year && s.month === month && s.source === source);

    if (idx >= 0) {
      const updated = [...stats];
      const stat = { ...updated[idx], [field]: numVal };
      // Recalc CPL
      stat.cpl = (stat.leads && stat.leads > 0 && stat.budget) ? Math.round(stat.budget / stat.leads) : null;
      updated[idx] = stat;
      setStats(updated);
    } else {
      const budget = field === 'budget' ? numVal : null;
      const leads = field === 'leads' ? numVal : null;
      const cpl = (leads && leads > 0 && budget) ? Math.round(budget / leads) : null;
      setStats(prev => [...prev, { id: generateId(), year, month, source, budget, leads, cpl }]);
    }
  };

  const handleSave = () => {
    saveMonthlyStats(stats);
    setDirty(false);
  };

  // Chart data - by month
  const chartData = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const monthStats = stats.filter(s => s.year === year && s.month === month);
      const totalBudget = monthStats.reduce((s, st) => s + (st.budget ?? 0), 0);
      const totalLeads = monthStats.reduce((s, st) => s + (st.leads ?? 0), 0);
      const cpl = totalLeads > 0 ? Math.round(totalBudget / totalLeads) : 0;
      return { name: name.slice(0, 4), budget: totalBudget, leads: totalLeads, cpl };
    });
  }, [stats, year]);

  // Source summary
  const sourceSummary = useMemo(() => {
    return MONTHLY_STAT_SOURCES.map(source => {
      const sourceStats = stats.filter(s => s.year === year && s.source === source);
      const totalBudget = sourceStats.reduce((s, st) => s + (st.budget ?? 0), 0);
      const totalLeads = sourceStats.reduce((s, st) => s + (st.leads ?? 0), 0);
      const cpl = totalLeads > 0 ? Math.round(totalBudget / totalLeads) : null;
      return { source, budget: totalBudget, leads: totalLeads, cpl };
    });
  }, [stats, year]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <select className="select w-auto" value={year} onChange={e => setYear(Number(e.target.value))}>
            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button onClick={handleSave} className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`} disabled={!dirty}>
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Budget & Leads mensuels</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="budget" name="Budget (EUR)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="leads" name="Leads" fill="#22c55e" radius={[4, 4, 0, 0]} />
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

      {/* Summary table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Récapitulatif par source — {year}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Budget total</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Leads total</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">CPL moyen</th>
              </tr>
            </thead>
            <tbody>
              {sourceSummary.map(s => (
                <tr key={s.source} className="border-b border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{s.source}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatCurrency(s.budget)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{s.leads}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{s.cpl !== null ? formatCurrency(s.cpl) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly input table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Saisie mensuelle — {year}</h3>
          <p className="text-xs text-gray-400 mt-1">Saisissez le budget et le nombre de leads par source et par mois</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[120px]">Source</th>
                {MONTHS.map((m, idx) => (
                  <th key={idx} className="px-2 py-2 text-center font-medium text-gray-600 min-w-[100px]" colSpan={2}>
                    {m.slice(0, 4)}
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50/50 border-b border-gray-200">
                <th className="px-3 py-1 sticky left-0 bg-gray-50"></th>
                {MONTHS.map((_, idx) => [
                  <th key={`b-${idx}`} className="px-1 py-1 text-center text-gray-400 font-normal text-[10px]">Bud.</th>,
                  <th key={`l-${idx}`} className="px-1 py-1 text-center text-gray-400 font-normal text-[10px]">Leads</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {MONTHLY_STAT_SOURCES.map(source => (
                <tr key={source} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white">{source}</td>
                  {MONTHS.map((_, idx) => {
                    const month = idx + 1;
                    return [
                      <td key={`b-${idx}`} className="px-1 py-1">
                        <input
                          className="w-full text-center border border-gray-200 rounded px-1 py-1 text-xs focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none"
                          type="number"
                          value={getStatValue(source, month, 'budget')}
                          onChange={e => updateStat(source, month, 'budget', e.target.value)}
                          placeholder="-"
                        />
                      </td>,
                      <td key={`l-${idx}`} className="px-1 py-1">
                        <input
                          className="w-full text-center border border-gray-200 rounded px-1 py-1 text-xs focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none"
                          type="number"
                          value={getStatValue(source, month, 'leads')}
                          onChange={e => updateStat(source, month, 'leads', e.target.value)}
                          placeholder="-"
                        />
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
