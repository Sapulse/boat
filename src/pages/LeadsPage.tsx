import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, ChevronUp, ChevronDown, Download, Check, Eye, Edit2, Phone, Bookmark } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import { formatCurrency, getAlertLevel, getLeadFullName, daysSince, cn, isLeadActive } from '../lib/utils';
import { exportCSV } from '../lib/csv';
import { useExportFeedback } from '../lib/useExportFeedback';
import { LEAD_STATUSES, BOAT_TYPES, BOAT_CONDITIONS, SOURCES, TEMPERATURES, ACTION_TYPES } from '../data/constants';

type SavedView = { label: string; key: string; apply: () => void };

type SortField = 'name' | 'createdAt' | 'status' | 'budget' | 'lastActionDate' | 'nextActionDate';
type SortDir = 'asc' | 'desc';

export default function LeadsPage() {
  const { state, getCommercialName } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filterCommercial, setFilterCommercial] = useState('');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') ?? '');
  const [filterBoatType, setFilterBoatType] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterAlert, setFilterAlert] = useState(searchParams.get('alert') ?? '');
  const [filterTemp, setFilterTemp] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<'prospects' | 'all'>('prospects');
  const [activeView, setActiveView] = useState('');

  const clearAllFilters = () => {
    setFilterCommercial(''); setFilterStatus(''); setFilterBoatType(''); setFilterCondition('');
    setFilterSource(''); setFilterAlert(''); setFilterTemp(''); setActiveView('');
  };

  const savedViews: SavedView[] = [
    { label: 'Urgents', key: 'urgent', apply: () => { clearAllFilters(); setFilterAlert('red'); setActiveView('urgent'); } },
    { label: 'Chauds', key: 'chaud', apply: () => { clearAllFilters(); setFilterTemp('chaud'); setActiveView('chaud'); } },
    { label: 'Sans action', key: 'no-action', apply: () => { clearAllFilters(); setActiveView('no-action'); } },
    { label: 'Devis a relancer', key: 'devis', apply: () => { clearAllFilters(); setFilterStatus('devis_envoye'); setActiveView('devis'); } },
  ];

  const filtered = useMemo(() => {
    let leads = [...state.leads];

    if (viewMode === 'prospects') {
      leads = leads.filter(l => l.status !== 'signe');
    }

    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(l =>
        getLeadFullName(l).toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.boatInterest.toLowerCase().includes(q) ||
        l.brand.toLowerCase().includes(q)
      );
    }

    if (filterCommercial) leads = leads.filter(l => l.commercialId === filterCommercial);
    if (filterStatus) leads = leads.filter(l => l.status === filterStatus);
    if (filterBoatType) leads = leads.filter(l => l.boatType === filterBoatType);
    if (filterCondition) leads = leads.filter(l => l.boatCondition === filterCondition);
    if (filterSource) leads = leads.filter(l => l.source === filterSource);
    if (filterAlert) leads = leads.filter(l => getAlertLevel(l) === filterAlert);
    if (filterTemp) leads = leads.filter(l => l.temperature === filterTemp);
    if (activeView === 'no-action') leads = leads.filter(l => isLeadActive(l.status) && !l.nextActionType && !l.nextActionDate);

    leads.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = getLeadFullName(a).localeCompare(getLeadFullName(b)); break;
        case 'createdAt': cmp = a.createdAt.localeCompare(b.createdAt); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'budget': cmp = (a.budget ?? 0) - (b.budget ?? 0); break;
        case 'lastActionDate': cmp = (a.lastActionDate || '0').localeCompare(b.lastActionDate || '0'); break;
        case 'nextActionDate': cmp = (a.nextActionDate || 'z').localeCompare(b.nextActionDate || 'z'); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return leads;
  }, [state.leads, search, filterCommercial, filterStatus, filterBoatType, filterCondition, filterSource, filterAlert, filterTemp, sortField, sortDir, viewMode, activeView]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 text-gray-300" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const hasFilters = filterCommercial || filterStatus || filterBoatType || filterCondition || filterSource || filterAlert || filterTemp || activeView;

  const handleExportCSV = () => {
    const headers = ['Nom', 'Prenom', 'Email', 'Telephone', 'Commercial', 'Source', 'Statut', 'Type', 'Etat', 'Interet', 'Budget', 'Devis', 'Temperature', 'Date creation'];
    const rows = filtered.map(l => [
      l.lastName, l.firstName, l.email, l.phone, getCommercialName(l.commercialId),
      l.source, l.status, l.boatType, l.boatCondition, l.boatInterest,
      String(l.budget ?? ''), String(l.quoteAmount ?? ''), l.temperature, l.createdAt,
    ]);
    exportCSV(`leads-${viewMode}-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const { done: exportDone, trigger: triggerExport } = useExportFeedback(handleExportCSV);

  return (
    <div className="space-y-4">
      {/* View toggle + search + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('prospects')} className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-colors', viewMode === 'prospects' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            Prospects
          </button>
          <button onClick={() => setViewMode('all')} className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-colors', viewMode === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            Tous
          </button>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Rechercher un lead..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={triggerExport} disabled={exportDone} className="btn-secondary btn-sm disabled:opacity-70">
          {exportDone ? <><Check className="w-4 h-4" /> Exporté ✓</> : <><Download className="w-4 h-4" /> Export CSV</>}
        </button>
        <button onClick={() => navigate('/leads/new')} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Nouveau lead
        </button>
      </div>

      {/* Saved views */}
      <div className="flex items-center gap-2 flex-wrap">
        <Bookmark className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs text-gray-400">Vues :</span>
        {savedViews.map(v => (
          <button key={v.key} onClick={v.apply} className={cn('px-2.5 py-1 text-xs rounded-full border transition-colors', activeView === v.key ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
            {v.label}
          </button>
        ))}
        {hasFilters && (
          <button onClick={clearAllFilters} className="text-xs text-gray-400 hover:text-gray-600 ml-1">Reinitialiser</button>
        )}
      </div>

      {/* Always-visible filters */}
      <div className="card p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <select className="select text-xs" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
            <option value="">Commercial</option>
            {state.commercials.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select text-xs" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Statut</option>
            {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="select text-xs" value={filterBoatType} onChange={e => setFilterBoatType(e.target.value)}>
            <option value="">Type</option>
            {BOAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select text-xs" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
            <option value="">Etat</option>
            {BOAT_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select text-xs" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">Source</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select text-xs" value={filterTemp} onChange={e => setFilterTemp(e.target.value)}>
            <option value="">Temperature</option>
            {TEMPERATURES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="select text-xs" value={filterAlert} onChange={e => setFilterAlert(e.target.value)}>
            <option value="">Urgence</option>
            <option value="orange">Orange</option>
            <option value="red">Rouge</option>
          </select>
          {hasFilters ? (
            <button onClick={clearAllFilters} className="btn-ghost btn-sm text-xs">Reinitialiser</button>
          ) : (
            <div />
          )}
        </div>
      </div>

      <div className="text-sm text-gray-500">{filtered.length} lead(s)</div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-3 text-left font-medium text-gray-600 w-8"></th>
                <th className="px-3 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <span className="inline-flex items-center gap-1">Nom <SortIcon field="name" /></span>
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Commercial</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  <span className="inline-flex items-center gap-1">Statut <SortIcon field="status" /></span>
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Temp.</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Source</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Bateau</th>
                <th className="px-3 py-3 text-right font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('budget')}>
                  <span className="inline-flex items-center gap-1 justify-end">Budget <SortIcon field="budget" /></span>
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('lastActionDate')}>
                  <span className="inline-flex items-center gap-1">Dern. action <SortIcon field="lastActionDate" /></span>
                </th>
                <th className="px-3 py-3 text-center font-medium text-gray-600 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const alert = getAlertLevel(lead);
                const days = daysSince(lead.lastActionDate || lead.createdAt);
                const nextAction = ACTION_TYPES.find(a => a.value === lead.nextActionType)?.label;
                return (
                  <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors group">
                    <td className="px-3 py-2.5"><AlertDot level={alert} /></td>
                    <td className="px-3 py-2.5 cursor-pointer" onClick={() => navigate(`/leads/${lead.id}`)}>
                      <div className="font-medium text-gray-900">{getLeadFullName(lead)}</div>
                      <div className="text-xs text-gray-500">{lead.email || lead.phone}</div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{getCommercialName(lead.commercialId)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={lead.status} /></td>
                    <td className="px-3 py-2.5"><TemperatureBadge temperature={lead.temperature} /></td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{lead.source || '-'}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs text-gray-700">{lead.boatInterest || '-'}</div>
                      <div className="text-xs text-gray-400">{[lead.boatType, lead.boatCondition].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-900 text-xs">{formatCurrency(lead.budget)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs', days > 14 ? 'text-danger-600 font-medium' : days > 7 ? 'text-warning-600' : 'text-gray-500')}>
                          {days === Infinity ? '-' : days === 0 ? "Auj." : `${days}j`}
                        </span>
                        {nextAction && <span className="text-[10px] text-gray-400">{nextAction}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/leads/${lead.id}`); }} className="p-1 text-gray-400 hover:text-primary-600 rounded" title="Voir">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/leads/${lead.id}`); }} className="p-1 text-gray-400 hover:text-primary-600 rounded" title="Modifier">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {lead.phone && (
                          <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="p-1 text-gray-400 hover:text-success-600 rounded" title="Appeler">
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Aucun lead trouve</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
