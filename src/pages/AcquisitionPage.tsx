import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { Save, DollarSign, Users, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApp } from '../context/useApp';
import PrintButton from '../components/print/PrintButton';
import PrintHeader from '../components/print/PrintHeader';
import { ACQUISITION_SOURCES_ALL, MONTHS } from '../data/constants';
import { formatCurrency, generateId, buildYearRange } from '../lib/utils';
import { computeCpl, acquisitionTotals, isPaidSource } from '../lib/acquisition';
import type { MonthlyStat } from '../data/types';

type Tab = 'saisie' | 'dashboard';

const CURRENT_YEAR = new Date().getFullYear();
// Plage DYNAMIQUE (annee courante +- amplitude, cf. buildYearRange / constants) :
// horizon glissant, plus aucune annee en dur, jamais de plafond de saisie future.
const YEAR_OPTIONS = buildYearRange();

// Champ de saisie numerique (budget / leads) — confortable, aligne a droite.
const ACQ_INPUT_CLS =
  'w-full text-right border border-gray-200 rounded px-2 py-1.5 text-sm ' +
  'focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none';

// Petite carte de total / KPI (budget / leads / CPL).
function TotalCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: 'primary' | 'success' | 'warning';
}) {
  const toneCls =
    tone === 'primary'
      ? 'text-primary-600'
      : tone === 'success'
        ? 'text-success-600'
        : 'text-warning-600';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</p>
        </div>
        <div className={`p-2.5 rounded-lg bg-gray-50 ${toneCls}`}>{icon}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet — Saisie (mois selectionne, une ligne par source)
// ---------------------------------------------------------------------------

function SaisieTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { state, saveMonthlyStats } = useApp();
  const now = new Date();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [stats, setStats] = useState<MonthlyStat[]>(state.monthlyStats);
  const [dirty, setDirty] = useState(false);

  // Garde anti-perte (1) : on remonte l'etat "modifications non enregistrees" au
  // parent, qui confirme avant de quitter l'onglet Saisie.
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Garde anti-perte (3) : avertissement natif du navigateur a la fermeture /
  // rechargement de l'onglet, UNIQUEMENT si des modifications sont en attente.
  // Le listener est retire des que dirty repasse false ou au demontage.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Saisie centree sur le (mois, annee) selectionne -> plus de grille 12 mois.
  const findStat = (source: string) =>
    stats.find((s) => s.year === year && s.month === month && s.source === source);

  const fieldValue = (source: string, field: 'budget' | 'leads'): string => {
    const v = findStat(source)?.[field];
    return v !== null && v !== undefined ? String(v) : '';
  };

  const updateField = (source: string, field: 'budget' | 'leads', value: string) => {
    setDirty(true);
    const numVal = value === '' ? null : Number(value);
    setStats((prev) => {
      const idx = prev.findIndex(
        (s) => s.year === year && s.month === month && s.source === source
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], [field]: numVal };
        return updated;
      }
      const budget = field === 'budget' ? numVal : null;
      const leads = field === 'leads' ? numVal : null;
      return [...prev, { id: generateId(), year, month, source, budget, leads }];
    });
  };

  const goPrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const handleSave = () => {
    saveMonthlyStats(stats);
    setDirty(false);
  };

  // Totaux du mois affiche (logique PURE, cf. lib/acquisition + harnais).
  const totals = useMemo(() => {
    const rows = ACQUISITION_SOURCES_ALL.map((src) => {
      const st = stats.find(
        (s) => s.year === year && s.month === month && s.source === src.name
      );
      return {
        budget: st?.budget ?? null,
        leads: st?.leads ?? null,
        paid: src.category === 'regie',
      };
    });
    return acquisitionTotals(rows);
  }, [stats, year, month]);

  const regies = ACQUISITION_SOURCES_ALL.filter((s) => s.category === 'regie');
  const plateformes = ACQUISITION_SOURCES_ALL.filter((s) => s.category === 'plateforme');

  return (
    <div className="space-y-6">
      {/* Navigation mois + annee + enregistrer */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrevMonth} className="btn-ghost btn-sm" aria-label="Mois précédent">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-base font-semibold text-gray-900 min-w-[150px] text-center">
            {MONTHS[month - 1]} {year}
          </div>
          <button onClick={goNextMonth} className="btn-ghost btn-sm" aria-label="Mois suivant">
            <ChevronRight className="w-4 h-4" />
          </button>
          <select
            className="select w-auto ml-2"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Année"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`}
          disabled={!dirty}
        >
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>

      {/* Totaux du mois */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TotalCard
          label="Budget du mois"
          value={formatCurrency(totals.totalBudget)}
          icon={<DollarSign className="w-5 h-5" />}
          tone="primary"
        />
        <TotalCard
          label="Leads du mois"
          value={String(totals.totalLeads)}
          icon={<Users className="w-5 h-5" />}
          tone="success"
        />
        <TotalCard
          label="CPL moyen"
          value={totals.cpl !== null ? formatCurrency(totals.cpl) : '-'}
          icon={<TrendingDown className="w-5 h-5" />}
          tone="warning"
        />
      </div>

      {/* Grille de saisie : UNE ligne par source */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            Saisie — {MONTHS[month - 1]} {year}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Budget &amp; leads pour les régies (CPL calculé automatiquement), volume de leads
            pour les plateformes d&apos;annonces.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Source</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-44">Budget (€)</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-32">Leads</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-28">CPL</th>
            </tr>
          </thead>
          <tbody>
            {/* Régies payantes : budget + leads -> CPL */}
            <tr className="bg-gray-50/60">
              <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Régies payantes
              </td>
            </tr>
            {regies.map((src) => {
              const st = findStat(src.name);
              const cpl = computeCpl(st?.budget ?? null, st?.leads ?? null);
              return (
                <tr key={src.name} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-1.5 font-medium text-gray-700">{src.name}</td>
                  <td className="px-2 py-1">
                    <input
                      className={ACQ_INPUT_CLS}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={fieldValue(src.name, 'budget')}
                      onChange={(e) => updateField(src.name, 'budget', e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={ACQ_INPUT_CLS}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={fieldValue(src.name, 'leads')}
                      onChange={(e) => updateField(src.name, 'leads', e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-4 py-1.5 text-right font-medium">
                    {cpl !== null ? (
                      <span className="text-warning-600">{formatCurrency(cpl)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Plateformes d'annonces : volume de leads seul */}
            <tr className="bg-gray-50/60">
              <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Plateformes d&apos;annonces
              </td>
            </tr>
            {plateformes.map((src) => (
              <tr key={src.name} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-1.5 font-medium text-gray-700">{src.name}</td>
                <td className="px-4 py-1.5 text-right text-gray-300">—</td>
                <td className="px-2 py-1">
                  <input
                    className={ACQ_INPUT_CLS}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={fieldValue(src.name, 'leads')}
                    onChange={(e) => updateField(src.name, 'leads', e.target.value)}
                    placeholder="—"
                  />
                </td>
                <td className="px-4 py-1.5 text-right text-gray-300">—</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-gray-900">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{formatCurrency(totals.totalBudget)}</td>
              <td className="px-4 py-2 text-right">{totals.totalLeads}</td>
              <td className="px-4 py-2 text-right text-warning-700">
                {totals.cpl !== null ? formatCurrency(totals.cpl) : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet — Tableau de bord (toutes sources, CPL derive)
// ---------------------------------------------------------------------------

function DashboardTab() {
  const { state } = useApp();
  const [year, setYear] = useState(CURRENT_YEAR);
  const stats = state.monthlyStats;

  // Agrege mensuel (toutes sources) ; CPL derive sur leads PAYANTS.
  const chartData = useMemo(() => {
    return MONTHS.map((name, idx) => {
      const month = idx + 1;
      const rows = stats
        .filter((s) => s.year === year && s.month === month)
        .map((s) => ({ budget: s.budget, leads: s.leads, paid: isPaidSource(s.source) }));
      const t = acquisitionTotals(rows);
      return { name: name.slice(0, 4), budget: t.totalBudget, leads: t.totalLeads, cpl: t.cpl ?? 0 };
    });
  }, [stats, year]);

  // Recapitulatif par source : TOUTES (regies + plateformes).
  const sourceSummary = useMemo(() => {
    return ACQUISITION_SOURCES_ALL.map((src) => {
      const srcStats = stats.filter((s) => s.year === year && s.source === src.name);
      const budget = srcStats.reduce((s, st) => s + (st.budget ?? 0), 0);
      const leads = srcStats.reduce((s, st) => s + (st.leads ?? 0), 0);
      const cpl = src.category === 'regie' ? computeCpl(budget, leads) : null;
      return { source: src.name, category: src.category, budget, leads, cpl };
    });
  }, [stats, year]);

  // KPIs de l'annee (CPL = budget total / leads payants).
  const kpis = useMemo(() => {
    const rows = stats
      .filter((s) => s.year === year)
      .map((s) => ({ budget: s.budget, leads: s.leads, paid: isPaidSource(s.source) }));
    return acquisitionTotals(rows);
  }, [stats, year]);

  return (
    <div className="space-y-6">
      {/* Annee */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <select
          className="select w-auto"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Année"
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TotalCard
          label="Budget total"
          value={formatCurrency(kpis.totalBudget)}
          icon={<DollarSign className="w-5 h-5" />}
          tone="primary"
        />
        <TotalCard
          label="Total leads"
          value={String(kpis.totalLeads)}
          icon={<Users className="w-5 h-5" />}
          tone="success"
        />
        <TotalCard
          label="CPL moyen"
          value={kpis.cpl !== null ? formatCurrency(kpis.cpl) : '-'}
          icon={<TrendingDown className="w-5 h-5" />}
          tone="warning"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Budget &amp; Leads mensuels</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="budget" name="Budget (EUR)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="leads" name="Leads" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">CPL mensuel</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${v} EUR`, 'CPL']} />
              <Bar dataKey="cpl" name="CPL (EUR)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recapitulatif par source (toutes sources) */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Récapitulatif par source — {year}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Budget</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Leads</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">CPL</th>
              </tr>
            </thead>
            <tbody>
              {sourceSummary.map((s) => (
                <tr key={s.source} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{s.source}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {s.category === 'regie' ? 'Régie' : 'Plateforme'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    {s.budget > 0 ? formatCurrency(s.budget) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    {s.leads > 0 ? s.leads : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    {s.cpl !== null ? formatCurrency(s.cpl) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-gray-900">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 text-right">{formatCurrency(kpis.totalBudget)}</td>
                <td className="px-4 py-2.5 text-right">{kpis.totalLeads}</td>
                <td className="px-4 py-2.5 text-right text-warning-700">
                  {kpis.cpl !== null ? formatCurrency(kpis.cpl) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — 2 onglets : Saisie / Tableau de bord
// ---------------------------------------------------------------------------

const TABS: { id: Tab; label: string }[] = [
  { id: 'saisie', label: 'Saisie' },
  { id: 'dashboard', label: 'Tableau de bord' },
];

export default function AcquisitionPage() {
  const [activeTab, setActiveTab] = useState<Tab>('saisie');
  // Etat "modifications non enregistrees" de l'onglet Saisie, remonte par SaisieTab.
  const [saisieDirty, setSaisieDirty] = useState(false);

  const activeLabel = TABS.find((t) => t.id === activeTab)?.label ?? '';

  // Garde au changement d'onglet : si on quitte la Saisie avec des modifications
  // en attente, on confirme. Annuler -> on reste (rien perdu). Confirmer -> on
  // bascule et on abandonne les modifs en cours (comportement actuel assume).
  const handleTabChange = (id: Tab) => {
    if (id === activeTab) return;
    if (activeTab === 'saisie' && saisieDirty) {
      const ok = window.confirm(
        'Vous avez des modifications non enregistrées dans la saisie. Quitter sans enregistrer ?'
      );
      if (!ok) return;
      setSaisieDirty(false);
    }
    setActiveTab(id);
  };

  return (
    <div className="space-y-6">
      <PrintHeader title="Acquisition" subtitle={activeLabel} />

      {/* Page title */}
      <div className="flex items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Acquisition</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Suivi des budgets, CPL et volumes de leads par source
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 no-print">
        <nav className="-mb-px flex gap-1" aria-label="Onglets">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={[
                'px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors focus:outline-none',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 bg-primary-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'saisie' && <SaisieTab onDirtyChange={setSaisieDirty} />}
      {activeTab === 'dashboard' && <DashboardTab />}
    </div>
  );
}
