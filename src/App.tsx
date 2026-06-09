import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import AppLayout from './components/layout/AppLayout';
import DashboardPage from './pages/DashboardPage';
import LeadsPage from './pages/LeadsPage';
import LeadDetailPage from './pages/LeadDetailPage';
import NewLeadPage from './pages/NewLeadPage';
import ClientsPage from './pages/ClientsPage';
import PipelinePage from './pages/PipelinePage';
import PerformancePage from './pages/PerformancePage';
import AcquisitionPage from './pages/AcquisitionPage';
import EquipePage from './pages/EquipePage';
import ExportsPage from './pages/ExportsPage';
import TemplatesPage from './pages/TemplatesPage';
import RelancesPage from './pages/RelancesPage';

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
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/acquisition" element={<AcquisitionPage />} />
            <Route path="/equipe" element={<EquipePage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/exports" element={<ExportsPage />} />
          </Route>
        </Routes>
      </AppProvider>
    </HashRouter>
  );
}
