import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Download, Check, Users, Euro } from 'lucide-react';
import { useApp } from '../context/useApp';
import { formatDate, formatCurrency, getLeadFullName } from '../lib/utils';
import { exportCSV } from '../lib/csv';
import { useExportFeedback } from '../lib/useExportFeedback';
import { BOAT_TYPES, SOURCES } from '../data/constants';
import { activateOnKey } from '../lib/a11y';

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

    if (filterCommercial) leads = leads.filter(l => l.commercialId === filterCommercial);
    if (filterBoatType) leads = leads.filter(l => l.boatType === filterBoatType);
    if (filterSource) leads = leads.filter(l => l.source === filterSource);

    return leads.sort((a, b) => (b.signedAt || b.createdAt).localeCompare(a.signedAt || a.createdAt));
  }, [state.leads, search, filterCommercial, filterBoatType, filterSource]);

  const totalAmount = useMemo(
    () => clients.reduce((sum, l) => sum + (l.quoteAmount ?? l.budget ?? 0), 0),
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
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
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
                <th className="px-4 py-3 text-left font-medium text-gray-600">Nom</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Téléphone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Commercial</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Bateau</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Marque</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Montant signé</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Date signature</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Date livraison</th>
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
