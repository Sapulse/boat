import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, Plus, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import { formatDate, formatCurrency, getAlertLevel, getLeadFullName, daysSince, cn } from '../lib/utils';
import { LEAD_STATUSES, BOAT_TYPES, BOAT_CONDITIONS, SOURCES, ACTION_TYPES } from '../data/constants';

type SortField = 'name' | 'createdAt' | 'status' | 'budget' | 'lastActionDate' | 'nextActionDate';
type SortDir = 'asc' | 'desc';

export default function LeadsPage() {
  const { state, getCommercialName } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCommercial, setFilterCommercial] = useState('');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') ?? '');
  const [filterBoatType, setFilterBoatType] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterAlert, setFilterAlert] = useState(searchParams.get('alert') ?? '');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filtered = useMemo(() => {
    let leads = [...state.leads];

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
  }, [state.leads, search, filterCommercial, filterStatus, filterBoatType, filterCondition, filterSource, filterAlert, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 text-gray-300" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const hasFilters = filterCommercial || filterStatus || filterBoatType || filterCondition || filterSource || filterAlert;
  const clearFilters = () => {
    setFilterCommercial('');
    setFilterStatus('');
    setFilterBoatType('');
    setFilterCondition('');
    setFilterSource('');
    setFilterAlert('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher un lead..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn('btn-secondary btn-sm', showFilters && 'bg-primary-50 border-primary-300 text-primary-700')}
        >
          <Filter className="w-4 h-4" />
          Filtres
          {hasFilters && <span className="bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">!</span>}
        </button>
        {hasFilters && (
          <button onClick={clearFilters} className="btn-ghost btn-sm text-gray-500">
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
        <div className="ml-auto">
          <button onClick={() => navigate('/leads/new')} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Nouveau lead
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="label text-xs">Commercial</label>
              <select className="select text-xs" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
                <option value="">Tous</option>
                {state.commercials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Statut</label>
              <select className="select text-xs" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">Tous</option>
                {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Type</label>
              <select className="select text-xs" value={filterBoatType} onChange={e => setFilterBoatType(e.target.value)}>
                <option value="">Tous</option>
                {BOAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">État</label>
              <select className="select text-xs" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
                <option value="">Tous</option>
                {BOAT_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Source</label>
              <select className="select text-xs" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
                <option value="">Toutes</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">Alerte</label>
              <select className="select text-xs" value={filterAlert} onChange={e => setFilterAlert(e.target.value)}>
                <option value="">Toutes</option>
                <option value="orange">Orange</option>
                <option value="red">Rouge</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="text-sm text-gray-500">{filtered.length} lead(s)</div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600 w-8"></th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <span className="inline-flex items-center gap-1">Nom <SortIcon field="name" /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Commercial</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  <span className="inline-flex items-center gap-1">Statut <SortIcon field="status" /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Temp.</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Bateau</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('budget')}>
                  <span className="inline-flex items-center gap-1 justify-end">Budget <SortIcon field="budget" /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Prochaine action</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('lastActionDate')}>
                  <span className="inline-flex items-center gap-1">Dern. action <SortIcon field="lastActionDate" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const alert = getAlertLevel(lead);
                const days = daysSince(lead.lastActionDate || lead.createdAt);
                const nextAction = ACTION_TYPES.find(a => a.value === lead.nextActionType)?.label;
                return (
                  <tr
                    key={lead.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    <td className="px-4 py-3"><AlertDot level={alert} /></td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{getLeadFullName(lead)}</div>
                      <div className="text-xs text-gray-500">{lead.email || lead.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{getCommercialName(lead.commercialId)}</td>
                    <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                    <td className="px-4 py-3"><TemperatureBadge temperature={lead.temperature} /></td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{lead.source || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-700">{lead.boatInterest || '-'}</div>
                      <div className="text-xs text-gray-400">{[lead.boatType, lead.boatCondition].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(lead.budget)}</td>
                    <td className="px-4 py-3">
                      {nextAction ? (
                        <div>
                          <div className="text-xs text-gray-700">{nextAction}</div>
                          <div className="text-xs text-gray-400">{formatDate(lead.nextActionDate)}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs', days > 14 ? 'text-danger-600 font-medium' : days > 7 ? 'text-warning-600' : 'text-gray-500')}>
                        {days === Infinity ? '-' : days === 0 ? "Aujourd'hui" : `il y a ${days}j`}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    Aucun lead trouvé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
