import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Kanban,
  CalendarClock,
  CalendarDays,
  BarChart3,
  Megaphone,
  Target,
  CircleUser,
  UsersRound,
  Mail,
  Download,
  X,
  ChevronDown,
  ChevronRight,
  Crosshair,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import logo from '../../assets/logo.png';

type NavItem = { name: string; href: string; icon: LucideIcon };
type NavSection = { id: string; label: string; defaultOpen: boolean; items: NavItem[] };

// Menu organisé en sections repliables. L'ordre des items reflète l'usage par rôle.
const sections: NavSection[] = [
  {
    id: 'pilotage',
    label: 'Pilotage',
    defaultOpen: true,
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Performance', href: '/performance', icon: BarChart3 },
      { name: 'Objectifs', href: '/objectifs', icon: Target },
      { name: 'Acquisition', href: '/acquisition', icon: Megaphone },
    ],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    defaultOpen: true,
    items: [
      { name: 'Espace commercial', href: '/espace-commercial', icon: CircleUser },
      { name: 'Leads / Prospects', href: '/leads', icon: Users },
      { name: 'Clients', href: '/clients', icon: UserCheck },
      { name: 'Pipeline', href: '/pipeline', icon: Kanban },
      { name: 'À relancer', href: '/relances', icon: CalendarClock },
      { name: 'Agenda', href: '/agenda', icon: CalendarDays },
    ],
  },
  {
    id: 'parametres',
    label: 'Paramètres',
    defaultOpen: false,
    items: [
      { name: 'Objectifs par défaut', href: '/objectifs-defaut', icon: Crosshair },
      { name: 'Équipe', href: '/equipe', icon: UsersRound },
      { name: 'Modèles', href: '/templates', icon: Mail },
      { name: 'Import / Export', href: '/exports', icon: Download },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  // Repli/déplié par SESSION (pas de persistance) : repart du défaut au chargement.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.id, s.defaultOpen]))
  );
  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const renderItem = (item: NavItem) => (
    <NavLink
      key={item.href}
      to={item.href}
      onClick={onClose}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-active text-white'
            : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
        )
      }
    >
      <item.icon className="w-5 h-5 shrink-0" />
      {item.name}
    </NavLink>
  );

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-white flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto print:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="relative flex items-center justify-center px-4 h-20 border-b border-white/10">
          <img src={logo} alt="Brest Ocean Boat" className="w-[200px] max-h-12 object-contain" />
          <button
            onClick={onClose}
            className="lg:hidden absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-sidebar-hover rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
          {sections.map((section) => {
            const isOpen = openSections[section.id];
            return (
              <div key={section.id}>
                <button
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {section.label}
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                {isOpen && <div className="space-y-1 mt-1">{section.items.map(renderItem)}</div>}
              </div>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-xs text-gray-400">Pilotage Commercial</p>
          <p className="text-xs text-gray-500 mt-1">v{__APP_VERSION__} — Brest Ocean Boat</p>
        </div>
      </aside>
    </>
  );
}
