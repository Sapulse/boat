import { useState, useMemo, lazy, Suspense, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLeadClickProps } from '../hooks/useOpenLead';
import {
  Users, AlertTriangle, CheckCircle2, DollarSign,
  FileText, ArrowRight, Flame, Clock, XCircle,
  CalendarOff, CalendarCheck, CalendarX, CalendarPlus,
} from 'lucide-react';
import { useApp } from '../context/useApp';
import KpiCard from '../components/ui/KpiCard';
import Repliable from '../components/ui/Repliable';
import { StatusBadge, AlertDot } from '../components/ui/StatusBadge';
import PrintButton from '../components/print/PrintButton';
import PrintHeader from '../components/print/PrintHeader';
import { cn, formatCurrency, getAlertLevel, getLeadFullName, daysSince, isLeadActive, hasPlannedNextAction, hasFutureNextAction, isoDateDaysAgo, isInactiveOverWeek, isHotLeadWithoutAction, toISODate } from '../lib/utils';
import { ACTIVE_STATUSES, LEAD_STATUSES, SOURCES, QUOTE_STATUSES } from '../data/constants';
import { activateOnKey } from '../lib/a11y';
import { useIsCompact } from '../lib/useIsCompact';
import { eligibleCommercials, planningIndicators } from '../lib/plannedActions';
import { agendaLink } from '../lib/agenda';
import type { Lead } from '../data/types';

// Graphiques recharts (~340 kB) CHARGÉS EN DIFFÉRÉ (audit perf). Lot 4 : ils
// vivent dans « Plus d'indicateurs », replié par défaut — le chunk n'est
// demandé qu'à l'ouverture du volet. Deux imports lazy -> même chunk.
const ChartsRow = lazy(() => import('../components/dashboard/DashboardCharts').then(m => ({ default: m.ChartsRow })));
const SourceChart = lazy(() => import('../components/dashboard/DashboardCharts').then(m => ({ default: m.SourceChart })));

function ChartSkeleton({ height }: { height: number }) {
  return <div className="card p-5 animate-pulse bg-gray-50" style={{ height }} />;
}

/** Indicateur du haut : un VRAI lien (clic milieu / nouvel onglet possibles). */
function Indicator({ to, title, value, hint, icon, tone, testId }: {
  to: string; title: string; value: number; hint?: ReactNode; icon: ReactNode;
  tone: 'primary' | 'danger' | 'warning'; testId: string;
}) {
  const color = { primary: 'text-primary-600', danger: 'text-danger-600', warning: 'text-warning-600' }[tone];
  return (
    <Link to={to} data-testid={testId} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-primary-500">
      <div className={cn('p-2.5 rounded-lg bg-gray-50 shrink-0', color)}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <p className={cn('text-3xl font-bold tabular-nums', value > 0 ? color : 'text-gray-300')}>{value}</p>
      <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
    </Link>
  );
}

function LeadList({ title, icon, leads, empty, emptyTone = 'success', link, right }: {
  title: string; icon: ReactNode; leads: Lead[]; empty: string; emptyTone?: 'success' | 'muted';
  link?: string; right: (lead: Lead) => ReactNode;
}) {
  const navigate = useNavigate();
  const leadClick = useLeadClickProps();
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">{icon} {title}</h3>
        {link && (
          <button onClick={() => navigate(link)} className="text-[10px] text-primary-600 hover:underline flex items-center gap-0.5">
            Tout <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
      {leads.length > 0 ? (
        <div className="space-y-1.5">
          {leads.map(lead => (
            <div key={lead.id} role="button" tabIndex={0} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-xs" {...leadClick(lead.id)}>
              {right(lead)}
            </div>
          ))}
        </div>
      ) : (
        <p className={cn('text-xs py-4 text-center', emptyTone === 'success' ? 'text-success-600' : 'text-gray-400')}>{empty}</p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { state } = useApp();
  const navigate = useNavigate();
  // Graphes a barres horizontales : sur ecran etroit, le YAxis 120px mangeait
  // un tiers de la largeur -> axe reduit + libelles tronques (tooltip complet).
  const compact = useIsCompact();

  // Lot 4 : UN seul sélecteur commercial, en haut, qui pilote TOUT l'écran.
  // « Non attribué » n'y figure pas (ce n'est pas une personne) : sa part est
  // montrée dans l'indicateur « À planifier » de la vue « Tous ».
  const [filterCommercial, setFilterCommercial] = useState('');
  // Période et source : propres au volet « Plus d'indicateurs ».
  const [filterSource, setFilterSource] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const todayISO = toISODate(new Date());
  const selectable = eligibleCommercials(state.commercials);
  const commercialId = filterCommercial || undefined;

  const indicators = useMemo(
    () => planningIndicators(state.plannedActions, state.leads, state.commercials, todayISO, commercialId),
    [state.plannedActions, state.leads, state.commercials, todayISO, commercialId],
  );

  // Listes toujours visibles : filtrées par le seul commercial.
  const byCommercial = useMemo(
    () => (filterCommercial ? state.leads.filter(l => l.commercialId === filterCommercial) : state.leads),
    [state.leads, filterCommercial],
  );
  const urgentLeads = useMemo(() => {
    const red = byCommercial.filter(l => getAlertLevel(l) === 'red');
    const orange = byCommercial.filter(l => getAlertLevel(l) === 'orange');
    return [...red, ...orange].slice(0, 6);
  }, [byCommercial]);
  // Meme regle v3.4 que le risque "devis sans relance" de getLeadRisks : une
  // action future planifiee suspend l'inactivite (sinon ce bloc divergerait
  // de la vue A relancer).
  const devisSansRelance = useMemo(
    () => byCommercial.filter(l => l.status === 'devis_envoye' && !hasFutureNextAction(l) && daysSince(l.lastActionDate || l.createdAt) > 5).slice(0, 5),
    [byCommercial],
  );

  // « Plus d'indicateurs » : commercial + période + source.
  const filtered = useMemo(() => {
    let leads = byCommercial;
    if (filterSource) leads = leads.filter(l => l.source === filterSource);
    if (filterPeriod) {
      const cutoff = isoDateDaysAgo(Number(filterPeriod));
      leads = leads.filter(l => l.createdAt >= cutoff);
    }
    return leads;
  }, [byCommercial, filterSource, filterPeriod]);

  const stats = useMemo(() => {
    if (!moreOpen) return null; // calcul différé : volet replié par défaut
    const leads = filtered;
    const active = leads.filter(l => ACTIVE_STATUSES.includes(l.status));
    const signed = leads.filter(l => l.status === 'signe');
    const urgent = leads.filter(l => getAlertLevel(l) === 'red');
    const hotNoAction = leads.filter(isHotLeadWithoutAction);
    const noRecentAction = leads.filter(isInactiveOverWeek);
    const sansProchAction = leads.filter(l => isLeadActive(l.status) && !hasPlannedNextAction(l));

    const totalQuotes = leads
      .filter(l => QUOTE_STATUSES.includes(l.status))
      .reduce((sum, l) => sum + (l.quoteAmount ?? 0), 0);
    const totalSigned = signed.reduce((sum, l) => sum + (l.quoteAmount ?? l.budget ?? 0), 0);

    // Détail par commercial : TOUS les commerciaux ayant des leads (actifs OU
    // désactivés) + un regroupement « — » pour les leads sans commercial valide,
    // afin que la somme des lignes == le total affiché.
    const commercialNameById = new Map(state.commercials.map(c => [c.id, c.name]));
    const groups = new Map<string, { id: string; name: string; actifs: number; signes: number; montant: number }>();
    for (const l of leads) {
      const known = commercialNameById.has(l.commercialId);
      const key = known ? l.commercialId : '__orphan__';
      let g = groups.get(key);
      if (!g) {
        g = { id: known ? l.commercialId : '', name: known ? (commercialNameById.get(l.commercialId) ?? '—') : '—', actifs: 0, signes: 0, montant: 0 };
        groups.set(key, g);
      }
      if (ACTIVE_STATUSES.includes(l.status)) g.actifs++;
      if (l.status === 'signe') { g.signes++; g.montant += (l.quoteAmount ?? l.budget ?? 0); }
    }
    const byCommercialRows = [...groups.values()].sort((a, b) => b.signes - a.signes || b.actifs - a.actifs || a.name.localeCompare(b.name));

    const byStatus = LEAD_STATUSES.map(s => ({
      name: s.label,
      value: leads.filter(l => l.status === s.value).length,
    })).filter(s => s.value > 0);

    const sourceMap = new Map<string, number>();
    leads.forEach(l => { if (l.source) sourceMap.set(l.source, (sourceMap.get(l.source) ?? 0) + 1); });
    const bySource = Array.from(sourceMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);

    return {
      active: active.length, signed: signed.length,
      urgent: urgent.length, totalQuotes, totalSigned,
      noRecentAction: noRecentAction.length,
      byCommercial: byCommercialRows, byStatus, bySource,
      hotLeads: hotNoAction.slice(0, 5),
      sansProchAction: sansProchAction.slice(0, 5),
    };
  }, [moreOpen, filtered, state.commercials]);

  // Liens : propagent le commercial (partout) et, depuis le volet, la période et
  // la source — la liste ouverte correspond exactement au compteur cliqué.
  const buildLink = (path: string, extra?: Record<string, string>, withMore = false) => {
    const params = new URLSearchParams(extra);
    if (filterCommercial) params.set('commercial', filterCommercial);
    if (withMore && filterSource) params.set('source', filterSource);
    if (withMore && filterPeriod && (path === '/leads' || path === '/clients')) params.set('period', filterPeriod);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const moreLink = (path: string, extra?: Record<string, string>) => buildLink(path, extra, true);

  const unassignedHint = !commercialId && indicators.toPlanUnassigned > 0
    ? `dont ${indicators.toPlanUnassigned} non attribué${indicators.toPlanUnassigned > 1 ? 's' : ''}`
    : 'leads sans action à faire';

  return (
    <div className="space-y-6">
      <PrintHeader title="Tableau de bord commercial" />

      {/* Sélecteur unique */}
      <div className="card p-3 no-print">
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="dashboard-commercial" className="text-sm font-medium text-gray-600">Commercial</label>
          <select id="dashboard-commercial" className="select text-sm w-auto" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
            <option value="">Tous les commerciaux</option>
            {selectable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="ml-auto"><PrintButton /></span>
        </div>
      </div>

      {/* 3 indicateurs : mêmes calculs que la pastille de l'Agenda et la vue « À planifier » */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Indicator
          testId="indicateur-aujourdhui"
          to={agendaLink({ vue: 'jour', date: todayISO, commercial: filterCommercial })}
          title="À faire aujourd'hui"
          hint={commercialId ? 'actions où il est responsable ou participant' : 'une action à plusieurs compte une fois'}
          value={indicators.today}
          icon={<CalendarCheck className="w-5 h-5" />}
          tone="primary"
        />
        <Indicator
          testId="indicateur-retard"
          to={agendaLink({ retards: true, commercial: filterCommercial })}
          title="En retard"
          hint="hors Signés et Perdus"
          value={indicators.overdue}
          icon={<CalendarX className="w-5 h-5" />}
          tone="danger"
        />
        <Indicator
          testId="indicateur-a-planifier"
          to={buildLink('/leads', { view: 'a-planifier' })}
          title="À planifier"
          hint={unassignedHint}
          value={indicators.toPlan}
          icon={<CalendarPlus className="w-5 h-5" />}
          tone="warning"
        />
      </div>

      {/* Toujours visibles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LeadList
          title="Leads urgents"
          icon={<AlertTriangle className="w-3.5 h-3.5 text-danger-600" />}
          leads={urgentLeads}
          empty="Aucun"
          emptyTone="muted"
          link={buildLink('/leads', { alert: 'red' })}
          right={lead => (<>
            <AlertDot level={getAlertLevel(lead)} />
            <span className="font-medium text-gray-900 truncate flex-1">{getLeadFullName(lead)}</span>
            <span className="text-gray-400">{daysSince(lead.lastActionDate || lead.createdAt)}j</span>
          </>)}
        />
        <LeadList
          title="Devis sans relance"
          icon={<XCircle className="w-3.5 h-3.5 text-warning-600" />}
          leads={devisSansRelance}
          empty="Tous relancés"
          right={lead => (<>
            <span className="font-medium text-gray-900 truncate flex-1">{getLeadFullName(lead)}</span>
            <span className="text-warning-600">{daysSince(lead.lastActionDate || lead.createdAt)}j</span>
          </>)}
        />
      </div>

      {/* Plus d'indicateurs : replié par défaut, période et source ici */}
      <Repliable
        open={moreOpen}
        onToggle={() => setMoreOpen(o => !o)}
        label="Plus d'indicateurs"
        className="card p-3"
        title={<span className="text-sm font-semibold text-gray-900">Plus d'indicateurs</span>}
        aside={moreOpen ? (
          <span className="text-xs text-gray-400">{filtered.length} leads</span>
        ) : undefined}
      >
        {stats && (
          <div className="space-y-6 mt-3">
            <div className="flex items-center gap-3 flex-wrap no-print">
              <select aria-label="Période" className="select text-xs w-auto" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
                <option value="">Toute période</option>
                <option value="7">7 derniers jours</option>
                <option value="30">30 derniers jours</option>
                <option value="90">3 derniers mois</option>
                <option value="365">12 derniers mois</option>
              </select>
              <select aria-label="Source" className="select text-xs w-auto" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
                <option value="">Toutes les sources</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {(filterSource || filterPeriod) && (
                <button onClick={() => { setFilterSource(''); setFilterPeriod(''); }} className="btn-ghost btn-sm text-xs text-gray-500">Réinitialiser</button>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="cursor-pointer" onClick={() => navigate(moreLink('/leads'))}>
                <KpiCard title="Leads actifs" value={stats.active} icon={<Users className="w-5 h-5" />} color="text-primary-600" />
              </div>
              <div className="cursor-pointer" onClick={() => navigate(moreLink('/leads', { status: 'signe' }))}>
                <KpiCard title="Signés" value={stats.signed} icon={<CheckCircle2 className="w-5 h-5" />} color="text-success-600" />
              </div>
              <div className="cursor-pointer" onClick={() => navigate(moreLink('/leads', { alert: 'red' }))}>
                <KpiCard title="Urgences" value={stats.urgent} icon={<AlertTriangle className="w-5 h-5" />} color="text-danger-600" />
              </div>
              <div className="cursor-pointer" onClick={() => navigate(moreLink('/leads', { view: 'devis-en-cours' }))}>
                <KpiCard title="Volume devis" value={formatCurrency(stats.totalQuotes)} icon={<FileText className="w-5 h-5" />} color="text-purple-600" />
              </div>
              <div className="cursor-pointer" onClick={() => navigate(moreLink('/clients'))}>
                <KpiCard title="Volume signé" value={formatCurrency(stats.totalSigned)} icon={<DollarSign className="w-5 h-5" />} color="text-success-600" />
              </div>
              <div className="cursor-pointer" onClick={() => navigate(moreLink('/leads', { view: 'inactifs' }))}>
                <KpiCard title="Sans action >7j" value={stats.noRecentAction} icon={<Clock className="w-5 h-5" />} color="text-warning-600" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LeadList
                title="Leads chauds sans action"
                icon={<Flame className="w-3.5 h-3.5 text-danger-500" />}
                leads={stats.hotLeads}
                empty="Tous couverts"
                right={lead => (<>
                  <span className="font-medium text-gray-900 truncate flex-1">{getLeadFullName(lead)}</span>
                  <StatusBadge status={lead.status} />
                </>)}
              />
              <LeadList
                title="Sans prochaine action"
                icon={<CalendarOff className="w-3.5 h-3.5 text-gray-500" />}
                leads={stats.sansProchAction}
                empty="Tous planifiés"
                right={lead => (<>
                  <span className="font-medium text-gray-900 truncate flex-1">{getLeadFullName(lead)}</span>
                  <StatusBadge status={lead.status} />
                </>)}
              />
            </div>

            <Suspense
              fallback={
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ChartSkeleton height={288} />
                  <ChartSkeleton height={288} />
                </div>
              }
            >
              <ChartsRow byStatus={stats.byStatus} byCommercial={stats.byCommercial} />
            </Suspense>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Suspense fallback={<ChartSkeleton height={288} />}>
                <SourceChart bySource={stats.bySource} compact={compact} />
              </Suspense>

              <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900">Détail par commercial</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2.5 text-left font-medium text-gray-600">Commercial</th>
                      <th className="px-4 py-2.5 text-right font-medium text-gray-600">Actifs</th>
                      <th className="px-4 py-2.5 text-right font-medium text-gray-600">Signés</th>
                      <th className="px-4 py-2.5 text-right font-medium text-gray-600">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byCommercial.map(c => (
                      <tr key={c.id || c.name} tabIndex={0} className="border-b border-gray-100 cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/performance?commercial=${c.id}`)} onKeyDown={activateOnKey(() => navigate(`/performance?commercial=${c.id}`))}>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{c.name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{c.actifs}</td>
                        <td className="px-4 py-2.5 text-right text-success-600 font-medium">{c.signes}</td>
                        <td className="px-4 py-2.5 text-right text-gray-900 font-semibold">{formatCurrency(c.montant)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Repliable>
    </div>
  );
}
