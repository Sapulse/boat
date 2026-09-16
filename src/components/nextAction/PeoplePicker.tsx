import type { Commercial, PlannedActionPerson, PlannedActionRole } from '../../data/types';
import { cn } from '../../lib/utils';

/**
 * « Qui s'en occupe ? » : un rôle par commercial éligible (—, Responsable,
 * Participant). Partagé par la fenêtre Prochaine action et la création sur la
 * grille de l'agenda. `eligible` = eligibleCommercials() (« Non attribué » exclu).
 */
export default function PeoplePicker({ eligible, people, onChange, warning }: {
  eligible: Commercial[];
  people: PlannedActionPerson[];
  onChange: (people: PlannedActionPerson[]) => void;
  warning?: string;
}) {
  const roleOf = (id: string) => people.find(p => p.commercialId === id)?.role ?? null;
  const setRole = (id: string, role: PlannedActionRole | null) => {
    const others = people.filter(p => p.commercialId !== id);
    onChange(role ? [...others, { commercialId: id, role }] : others);
  };

  return (
    <fieldset>
      <legend className="label">Qui s'en occupe ? *</legend>
      {warning && <p className="text-xs text-amber-700 mb-2">{warning}</p>}
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {eligible.map(c => {
          const role = roleOf(c.id);
          return (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm text-gray-800">{c.name}</span>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5" role="radiogroup" aria-label={`Rôle de ${c.name}`}>
                {([[null, '—'], ['responsable', 'Responsable'], ['participant', 'Participant']] as const).map(([r, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    onClick={() => setRole(c.id, r)}
                    className={cn('px-2.5 py-1 text-xs rounded-md', role === r ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
