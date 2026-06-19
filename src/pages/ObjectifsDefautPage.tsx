import { useState } from 'react';
import { Save } from 'lucide-react';
import { useApp } from '../context/useApp';
import { METRICS, type MetricKey } from '../components/objectifs/metricsConfig';
import type { DefaultGoal } from '../data/types';

const INPUT_CLS =
  'w-full text-right border border-gray-200 rounded px-2 py-1.5 text-sm ' +
  'focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none';

export default function ObjectifsDefautPage() {
  const { state, saveDefaultGoal } = useApp();
  const [draft, setDraft] = useState<DefaultGoal>(state.defaultGoal);
  const [dirty, setDirty] = useState(false);

  const value = (key: MetricKey): string => {
    const v = draft[key];
    return v !== null && v !== undefined ? String(v) : '';
  };
  const update = (key: MetricKey, raw: string) => {
    setDirty(true);
    const num = raw === '' ? null : Number(raw);
    setDraft((prev) => ({ ...prev, [key]: num }));
  };
  const handleSave = () => {
    saveDefaultGoal(draft);
    setDirty(false);
  };

  return (
    <div className="space-y-6">
      {/* Titre + enregistrer */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Objectifs par défaut</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cibles communes à toute l&apos;équipe, reconduites chaque mois pour chaque commercial.
            Une cible saisie sur la page Objectifs (un commercial, un mois) prime sur le défaut.
          </p>
        </div>
        <button
          onClick={handleSave}
          className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`}
          disabled={!dirty}
        >
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>

      {/* Une colonne de cibles par indicateur */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Cible par défaut — par indicateur</h3>
          <p className="text-xs text-gray-400 mt-1">
            Laissez vide pour « pas d&apos;objectif par défaut » sur cet indicateur.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Indicateur</th>
              <th className="px-4 py-2.5 text-right font-medium text-gray-600 w-52">Cible par défaut</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-gray-700">{m.label}</div>
                  <div className="text-[11px] text-gray-400">{m.hint}</div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    <input
                      className={INPUT_CLS}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={value(m.key)}
                      onChange={(e) => update(m.key, e.target.value)}
                      placeholder="—"
                    />
                    {m.unit && <span className="text-gray-400 text-xs w-3">{m.unit}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
