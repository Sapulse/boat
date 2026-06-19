import { useState } from 'react';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useApp } from '../context/useApp';
import { buildYearRange } from '../lib/utils';
import { MONTHS } from '../data/constants';
import CommercialHeader from '../components/commercial/CommercialHeader';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = buildYearRange();

// Placeholder de bloc (étapes 2-3 : Objectifs / Performances / Pipeline / Agenda).
function BlockPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-400 mt-2">{note}</p>
    </div>
  );
}

export default function EspaceCommercialPage() {
  const { state } = useApp();
  const now = new Date();
  const activeCommercials = state.commercials.filter((c) => c.active);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [commercialId, setCommercialId] = useState(activeCommercials[0]?.id ?? '');

  const goPrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Titre de page */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Espace commercial</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Synthèse par commercial : objectifs, performances, pipeline et agenda — regroupés en
          une vue. Lecture seule (la saisie reste sur chaque page dédiée).
        </p>
      </div>

      {/* Bandeau mono-poste (démonstration) */}
      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>Démonstration — données du poste ; vue par rôle réelle au backend.</span>
      </div>

      {activeCommercials.length === 0 ? (
        <div className="card p-6 text-sm text-gray-500">
          Aucun commercial actif. Ajoutez-en dans « Équipe » pour ouvrir un espace commercial.
        </div>
      ) : (
        <>
          {/* En-tête commercial (composant partagé) + sélecteur */}
          <CommercialHeader
            commercialId={commercialId}
            commercials={state.commercials}
            month={month}
            year={year}
          >
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                Commercial
              </label>
              <select
                className="select w-auto min-w-[160px]"
                value={commercialId}
                onChange={(e) => setCommercialId(e.target.value)}
                aria-label="Commercial"
              >
                {activeCommercials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </CommercialHeader>

          {/* Période + portée du sélecteur */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={goPrevMonth} className="btn-ghost btn-sm" aria-label="Mois précédent">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-base font-semibold text-gray-900 min-w-[150px] text-center">
              {MONTHS[month - 1]} {year}
            </div>
            <button onClick={goNextMonth} className="btn-ghost btn-sm" aria-label="Mois suivant">
              <ChevronRight className="w-4 h-4" />
            </button>
            <select
              className="select w-auto ml-2"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="Année"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-400 ml-2">
              Le mois pilote <strong className="font-medium">Objectifs</strong> &amp;{' '}
              <strong className="font-medium">Performances</strong> · Pipeline = état courant ·
              Agenda = à venir
            </span>
          </div>

          {/* Blocs de synthèse (remplis aux étapes 2-3) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BlockPlaceholder title="Objectifs" note="6 indicateurs du mois — à venir (étape 2)." />
            <BlockPlaceholder
              title="Performances"
              note="CA signé & taux de transformation du mois — à venir (étape 2)."
            />
            <BlockPlaceholder
              title="Pipeline"
              note="Leads par étape + chauds, état courant — à venir (étape 3)."
            />
            <BlockPlaceholder
              title="Agenda"
              note="Prochaines actions / RDV à venir — à venir (étape 3)."
            />
          </div>
        </>
      )}
    </div>
  );
}
