import { useState, useMemo } from 'react';
import { Filter, Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from 'recharts';
import { useApp } from '../context/AppContext';
import KpiCard from '../components/ui/KpiCard';
import { formatCurrency } from '../lib/utils';
import { exportCSV } from '../lib/csv';
import { LEAD_STATUSES, BOAT_TYPES, BOAT_CONDITIONS, SOURCES, ACTIVE_STATUSES } from '../data/constants';
import type { LeadStatus } from '../data/types';
import { useSearchParams } from 'react-router-dom';

const COLORS = ['#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#22c55e', '#14b8a6', '#f97316', '#84cc16', '#a855f7'];

export default function PerformancePage() {
  const { state } = useApp();
  const [searchParams] = useSearchParams();
  const [filterCommercial, setFilterCommercial] = useState(searchParams.get('commercial') ?? '');
  const [filterBoatType, setFilterBoatType] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');

  const filtered = useMemo(() => {
    let leads = [...state.leads];
    if (filterCommercial) leads = leads.filter(l => l.commercialId === filterCommercial);
    if (filterBoatType) leads = leads.filter(l => l.boatType === filterBoatType);
    if (filterCondition) leads = leads.filter(l => l.boatCondition === filterCondition);
    if (filterStatus) leads = leads.filter(l => l.status === filterStatus);
    if (filterSource) leads = leads.filter(l => l.source === filterSource);
    if (filterPeriod) {
      const daysAgo = Number(filterPeriod);
      const cutoff = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
      leads = leads.filter(l => l.createdAt >= cutoff);
    }
    return leads;
  }, [state.leads, filterCommercial, filterBoatType, filterCondition, filterStatus, filterSource, filterPeriod]);

  const analytics = useMemo(() => {
    const byStatus = (status: LeadStatus) => filtered.filter(l => l.status === status);
    const amountByStatus = (status: LeadStatus) => byStatus(status).reduce((s, l) => s + (l.quoteAmount ?? l.budget ?? 0), 0);

    const commercialMap = new Map<string, number>();
    filtered.forEach(l => {
      const name = state.commercials.find(c => c.id === l.commercialId)?.name ?? l.commercialId;
      commercialMap.set(name, (commercialMap.get(name) ?? 0) + 1);
    });
    const byCommercial = Array.from(commercialMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    const sourceMap = new Map<string, number>();
    filtered.forEach(l => { if (l.source) sourceMap.set(l.source, (sourceMap.get(l.source) ?? 0) + 1); });
    const bySource = Array.from(sourceMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    const btMap = new Map<string, number>();
    filtered.forEach(l => { if (l.boatType) btMap.set(l.boatType, (btMap.get(l.boatType) ?? 0) + 1); });
    const byBoatType = Array.from(btMap.entries()).map(([name, value]) => ({ name, value }));

    const condMap = new Map<string, number>();
    filtered.forEach(l => { if (l.boatCondition) condMap.set(l.boatCondition, (condMap.get(l.boatCondition) ?? 0) + 1); });
    const byCondition = Array.from(condMap.entries()).map(([name, value]) => ({ name, value }));

    const statusData = LEAD_STATUSES.map(s => ({ name: s.label, value: byStatus(s.value).length })).filter(s => s.value > 0);

    const funnel = [
      { name: 'Nouveau', value: byStatus('nouveau').length + byStatus('a_contacter').length, fill: '#3b82f6' },
      { name: 'Contacte', value: byStatus('contacte').length + byStatus('qualifie').length, fill: '#0ea5e9' },
      { name: 'Devis', value: byStatus('devis_envoye').length, fill: '#8b5cf6' },
      { name: 'Negociation', value: byStatus('negociation').length, fill: '#f59e0b' },
      { name: 'Conclusion', value: byStatus('en_conclusion').length, fill: '#f97316' },
      { name: 'Signe', value: byStatus('signe').length, fill: '#22c55e' },
    ].filter(f => f.value > 0);

    const signedLeads = byStatus('signe');
    const lostLeads = byStatus('perdu');
    const conversionDenom = signedLeads.length + lostLeads.length;
    const conversionRate = conversionDenom > 0
      ? Math.round((signedLeads.length / conversionDenom) * 1000) / 10
      : null;

    const avgSignedAmount = signedLeads.length > 0
      ? amountByStatus('signe') / signedLeads.length
      : 0;

    const signedWithDates = signedLeads.filter(l => l.signedAt && l.createdAt);
    const avgDaysToSign = signedWithDates.length > 0
      ? Math.round(
          signedWithDates.reduce((sum, l) => {
            const daysBetween = (new Date(l.signedAt).getTime() - new Date(l.createdAt).getTime()) / 86400000;
            return sum + daysBetween;
          }, 0) / signedWithDates.length
        )
      : null;

    const activeCount = filtered.filter(l => ACTIVE_STATUSES.includes(l.status)).length;

    const sourceConversionMap = new Map<string, { signed: number; total: number }>();
    filtered.forEach(l => {
      if (!l.source) return;
      const entry = sourceConversionMap.get(l.source) ?? { signed: 0, total: 0 };
      entry.total += 1;
      if (l.status === 'signe') entry.signed += 1;
      sourceConversionMap.set(l.source, entry);
    });
    const sourceConversion = Array.from(sourceConversionMap.entries())
      .map(([name, { signed, total }]) => ({
        name,
        rate: Math.round((signed / total) * 1000) / 10,
        signed,
        total,
      }))
      .sort((a, b) => b.rate - a.rate);

    const commercialConversionMap = new Map<string, { signed: number; total: number }>();
    filtered.forEach(l => {
      const name = state.commercials.find(c => c.id === l.commercialId)?.name ?? l.commercialId;
      const entry = commercialConversionMap.get(name) ?? { signed: 0, total: 0 };
      entry.total += 1;
      if (l.status === 'signe') entry.signed += 1;
      commercialConversionMap.set(name, entry);
    });
    const commercialConversion = Array.from(commercialConversionMap.entries())
      .map(([name, { signed, total }]) => ({
        name,
        rate: Math.round((signed / total) * 1000) / 10,
      }))
      .sort((a, b) => b.rate - a.rate);

    return {
      total: filtered.length,
      nouveau: byStatus('nouveau').length, contacte: byStatus('contacte').length,
      devisEnvoye: byStatus('devis_envoye').length, enConclusion: byStatus('en_conclusion').length,
      signe: signedLeads.length, reporte: byStatus('reporte').length, perdu: lostLeads.length,
      amountDevis: amountByStatus('devis_envoye'), amountConclusion: amountByStatus('en_conclusion'),
      amountSigne: amountByStatus('signe'), amountPerdu: amountByStatus('perdu'),
      conversionRate, avgSignedAmount, avgDaysToSign, activeCount,
      sourceConversion, commercialConversion,
      byCommercial, bySource, byBoatType, byCondition, statusData, funnel,
    };
  }, [filtered, state.commercials]);

  const hasFilters = filterCommercial || filterBoatType || filterCondition || filterStatus || filterSource || filterPeriod;

  const exportData = () => {
    const headers = ['Indicateur', 'Valeur'];
    const rows = [
      ['Total leads', String(analytics.total)],
      ['Nouveaux', String(analytics.nouveau)],
      ['Contactes', String(analytics.contacte)],
      ['Devis envoyes', String(analytics.devisEnvoye)],
      ['En conclusion', String(analytics.enConclusion)],
      ['Signes', String(analytics.signe)],
      ['Reportes', String(analytics.reporte)],
      ['Perdus', String(analytics.perdu)],
      ['Montant devis', String(analytics.amountDevis)],
      ['Montant signes', String(analytics.amountSigne)],
    ];
    exportCSV(`performance-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filtres</span>
          <span className="text-xs text-gray-400 ml-2">{filtered.length} leads</span>
          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <button onClick={() => { setFilterCommercial(''); setFilterBoatType(''); setFilterCondition(''); setFilterStatus(''); setFilterSource(''); setFilterPeriod(''); }} className="btn-ghost btn-sm text-xs">
                Reinitialiser
              </button>
            )}
            <button onClick={exportData} className="btn-secondary btn-sm"><Download className="w-3.5 h-3.5" /> Export</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <select className="select text-sm" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            <option value="">Toute periode</option>
            <option value="30">30 jours</option>
            <option value="90">3 mois</option>
            <option value="365">12 mois</option>
          </select>
          <select className="select text-sm" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
            <option value="">Tous les commerciaux</option>
            {state.commercials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select text-sm" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">Toutes les sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select text-sm" value={filterBoatType} onChange={e => setFilterBoatType(e.target.value)}>
            <option value="">Tous les types</option>
            {BOAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select text-sm" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
            <option value="">Tous les etats</option>
            {BOAT_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Tous les statuts</option>
            {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Volume KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard title="Nouveaux" value={analytics.nouveau} color="text-gray-700" />
        <KpiCard title="Contactes" value={analytics.contacte} color="text-sky-600" />
        <KpiCard title="Devis envoyes" value={analytics.devisEnvoye} color="text-purple-600" />
        <KpiCard title="En conclusion" value={analytics.enConclusion} color="text-orange-600" />
        <KpiCard title="Signes" value={analytics.signe} color="text-success-600" />
        <KpiCard title="Reportes" value={analytics.reporte} color="text-warning-600" />
        <KpiCard title="Perdus" value={analytics.perdu} color="text-danger-600" />
      </div>

      {/* Amount KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Montant devis" value={formatCurrency(analytics.amountDevis)} color="text-purple-600" />
        <KpiCard title="Montant conclusion" value={formatCurrency(analytics.amountConclusion)} color="text-orange-600" />
        <KpiCard title="Montant signes" value={formatCurrency(analytics.amountSigne)} color="text-success-600" />
        <KpiCard title="Montant perdus" value={formatCurrency(analytics.amountPerdu)} color="text-danger-600" />
      </div>

      {/* Conversion KPIs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Conversion</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Taux de conversion" value={analytics.conversionRate !== null ? `${analytics.conversionRate}%` : '-'} color="text-primary-600" />
          <KpiCard title="Montant moyen signe" value={formatCurrency(analytics.avgSignedAmount)} color="text-success-600" />
          <KpiCard title="Delai moyen signature" value={analytics.avgDaysToSign !== null ? `${analytics.avgDaysToSign}j` : '-'} color="text-sky-600" />
          <KpiCard title="Leads actifs total" value={analytics.activeCount} color="text-gray-700" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Par commercial</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.byCommercial} barSize={28}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
              <Bar dataKey="value" name="Leads" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Par source</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.bySource.slice(0, 10)} layout="vertical" barSize={16}>
              <XAxis type="number" tick={{ fontSize: 12 }} /><YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} /><Tooltip />
              <Bar dataKey="value" name="Leads" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Taux de conversion par commercial</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.commercialConversion} barSize={28}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`, 'Conversion']} />
              <Bar dataKey="rate" name="Taux" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Taux de conversion par source</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={analytics.sourceConversion.slice(0, 8)} layout="vertical" barSize={16}>
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v}%`, 'Conversion']} />
              <Bar dataKey="rate" name="Taux" fill="#22c55e" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Par type de bateau</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={analytics.byBoatType} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {analytics.byBoatType.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Par etat</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={analytics.byCondition} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                {analytics.byCondition.map((_, idx) => <Cell key={idx} fill={COLORS[(idx + 3) % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Funnel */}
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
