import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Volet REPLIABLE (patron de 7d6ac45, extrait pour être réutilisé) : un en-tête
 * toujours visible avec un bouton chevron `aria-expanded`, le contenu en rendu
 * conditionnel. Pas de <details>/<summary> : l'en-tête peut porter d'autres
 * boutons ou champs, qu'on ne peut pas imbriquer dans un <summary>.
 * L'état ouvert/fermé est tenu par le parent (plusieurs volets ouverts à la fois).
 */
export default function Repliable({ open, onToggle, label, title, aside, children, className, headerClassName }: {
  open: boolean;
  onToggle: () => void;
  /** Nom accessible du volet (« Déplier la catégorie Devis »). */
  label: string;
  /** Contenu cliquable à côté du chevron (titre, compteur). */
  title: ReactNode;
  /** Contrôles à droite de l'en-tête (non cliquables pour replier). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  return (
    <div className={className}>
      <div className={cn('flex items-center gap-2', headerClassName)}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Replier' : 'Déplier'} ${label}`}
          className="flex items-center gap-2 min-w-0 flex-1 text-left py-1"
        >
          {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
          <span className="min-w-0 flex-1">{title}</span>
        </button>
        {aside}
      </div>
      {open && children}
    </div>
  );
}
