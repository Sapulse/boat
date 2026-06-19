import type { ReactNode } from 'react';
import type { Commercial } from '../../data/types';
import { getCommercialColor } from '../../lib/agenda';
import { MONTHS } from '../../data/constants';

// Initiales pour la pastille du commercial ("Fred" -> "FR", "Jean Dupont" -> "JD").
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * En-tête commercial PARTAGÉ (Objectifs, Espace commercial) : pastille couleur +
 * initiales + nom en gros + période « Mois Année ». Présentationnel uniquement —
 * `children` = le slot de droite (sélecteur de commercial, avec la garde
 * éventuelle gérée par l'appelant). La couleur est déterministe par position dans
 * `commercials` (getCommercialColor).
 */
export default function CommercialHeader({
  commercialId,
  commercials,
  month,
  year,
  children,
}: {
  commercialId: string;
  commercials: Commercial[];
  month: number;
  year: number;
  children?: ReactNode;
}) {
  const color = getCommercialColor(commercialId, commercials);
  const name = commercials.find((c) => c.id === commercialId)?.name ?? '';
  return (
    <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${color.bg} ${color.text}`}
        >
          {initials(name)}
        </div>
        <div>
          <div className="text-xl font-bold text-gray-900">{name}</div>
          <div className="text-sm text-gray-500">
            {MONTHS[month - 1]} {year}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
