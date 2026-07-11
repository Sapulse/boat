import { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useScrollRestoration } from '../../hooks/useScrollRestoration';

// Fallback du chargement paresseux d'une page (code-splitting par route) : la
// coquille (sidebar + header) reste affichee, seule la zone de contenu attend.
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-gray-400" role="status" aria-live="polite">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-hidden="true" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // A2 : le scroll de l'app vit dans <main> — reset en haut sur route jamais
  // visitée, position restaurée quand on y revient (retour liste).
  const mainRef = useScrollRestoration<HTMLElement>();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 print:h-auto print:overflow-visible print:block">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden print:overflow-visible print:block">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 lg:p-6 print:overflow-visible print:p-0">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
