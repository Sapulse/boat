import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Kanban,
  CalendarClock,
  BarChart3,
  Megaphone,
  UsersRound,
  Mail,
  Download,
  Anchor,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Leads / Prospects', href: '/leads', icon: Users },
  { name: 'Clients', href: '/clients', icon: UserCheck },
  { name: 'Pipeline', href: '/pipeline', icon: Kanban },
  { name: 'A relancer', href: '/relances', icon: CalendarClock },
  { name: 'Performance', href: '/performance', icon: BarChart3 },
  { name: 'Acquisition', href: '/acquisition', icon: Megaphone },
  { name: 'Equipe', href: '/equipe', icon: UsersRound },
  { name: 'Modeles email', href: '/templates', icon: Mail },
  { name: 'Exports', href: '/exports', icon: Download },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
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
          'fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-white flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-6 h-16 border-b border-white/10">
          <Anchor className="w-7 h-7 text-sea-400" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">CRM Nautisme</h1>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden ml-auto p-1 hover:bg-sidebar-hover rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map(item => (
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
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-xs text-gray-400">Pilotage Commercial</p>
          <p className="text-xs text-gray-500 mt-1">v2.0 - Nautisme</p>
        </div>
      </aside>
    </>
  );
}
