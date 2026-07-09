import { Download, Check, Users, UserCheck, BarChart3, Megaphone } from 'lucide-react';
import { useApp } from '../context/useApp';
import { formatDate, formatCurrency } from '../lib/utils';
import { computeCpl } from '../lib/acquisition';
import { exportCSV } from '../lib/csv';
import { useExportFeedback } from '../lib/useExportFeedback';
import { ACTIVE_STATUSES, MONTHS } from '../data/constants';
import ImportPanel from '../components/import/ImportPanel';
import type { ReactNode } from 'react';

interface ExportCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  onExport: () => void;
  count?: number;
  countLabel?: string;
}

function ExportCard({ icon, title, description, onExport, count, countLabel }: ExportCardProps) {
  const { done, trigger } = useExportFeedback(onExport);
  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary-50 text-primary-600 shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500 mt-1">{description}</p>
          {count !== undefined && countLabel && (
            <p className="text-xs text-primary-600 font-medium mt-2">
              {count} {countLabel}
            </p>
          )}
        </div>
      </div>
      <button onClick={trigger} disabled={done} className="btn-primary btn-sm w-full justify-center disabled:opacity-70">
        {done ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        {done ? 'Exporté ✓' : 'Exporter CSV'}
      </button>
    </div>
  );
}

export default function ExportsPage() {
  const { state, getCommercialName } = useApp();

  const exportProspects = () => {
    const leads = state.leads.filter(l => ACTIVE_STATUSES.includes(l.status));
    const headers = [
      'Nom', 'Prénom', 'Téléphone', 'Email', 'Commercial',
      'Statut', 'Source', 'Bateau', 'Marque', 'Type', 'État',
      'Budget', 'Température', 'Prochaine action', 'Date prochaine action',
      'Dernière action', 'Date création',
    ];
    const rows = leads.map(l => [
      l.lastName,
      l.firstName,
      l.phone,
      l.email,
      getCommercialName(l.commercialId),
      l.status,
      l.source,
      l.boatInterest,
      l.brand,
      l.boatType,
      l.boatCondition,
      l.budget !== null ? String(l.budget) : '',
      l.temperature,
      l.nextActionType,
      formatDate(l.nextActionDate),
      formatDate(l.lastActionDate),
      formatDate(l.createdAt),
    ]);
    exportCSV('prospects.csv', headers, rows);
  };

  const exportClients = () => {
    const leads = state.leads.filter(l => l.status === 'signe');
    const headers = [
      'Nom', 'Prénom', 'Téléphone', 'Email', 'Commercial',
      'Bateau', 'Marque', 'Type', 'Source',
      'Montant signé', 'Date signature', 'Date livraison',
    ];
    const rows = leads.map(l => [
      l.lastName,
      l.firstName,
      l.phone,
      l.email,
      getCommercialName(l.commercialId),
      l.boatInterest,
      l.brand,
      l.boatType,
      l.source,
      l.quoteAmount !== null ? String(l.quoteAmount) : l.budget !== null ? String(l.budget) : '',
      formatDate(l.signedAt),
      formatDate(l.deliveryDate),
    ]);
    exportCSV('clients.csv', headers, rows);
  };

  const exportPerformance = () => {
    const headers = [
      'Commercial', 'Leads actifs', 'Signés', 'Perdus', 'Reportés',
      'Total leads', 'Montant signé',
    ];
    const rows = state.commercials.map(c => {
      const leads = state.leads.filter(l => l.commercialId === c.id);
      const actifs = leads.filter(l => ACTIVE_STATUSES.includes(l.status)).length;
      const signes = leads.filter(l => l.status === 'signe');
      const perdus = leads.filter(l => l.status === 'perdu').length;
      const reportes = leads.filter(l => l.status === 'reporte').length;
      const montant = signes.reduce((s, l) => s + (l.quoteAmount ?? l.budget ?? 0), 0);
      return [
        c.name,
        String(actifs),
        String(signes.length),
        String(perdus),
        String(reportes),
        String(leads.length),
        formatCurrency(montant),
      ];
    });
    exportCSV('performance.csv', headers, rows);
  };

  const exportAcquisition = () => {
    const headers = ['Source', 'Mois', 'Année', 'Leads', 'Budget (EUR)', 'CPL (EUR)'];
    // Toutes les sources (regies + plateformes) : monthlyStats les contient toutes
    // depuis la fusion. CPL DERIVE (computeCpl) -> null/vide pour les plateformes.
    const rows = state.monthlyStats.map(s => {
      const cpl = computeCpl(s.budget, s.leads);
      return [
        s.source,
        MONTHS[s.month - 1] ?? String(s.month),
        String(s.year),
        s.leads !== null ? String(s.leads) : '',
        s.budget !== null ? String(s.budget) : '',
        cpl !== null ? String(cpl) : '',
      ];
    });
    exportCSV('acquisition.csv', headers, rows);
  };

  const activeCount = state.leads.filter(l => ACTIVE_STATUSES.includes(l.status)).length;
  const clientCount = state.leads.filter(l => l.status === 'signe').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Import / Export</h1>
        <p className="text-sm text-gray-500 mt-1">
          Importez des leads depuis un fichier CSV, ou téléchargez vos données (UTF-8, séparateur point-virgule).
        </p>
      </div>

      <ImportPanel />

      <div>
        <h2 className="text-sm font-semibold text-gray-900">Exports</h2>
        <p className="text-xs text-gray-500 mt-0.5">Téléchargez vos données au format CSV.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ExportCard
          icon={<Users className="w-5 h-5" />}
          title="Prospects"
          description="Tous les leads actifs en cours de traitement avec leurs informations et statut."
          onExport={exportProspects}
          count={activeCount}
          countLabel="prospects actifs"
        />
        <ExportCard
          icon={<UserCheck className="w-5 h-5" />}
          title="Clients"
          description="Les leads signés avec les montants, dates de signature et de livraison."
          onExport={exportClients}
          count={clientCount}
          countLabel="clients signés"
        />
        <ExportCard
          icon={<BarChart3 className="w-5 h-5" />}
          title="Performance"
          description="Statistiques par commercial : leads actifs, signés, perdus et montants."
          onExport={exportPerformance}
          count={state.commercials.length}
          countLabel="commerciaux"
        />
        <ExportCard
          icon={<Megaphone className="w-5 h-5" />}
          title="Acquisition"
          description="Données mensuelles par source marketing : budget, leads et coût par lead."
          onExport={exportAcquisition}
          count={state.monthlyStats.length}
          countLabel="entrées"
        />
      </div>
    </div>
  );
}
