import { lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import AppLayout from './components/layout/AppLayout';

// Code-splitting par route (React.lazy) : chaque page part dans son propre chunk,
// charge a la demande. La coquille (AppProvider + AppLayout) reste dans le bundle
// initial ; le fallback de chargement vit dans AppLayout (autour de l'Outlet).
// Allege le 1er chargement (recharts, date-fns... ne partent que sur les pages
// qui les utilisent).
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const LeadsPage = lazy(() => import('./pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('./pages/LeadDetailPage'));
const NewLeadPage = lazy(() => import('./pages/NewLeadPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const PipelinePage = lazy(() => import('./pages/PipelinePage'));
const PerformancePage = lazy(() => import('./pages/PerformancePage'));
const AcquisitionPage = lazy(() => import('./pages/AcquisitionPage'));
const ObjectifsPage = lazy(() => import('./pages/ObjectifsPage'));
const ObjectifsDefautPage = lazy(() => import('./pages/ObjectifsDefautPage'));
const EspaceCommercialPage = lazy(() => import('./pages/EspaceCommercialPage'));
const EquipePage = lazy(() => import('./pages/EquipePage'));
const ExportsPage = lazy(() => import('./pages/ExportsPage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const RelancesPage = lazy(() => import('./pages/RelancesPage'));
const AgendaPage = lazy(() => import('./pages/AgendaPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/new" element={<NewLeadPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/relances" element={<RelancesPage />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/acquisition" element={<AcquisitionPage />} />
            <Route path="/objectifs" element={<ObjectifsPage />} />
            <Route path="/espace-commercial" element={<EspaceCommercialPage />} />
            <Route path="/objectifs-defaut" element={<ObjectifsDefautPage />} />
            <Route path="/equipe" element={<EquipePage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/exports" element={<ExportsPage />} />
            {/* Catch-all : URL hash inconnue -> 404 DANS le layout (sidebar et
                header restent disponibles). Les routes explicites ci-dessus
                gardent la priorite (matching par specificite). */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AppProvider>
    </HashRouter>
  );
}
