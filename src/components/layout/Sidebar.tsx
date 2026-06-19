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
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import logo from '../../assets/logo.png';

type NavItem = { name: string; href: string; icon: LucideIcon };

const mainNav: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Leads / Prospects', href: '/leads', icon: Users },
  { name: 'Clients', href: '/clients', icon: UserCheck },
  { name: 'Pipeline', href: '/pipeline', icon: Kanban },
  { name: 'À relancer', href: '/relances', icon: CalendarClock },
  { name: 'Agenda', href: '/agenda', icon: CalendarDays },
  { name: 'Performance', href: '/performance', icon: BarChart3 },
  { name: 'Acquisition', href: '/acquisition', icon: Megaphone },
  { name: 'Objectifs', href: '/objectifs', icon: Target },
  { name: 'Espace commercial', href: '/espace-commercial', icon: CircleUser },
];

const settingsNav: NavItem[] = [
  { name: 'Équipe', href: '/equipe', icon: UsersRound },
  { name: 'Modèles', href: '/templates', icon: Mail },
  { name: 'Exports', href: '/exports', icon: Download },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
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

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {mainNav.map(renderItem)}

          <div className="pt-4 mt-2 border-t border-white/10">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Paramètres
            </p>
            <div className="space-y-1">
              {settingsNav.map(renderItem)}
            </div>
          </div>
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-xs text-gray-400">Pilotage Commercial</p>
          <p className="text-xs text-gray-500 mt-1">v{__APP_VERSION__} — Brest Ocean Boat</p>
        </div>
      </aside>
    </>
  );
}
