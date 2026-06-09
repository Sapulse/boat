import { Menu, Plus, Bell } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { getAlertLevel, getLeadFullName } from '../../lib/utils';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/leads': 'Leads / Prospects',
  '/clients': 'Clients',
  '/pipeline': 'Pipeline',
  '/relances': 'À relancer',
  '/performance': 'Performance',
  '/acquisition': 'Acquisition',
  '/equipe': 'Equipe',
  '/templates': "Modèles d'email",
  '/exports': 'Exports',
};

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useApp();

  const segments = location.pathname.split('/').filter(Boolean);
  let title = titles['/' + (segments[0] || '')] || 'CRM Nautisme';
  // Sur la fiche lead (/leads/:id), afficher le nom du lead plutot que le titre
  // generique de la section.
  if (segments[0] === 'leads' && segments[1]) {
    if (segments[1] === 'new') {
      title = 'Nouveau lead';
    } else {
      const lead = state.leads.find(l => l.id === segments[1]);
      title = lead ? getLeadFullName(lead) : 'Fiche lead';
    }
  }

  const urgentCount = state.leads.filter(l => getAlertLevel(l) === 'red').length;

  return (
    <header className="h-16 border-b border-gray-200 bg-white flex items-center px-4 lg:px-6 gap-4 shrink-0">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100"
      >
        <Menu className="w-5 h-5" />
      </button>

      <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>

      <div className="ml-auto flex items-center gap-3">
        {urgentCount > 0 && (
          <button
            onClick={() => navigate('/leads?alert=red')}
            className="relative p-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100"
            title={`Voir les ${urgentCount} lead${urgentCount > 1 ? 's' : ''} urgent${urgentCount > 1 ? 's' : ''}`}
          >
            <Bell className="w-5 h-5" />
            <span className="absolute -top-0.5 -right-0.5 bg-danger-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
              {urgentCount}
            </span>
          </button>
        )}
        <button
          onClick={() => navigate('/leads/new')}
          className="btn-primary btn-sm"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Nouveau lead</span>
        </button>
      </div>
    </header>
  );
}
