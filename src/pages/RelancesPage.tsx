import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/useApp';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import { getAlertLevel, getLeadFullName, cn } from '../lib/utils';
import { getFollowUpLeads } from '../lib/relances';

export default function RelancesPage() {
  const { state, getCommercialName } = useApp();
  const navigate = useNavigate();

  const [filterCommercial, setFilterCommercial] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<'' | 'danger' | 'warning'>('');

  // Reutilise la detection existante (getLeadRisks via getFollowUpLeads),
  // tri fixe urgence -> anciennete, puis applique les filtres.
  const items = useMemo(() => {
    let list = getFollowUpLeads(state.leads);
    if (filterCommercial) list = list.filter(i => i.lead.commercialId === filterCommercial);
    if (filterSeverity) list = list.filter(i => i.maxSeverity === filterSeverity);
    return list;
  }, [state.leads, filterCommercial, filterSeverity]);

  const total = useMemo(() => getFollowUpLeads(state.leads).length, [state.leads]);
  const hasFilters = filterCommercial || filterSeverity;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">À relancer</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Leads actifs présentant au moins un risque, triés par urgence puis ancienneté.
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <select className="select text-sm" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
            <option value="">Tous les commerciaux</option>
            {state.commercials.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select text-sm" value={filterSeverity} onChange={e => setFilterSeverity(e.target.value as '' | 'danger' | 'warning')}>
            <option value="">Toutes urgences</option>
            <option value="danger">Critique</option>
            <option value="warning">Attention</option>
          </select>
          {hasFilters && (
            <button onClick={() => { setFilterCommercial(''); setFilterSeverity(''); }} className="btn-ghost btn-sm text-xs text-gray-500">
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-500">
        {items.length} lead(s) à relancer{hasFilters ? ` (sur ${total})` : ''}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="w-12 h-12" />}
          title={total === 0 ? 'Aucune relance en attente' : 'Aucun résultat'}
          description={total === 0
            ? 'Tous les leads actifs sont à jour : aucune relance détectée.'
            : 'Aucun lead à relancer ne correspond à ces filtres.'}
        />
      ) : (
        <div className="card divide-y divide-gray-100">
          {items.map(({ lead, risks, days }) => (
            <div
              key={lead.id}
              onClick={() => navigate(`/leads/${lead.id}`)}
              className="flex items-start gap-3 p-4 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="pt-0.5"><AlertDot level={getAlertLevel(lead)} /></div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{getLeadFullName(lead)}</span>
                  <StatusBadge status={lead.status} />
                  <TemperatureBadge temperature={lead.temperature} />
                  <span className="text-xs text-gray-400">{getCommercialName(lead.commercialId)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {risks.map((r, i) => (
                    <span
                      key={i}
                      className={cn(
                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md',
                        r.severity === 'danger' ? 'bg-danger-50 text-danger-700' : 'bg-warning-50 text-warning-700'
                      )}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', r.severity === 'danger' ? 'bg-danger-500' : 'bg-warning-500')} />
                      {r.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0 pt-0.5">
                <CalendarClock className="w-3.5 h-3.5" />
                <span className={cn(days > 14 ? 'text-danger-600 font-medium' : days > 7 ? 'text-warning-600' : '')}>
                  {days === Infinity ? '-' : days === 0 ? "Auj." : `${days}j`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
