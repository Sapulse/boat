import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Target, TrendingUp } from 'lucide-react';
import { shortLabel, GUTTER_COMPACT, GUTTER_WIDE } from '../../lib/useIsCompact';

// Graphiques du Dashboard, EXTRAITS de la page (audit perf) : recharts pèse
// ~340 kB et le Dashboard est la route d'accueil — via React.lazy (côté page),
// le chunk recharts sort du chemin critique du premier rendu. Deux exports
// nommés = un seul chunk, deux points de suspension indépendants côté page.
// AUCUN changement visuel : le JSX est repris à l'identique.

const COLORS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#22c55e', '#14b8a6', '#f97316'];

interface NameValue { name: string; value: number }
interface CommercialPerf { name: string; actifs: number; signes: number }

/** Répartition pipeline (camembert) + performance commerciaux (barres). */
export function ChartsRow({ byStatus, byCommercial }: { byStatus: NameValue[]; byCommercial: CommercialPerf[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-primary-600" /> Répartition pipeline
        </h3>
        {byStatus.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {byStatus.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => [`${value} leads`]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-2 justify-center">
              {byStatus.map((s, idx) => (
                <span key={s.name} className="text-xs text-gray-500 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  {s.name} ({s.value})
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400 py-12 text-center">Aucune donnée pour cette période</p>
        )}
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary-600" /> Performance commerciaux
        </h3>
        {byCommercial.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCommercial} barGap={4}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="actifs" name="Actifs" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="signes" name="Signés" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400 py-12 text-center">Aucune donnée</p>
        )}
      </div>
    </div>
  );
}

/** Leads par source (barres horizontales, libellés tronqués en compact). */
export function SourceChart({ bySource, compact }: { bySource: NameValue[]; compact: boolean }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Leads par source</h3>
      {bySource.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bySource} layout="vertical" barSize={16}>
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis dataKey="name" type="category" width={compact ? GUTTER_COMPACT : GUTTER_WIDE} tick={{ fontSize: compact ? 10 : 11 }} tickFormatter={compact ? (v: string) => shortLabel(v) : undefined} />
            <Tooltip />
            <Bar dataKey="value" name="Leads" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-gray-400 py-12 text-center">Aucune donnée</p>
      )}
    </div>
  );
}
