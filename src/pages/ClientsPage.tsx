import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Download, Check, Users, Euro } from 'lucide-react';
import { useApp } from '../context/useApp';
import { SortIcon, type SortDir } from '../components/ui/SortIcon';
import { formatDate, formatCurrency, getLeadFullName, isoDateDaysAgo } from '../lib/utils';
import { exportCSV } from '../lib/csv';
import { useExportFeedback } from '../lib/useExportFeedback';
import { BOAT_TYPES, SOURCES, NO_COMMERCIAL_FILTER } from '../data/constants';
import { activateOnKey } from '../lib/a11y';
import type { Lead } from '../data/types';

// Colonnes triables de la liste Clients (même mécanisme que Leads).
type SortField = 'name' | 'commercial' | 'amount' | 'signedAt' | 'deliveryDate';

// Montant signé d'un client (devis prioritaire, sinon budget). Module-level (pur)
// pour ne pas polluer les deps du useMemo.
const clientAmount = (l: Lead) => l.quoteAmount ?? l.budget ?? 0;

export default function ClientsPage() {
  const { state, getCommercialName } = useApp();
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  // commercial / source initialisables par l'URL (lien KPI "Volume signé" du
  // Dashboard) — selects visibles et modifiables, comme sur la page Leads.
  const [filterCommercial, setFilterCommercial] = useState(searchParams.get('commercial') ?? '');
  const [filterBoatType, setFilterBoatType] = useState('');
  const [filterSource, setFilterSource] = useState(searchParams.get('source') ?? '');
  // Période initialisable par l'URL (lien KPI « Volume signé » du Dashboard) pour
  // que la liste concorde avec le montant affiché (même fenêtre sur createdAt).
  const [filterPeriod, setFilterPeriod] = useState(searchParams.get('period') ?? '');

  const validCommercialIds = useMemo(() => new Set(state.commercials.map(c => c.id)), [state.commercials]);
  const hasOrphanLeads = useMemo(() => state.leads.some(l => l.status === 'signe' && !validCommercialIds.has(l.commercialId)), [state.leads, validCommercialIds]);
  // Défaut = date de signature décroissante (comportement historique préservé).
  const [sortField, setSortField] = useState<SortField>('signedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const clients = useMemo(() => {
    let leads = state.leads.filter(l => l.status === 'signe');

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

    if (filterCommercial === NO_COMMERCIAL_FILTER) leads = leads.filter(l => !validCommercialIds.has(l.commercialId));
    else if (filterCommercial) leads = leads.filter(l => l.commercialId === filterCommercial);
    if (filterBoatType) leads = leads.filter(l => l.boatType === filterBoatType);
    if (filterSource) leads = leads.filter(l => l.source === filterSource);
    if (filterPeriod) {
      const cutoff = isoDateDaysAgo(Number(filterPeriod));
      leads = leads.filter(l => l.createdAt >= cutoff);
    }

    // Tri par colonne (même pattern que LeadsPage : switch + sens asc/desc).
    return leads.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = getLeadFullName(a).localeCompare(getLeadFullName(b)); break;
        case 'commercial': cmp = getCommercialName(a.commercialId).localeCompare(getCommercialName(b.commercialId)); break;
        case 'amount': cmp = clientAmount(a) - clientAmount(b); break;
        case 'signedAt': cmp = (a.signedAt || a.createdAt).localeCompare(b.signedAt || b.createdAt); break;
        case 'deliveryDate': cmp = (a.deliveryDate || 'z').localeCompare(b.deliveryDate || 'z'); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [state.leads, search, filterCommercial, filterBoatType, filterSource, filterPeriod, validCommercialIds, sortField, sortDir, getCommercialName]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const totalAmount = useMemo(
    () => clients.reduce((sum, l) => sum + clientAmount(l), 0),
    [clients]
  );

  const handleExport = () => {
    const headers = [
      'Nom', 'Prénom', 'Téléphone', 'Email', 'Commercial',
      'Bateau', 'Marque', 'Type', 'Source',
      'Montant signé', 'Date signature', 'Date livraison',
    ];
    const rows = clients.map(l => [
      l.lastName,
      l.firstName,
      l.phone,
      l.email,
      getCommercialName(l.commercialId),
      l.boatInterest,
      l.brand,
      l.boatType,
      l.source,
      l.quoteAmount !== null ? String(l.quoteAmount) : '',
      formatDate(l.signedAt),
      formatDate(l.deliveryDate),
    ]);
    exportCSV('clients.csv', headers, rows);
  };

  const { done: exportDone, trigger: triggerExport } = useExportFeedback(handleExport);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Rechercher un client..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="select w-auto text-sm"
          value={filterCommercial}
          onChange={e => setFilterCommercial(e.target.value)}
        >
          <option value="">Tous les commerciaux</option>
          {state.commercials.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (inactif)'}</option>
          ))}
          {hasOrphanLeads && <option value={NO_COMMERCIAL_FILTER}>— sans commercial</option>}
        </select>

        <select
          className="select w-auto text-sm"
          value={filterPeriod}
          onChange={e => setFilterPeriod(e.target.value)}
        >
          <option value="">Toute période</option>
          <option value="7">7 derniers jours</option>
          <option value="30">30 derniers jours</option>
          <option value="90">3 derniers mois</option>
          <option value="365">12 derniers mois</option>
        </select>

        <select
          className="select w-auto text-sm"
          value={filterBoatType}
          onChange={e => setFilterBoatType(e.target.value)}
        >
          <option value="">Tous les types</option>
          {BOAT_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          className="select w-auto text-sm"
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
        >
          <option value="">Toutes les sources</option>
          {SOURCES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <button onClick={triggerExport} disabled={exportDone} className="btn-secondary btn-sm ml-auto disabled:opacity-70">
          {exportDone ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          {exportDone ? 'Exporté ✓' : 'Exporter CSV'}
        </button>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 gap-4 max-w-sm">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-xs font-medium">Clients</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{clients.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <Euro className="w-4 h-4" />
            <span className="text-xs font-medium">Volume signé</span>
          </div>
          <p className="text-2xl font-bold text-success-600">{formatCurrency(totalAmount)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <span className="inline-flex items-center gap-1">Nom <SortIcon field="name" sortField={sortField} sortDir={sortDir} /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Téléphone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('commercial')}>
                  <span className="inline-flex items-center gap-1">Commercial <SortIcon field="commercial" sortField={sortField} sortDir={sortDir} /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Bateau</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Marque</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('amount')}>
                  <span className="inline-flex items-center gap-1 justify-end">Montant signé <SortIcon field="amount" sortField={sortField} sortDir={sortDir} /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('signedAt')}>
                  <span className="inline-flex items-center gap-1">Date signature <SortIcon field="signedAt" sortField={sortField} sortDir={sortDir} /></span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 cursor-pointer select-none" onClick={() => toggleSort('deliveryDate')}>
                  <span className="inline-flex items-center gap-1">Date livraison <SortIcon field="deliveryDate" sortField={sortField} sortDir={sortDir} /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map(lead => (
                <tr
                  key={lead.id}
                  tabIndex={0}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/leads/${lead.id}`)}
                  onKeyDown={activateOnKey(() => navigate(`/leads/${lead.id}`))}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{getLeadFullName(lead)}</div>
                    <div className="text-xs text-gray-400">{lead.source || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.phone || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{lead.email || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{getCommercialName(lead.commercialId)}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700">{lead.boatInterest || '-'}</div>
                    {lead.boatType && (
                      <div className="text-xs text-gray-400">{lead.boatType}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.brand || '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-success-600">
                    {formatCurrency(lead.quoteAmount ?? lead.budget)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(lead.signedAt)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(lead.deliveryDate)}</td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    Aucun client trouvé
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
