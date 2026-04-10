import { useState, useMemo } from 'react';
import { Filter } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from 'recharts';
import { useApp } from '../context/AppContext';
import KpiCard from '../components/ui/KpiCard';
import { formatCurrency } from '../lib/utils';
import { LEAD_STATUSES, BOAT_TYPES, BOAT_CONDITIONS } from '../data/constants';
import type { LeadStatus } from '../data/types';

const COLORS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#22c55e', '#14b8a6', '#f97316', '#84cc16', '#a855f7'];

export default function AnalytiquePage() {
  const { state } = useApp();
  const [filterCommercial, setFilterCommercial] = useState('');
  const [filterBoatType, setFilterBoatType] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = useMemo(() => {
    let leads = [...state.leads];
    if (filterCommercial) leads = leads.filter(l => l.commercialId === filterCommercial);
    if (filterBoatType) leads = leads.filter(l => l.boatType === filterBoatType);
    if (filterCondition) leads = leads.filter(l => l.boatCondition === filterCondition);
    if (filterStatus) leads = leads.filter(l => l.status === filterStatus);
    return leads;
  }, [state.leads, filterCommercial, filterBoatType, filterCondition, filterStatus]);

  const analytics = useMemo(() => {
    const byStatus = (status: LeadStatus) => filtered.filter(l => l.status === status);
    const amountByStatus = (status: LeadStatus) =>
      byStatus(status).reduce((s, l) => s + (l.quoteAmount ?? l.budget ?? 0), 0);

    // By commercial
    const commercialMap = new Map<string, number>();
    filtered.forEach(l => {
      const name = state.commercials.find(c => c.id === l.commercialId)?.name ?? l.commercialId;
      commercialMap.set(name, (commercialMap.get(name) ?? 0) + 1);
    });
    const byCommercial = Array.from(commercialMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // By source
    const sourceMap = new Map<string, number>();
    filtered.forEach(l => {
      if (l.source) sourceMap.set(l.source, (sourceMap.get(l.source) ?? 0) + 1);
    });
    const bySource = Array.from(sourceMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // By boat type
    const btMap = new Map<string, number>();
    filtered.forEach(l => {
      if (l.boatType) btMap.set(l.boatType, (btMap.get(l.boatType) ?? 0) + 1);
    });
    const byBoatType = Array.from(btMap.entries()).map(([name, value]) => ({ name, value }));

    // By condition
    const condMap = new Map<string, number>();
    filtered.forEach(l => {
      if (l.boatCondition) condMap.set(l.boatCondition, (condMap.get(l.boatCondition) ?? 0) + 1);
    });
    const byCondition = Array.from(condMap.entries()).map(([name, value]) => ({ name, value }));

    // By status chart
    const statusData = LEAD_STATUSES.map(s => ({
      name: s.label,
      value: byStatus(s.value).length,
    })).filter(s => s.value > 0);

    // Funnel
    const funnel = [
      { name: 'Nouveau', value: byStatus('nouveau').length + byStatus('a_contacter').length, fill: '#3b82f6' },
      { name: 'Contacté', value: byStatus('contacte').length + byStatus('qualifie').length, fill: '#0ea5e9' },
      { name: 'Devis', value: byStatus('devis_envoye').length, fill: '#8b5cf6' },
      { name: 'Négociation', value: byStatus('negociation').length, fill: '#f59e0b' },
      { name: 'Conclusion', value: byStatus('en_conclusion').length, fill: '#f97316' },
      { name: 'Signé', value: byStatus('signe').length, fill: '#22c55e' },
    ].filter(f => f.value > 0);

    return {
      total: filtered.length,
      nouveau: byStatus('nouveau').length,
      contacte: byStatus('contacte').length,
      devisEnvoye: byStatus('devis_envoye').length,
      enConclusion: byStatus('en_conclusion').length,
      signe: byStatus('signe').length,
      reporte: byStatus('reporte').length,
      perdu: byStatus('perdu').length,
      amountDevis: amountByStatus('devis_envoye'),
      amountConclusion: amountByStatus('en_conclusion'),
      amountSigne: amountByStatus('signe'),
      amountPerdu: amountByStatus('perdu'),
      byCommercial,
      bySource,
      byBoatType,
      byCondition,
      statusData,
      funnel,
    };
  }, [filtered, state.commercials]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filtres</span>
          <span className="text-xs text-gray-400 ml-2">{filtered.length} leads</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select className="select text-sm" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
            <option value="">Tous les commerciaux</option>
            {state.commercials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select text-sm" value={filterBoatType} onChange={e => setFilterBoatType(e.target.value)}>
            <option value="">Tous les types</option>
            {BOAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select text-sm" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
            <option value="">Tous les états</option>
            {BOAT_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Volume KPIs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Volumes</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard title="Nouveaux" value={analytics.nouveau} color="text-gray-700" />
          <KpiCard title="Contactés" value={analytics.contacte} color="text-sky-600" />
          <KpiCard title="Devis envoyés" value={analytics.devisEnvoye} color="text-purple-600" />
          <KpiCard title="En conclusion" value={analytics.enConclusion} color="text-orange-600" />
          <KpiCard title="Signés" value={analytics.signe} color="text-success-600" />
          <KpiCard title="Reportés" value={analytics.reporte} color="text-warning-600" />
          <KpiCard title="Perdus" value={analytics.perdu} color="text-danger-600" />
        </div>
      </div>

      {/* Amount KPIs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Montants</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Devis envoyés" value={formatCurrency(analytics.amountDevis)} color="text-purple-600" />
          <KpiCard title="En conclusion" value={formatCurrency(analytics.amountConclusion)} color="text-orange-600" />
          <KpiCard title="Signés" value={formatCurrency(analytics.amountSigne)} color="text-success-600" />
          <KpiCard title="Perdus" value={formatCurrency(analytics.amountPerdu)} color="text-danger-600" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Commercial */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par commercial</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.byCommercial} barSize={28}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" name="Leads" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Source */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par source</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.bySource.slice(0, 10)} layout="vertical" barSize={16}>
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name="Leads" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By Boat Type */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par type de bateau</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={analytics.byBoatType} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {analytics.byBoatType.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* By Condition */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par état</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={analytics.byCondition} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {analytics.byCondition.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[(idx + 3) % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Status */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par statut</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={analytics.statusData} barSize={32}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" name="Leads" radius={[4, 4, 0, 0]}>
              {analytics.statusData.map((_, idx) => (
                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Conversion Funnel */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Tunnel de conversion</h3>
        <ResponsiveContainer width="100%" height={280}>
          <FunnelChart>
            <Tooltip />
            <Funnel dataKey="value" data={analytics.funnel} isAnimationActive>
              <LabelList position="right" fill="#374151" stroke="none" dataKey="name" fontSize={12} />
              <LabelList position="center" fill="#fff" stroke="none" dataKey="value" fontSize={14} fontWeight={600} />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
