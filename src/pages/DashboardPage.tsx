import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp, AlertTriangle, CheckCircle2, Clock, DollarSign,
  FileText, Target, ArrowRight,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useApp } from '../context/AppContext';
import KpiCard from '../components/ui/KpiCard';
import { StatusBadge, AlertDot } from '../components/ui/StatusBadge';
import { formatCurrency, getAlertLevel, getLeadFullName, daysSince, cn } from '../lib/utils';
import { ACTIVE_STATUSES, LEAD_STATUSES } from '../data/constants';

const COLORS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#22c55e', '#14b8a6', '#f97316'];

export default function DashboardPage() {
  const { state } = useApp();
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const leads = state.leads;
    const active = leads.filter(l => ACTIVE_STATUSES.includes(l.status));
    const signed = leads.filter(l => l.status === 'signe');
    const lost = leads.filter(l => l.status === 'perdu');
    const urgent = leads.filter(l => getAlertLevel(l) === 'red');
    const warning = leads.filter(l => getAlertLevel(l) === 'orange');

    const totalQuotes = leads
      .filter(l => ['devis_envoye', 'negociation', 'en_conclusion'].includes(l.status))
      .reduce((sum, l) => sum + (l.quoteAmount ?? 0), 0);
    const totalSigned = signed.reduce((sum, l) => sum + (l.quoteAmount ?? l.budget ?? 0), 0);

    // By commercial
    const byCommercial = state.commercials.map(c => ({
      name: c.name,
      actifs: active.filter(l => l.commercialId === c.id).length,
      signes: signed.filter(l => l.commercialId === c.id).length,
      montant: signed.filter(l => l.commercialId === c.id).reduce((s, l) => s + (l.quoteAmount ?? l.budget ?? 0), 0),
    }));

    // By status (for pipeline overview)
    const byStatus = LEAD_STATUSES.map(s => ({
      name: s.label,
      value: leads.filter(l => l.status === s.value).length,
      status: s.value,
    })).filter(s => s.value > 0);

    // By source
    const sourceMap = new Map<string, number>();
    leads.forEach(l => {
      if (l.source) sourceMap.set(l.source, (sourceMap.get(l.source) ?? 0) + 1);
    });
    const bySource = Array.from(sourceMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    return {
      total: leads.length,
      active: active.length,
      signed: signed.length,
      lost: lost.length,
      urgent: urgent.length,
      warning: warning.length,
      totalQuotes,
      totalSigned,
      byCommercial,
      byStatus,
      bySource,
      urgentLeads: [...urgent, ...warning].slice(0, 8),
    };
  }, [state.leads, state.commercials]);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Leads actifs"
          value={stats.active}
          icon={<Users className="w-5 h-5" />}
          color="text-primary-600"
        />
        <KpiCard
          title="Signés"
          value={stats.signed}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="text-success-600"
        />
        <KpiCard
          title="Urgences"
          value={stats.urgent}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="text-danger-600"
        />
        <KpiCard
          title="Volume devis"
          value={formatCurrency(stats.totalQuotes)}
          icon={<FileText className="w-5 h-5" />}
          color="text-purple-600"
        />
        <KpiCard
          title="Volume signé"
          value={formatCurrency(stats.totalSigned)}
          icon={<DollarSign className="w-5 h-5" />}
          color="text-success-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Urgent leads */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-danger-600" /> Leads urgents
            </h3>
            <button onClick={() => navigate('/leads?alert=red')} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
              Voir tout <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {stats.urgentLeads.length > 0 ? (
            <div className="space-y-2">
              {stats.urgentLeads.map(lead => {
                const alert = getAlertLevel(lead);
                const days = daysSince(lead.lastActionDate || lead.createdAt);
                return (
                  <div
                    key={lead.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    <AlertDot level={alert} />
                    <span className="font-medium text-gray-900 truncate flex-1">{getLeadFullName(lead)}</span>
                    <StatusBadge status={lead.status} />
                    <span className={cn('text-xs', days > 14 ? 'text-danger-600' : 'text-warning-600')}>
                      {days}j
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-6 text-center">Aucun lead urgent</p>
          )}
        </div>

        {/* Pipeline overview */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-primary-600" /> Répartition pipeline
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={stats.byStatus}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
              >
                {stats.byStatus.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value} leads`]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2 justify-center">
            {stats.byStatus.map((s, idx) => (
              <span key={s.name} className="text-xs text-gray-500 flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                {s.name} ({s.value})
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance by commercial */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary-600" /> Performance commerciaux
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.byCommercial} barGap={4}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="actifs" name="Actifs" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="signes" name="Signés" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By source */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary-600" /> Leads par source
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.bySource} layout="vertical" barSize={16}>
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name="Leads" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Commercial table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Détail par commercial</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-5 py-3 text-left font-medium text-gray-600">Commercial</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Leads actifs</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Signés</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Montant signé</th>
            </tr>
          </thead>
          <tbody>
            {stats.byCommercial.map(c => (
              <tr key={c.name} className="border-b border-gray-100">
                <td className="px-5 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-5 py-3 text-right text-gray-600">{c.actifs}</td>
                <td className="px-5 py-3 text-right text-success-600 font-medium">{c.signes}</td>
                <td className="px-5 py-3 text-right text-gray-900 font-semibold">{formatCurrency(c.montant)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
