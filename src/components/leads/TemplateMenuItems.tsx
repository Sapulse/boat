import type { MessageTemplate } from '../../data/types';
import type { TemplateGroup } from '../../lib/templateLayout';

/**
 * Lot 3 — modèles d'un menu Email / SMS / WhatsApp de la fiche, GROUPÉS par
 * catégorie dans l'ordre de la page Modèles (lib/templateLayout.groupTemplates,
 * catégories vides pour ce canal masquées). Un seul groupe « Non classés » :
 * pas d'en-tête de catégorie, juste « Modèle pré-rempli » comme avant.
 */
export default function TemplateMenuItems({ groups, onPick }: { groups: TemplateGroup[]; onPick: (t: MessageTemplate) => void }) {
  if (groups.length === 0) return null;
  const flat = groups.length === 1 && groups[0].virtual;
  return (
    <>
      {flat && <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">Modèle pré-rempli</p>}
      {groups.map(g => (
        <div key={g.id || 'non-classes'} role="group" aria-label={g.name}>
          {!flat && <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400">{g.name}</p>}
          {g.templates.map(t => (
            <button key={t.id} onClick={() => onPick(t)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              {t.title}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
