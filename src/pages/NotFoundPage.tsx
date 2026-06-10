import { Link } from 'react-router-dom';
import { Compass, LayoutDashboard } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="w-12 h-12" />}
      title="Page introuvable"
      description="Cette page n'existe pas ou plus. Utilisez le menu de gauche ou revenez au tableau de bord."
      action={
        <Link to="/" className="btn-primary btn-sm">
          <LayoutDashboard className="w-4 h-4" /> Retour au tableau de bord
        </Link>
      }
    />
  );
}
