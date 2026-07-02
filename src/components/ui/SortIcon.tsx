import { ChevronUp, ChevronDown } from 'lucide-react';

// Indicateur de tri de colonne, PARTAGÉ par les listes triables (Leads, Clients…).
// `field` typé `string` pour rester réutilisable quel que soit le jeu de colonnes
// de la page. Colonne inactive -> chevron gris ; active -> sens du tri.

export type SortDir = 'asc' | 'desc';

export function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronDown className="w-3 h-3 text-gray-300" />;
  return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}
