import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import AppLayout from './components/layout/AppLayout';
import DashboardPage from './pages/DashboardPage';
import LeadsPage from './pages/LeadsPage';
import LeadDetailPage from './pages/LeadDetailPage';
import NewLeadPage from './pages/NewLeadPage';
import PipelinePage from './pages/PipelinePage';
import AnalytiquePage from './pages/AnalytiquePage';
import StatsPage from './pages/StatsPage';
import HistoriquePage from './pages/HistoriquePage';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/new" element={<NewLeadPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/analytique" element={<AnalytiquePage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/historique" element={<HistoriquePage />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
