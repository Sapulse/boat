import { useState, useMemo } from 'react';
import { Save } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { useApp } from '../context/AppContext';
import { ACQUISITION_SOURCES, MONTHS } from '../data/constants';
import { generateId } from '../lib/utils';
import type { AcquisitionVolume } from '../data/types';

const COLORS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#22c55e', '#14b8a6', '#f97316', '#84cc16'];

export default function HistoriquePage() {
  const { state, saveAcquisitionVolumes } = useApp();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [volumes, setVolumes] = useState<AcquisitionVolume[]>(state.acquisitionVolumes);
  const [dirty, setDirty] = useState(false);

  const getValue = (source: string, month: number): string => {
    const v = volumes.find(v => v.year === year && v.month === month && v.source === source);
    return v ? String(v.leadCount) : '';
  };

  const updateValue = (source: string, month: number, value: string) => {
    setDirty(true);
    const count = value === '' ? 0 : Number(value);
    const idx = volumes.findIndex(v => v.year === year && v.month === month && v.source === source);
    if (idx >= 0) {
      const updated = [...volumes];
      updated[idx] = { ...updated[idx], leadCount: count };
      setVolumes(updated);
    } else {
      setVolumes(prev => [...prev, { id: generateId(), source, month, year, leadCount: count }]);
    }
  };

  const handleSave = () => {
    saveAcquisitionVolumes(volumes);
    setDirty(false);
  };

  // Chart: total per month
  const monthlyTotals = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const total = volumes
        .filter(v => v.year === year && v.month === month)
        .reduce((s, v) => s + v.leadCount, 0);
      return { name: name.slice(0, 4), total };
    });
  }, [volumes, year]);

  // Chart: by source over months
  const sourceMonthly = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const row: Record<string, string | number> = { name: name.slice(0, 4) };
      ACQUISITION_SOURCES.forEach(source => {
        const v = volumes.find(v => v.year === year && v.month === month && v.source === source);
        row[source] = v?.leadCount ?? 0;
      });
      return row;
    });
  }, [volumes, year]);

  // Source totals for the year
  const sourceTotals = useMemo(() => {
    return ACQUISITION_SOURCES.map(source => {
      const total = volumes
        .filter(v => v.year === year && v.source === source)
        .reduce((s, v) => s + v.leadCount, 0);
      return { source, total };
    }).sort((a, b) => b.total - a.total);
  }, [volumes, year]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-700">Historique volumes d'acquisition</h3>
          <select className="select w-auto text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
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
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Total leads par mois</h3>
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
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Top sources — {year}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sourceTotals.slice(0, 8)} layout="vertical" barSize={16}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="source" type="category" width={130} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="total" name="Leads" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Evolution chart */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Évolution mensuelle par source</h3>
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
          <h3 className="text-sm font-semibold text-gray-900">Volumes mensuels par plateforme — {year}</h3>
          <p className="text-xs text-gray-400 mt-1">Saisissez le nombre de leads par source et par mois</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[140px]">Source</th>
                {MONTHS.map((m, idx) => (
                  <th key={idx} className="px-2 py-2.5 text-center font-medium text-gray-600 min-w-[65px]">
                    {m.slice(0, 4)}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold text-gray-700 bg-gray-100">Total</th>
              </tr>
            </thead>
            <tbody>
              {ACQUISITION_SOURCES.map(source => {
                const total = volumes
                  .filter(v => v.year === year && v.source === source)
                  .reduce((s, v) => s + v.leadCount, 0);
                return (
                  <tr key={source} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white">{source}</td>
                    {MONTHS.map((_, idx) => (
                      <td key={idx} className="px-1 py-1">
                        <input
                          className="w-full text-center border border-gray-200 rounded px-1 py-1 text-xs focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none"
                          type="number"
                          min="0"
                          value={getValue(source, idx + 1)}
                          onChange={e => updateValue(source, idx + 1, e.target.value)}
                          placeholder="-"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-center font-semibold text-gray-900 bg-gray-50">
                      {total > 0 ? total : '-'}
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
                <td className="px-3 py-2 text-gray-900 sticky left-0 bg-gray-100">Total</td>
                {MONTHS.map((_, idx) => {
                  const month = idx + 1;
                  const total = volumes
                    .filter(v => v.year === year && v.month === month)
                    .reduce((s, v) => s + v.leadCount, 0);
                  return (
                    <td key={idx} className="px-2 py-2 text-center text-gray-900">
                      {total > 0 ? total : '-'}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-primary-700 bg-primary-50">
                  {volumes.filter(v => v.year === year).reduce((s, v) => s + v.leadCount, 0) || '-'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
