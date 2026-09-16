import { useState } from 'react';
import type { Lead } from '../../data/types';
import { CALL_RESULTS, validateCallEntry, type CallResult } from '../../lib/plannedActions';
import { getLeadFullName } from '../../lib/utils';
import DialogShell from './DialogShell';

/**
 * Appel (lot 2, décision F) : résultat OBLIGATOIRE (aucune puce par défaut) ;
 * note récapitulative obligatoire pour « Joint » et « Rappel demandé »,
 * facultative sinon (2 mots, 10 caractères quand elle est exigée).
 * Enregistrer -> action « appel » réalisée dans l'historique, puis fenêtre Prochaine action.
 * « Appel non passé » -> rien n'est enregistré.
 */
export default function CallNoteDialog({ lead, onSave, onCancel }: {
  lead: Lead;
  onSave: (note: string, result: CallResult) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CallResult | null>(null);
  const [tried, setTried] = useState(false);
  const errors = validateCallEntry(result, note);
  const noteRequired = CALL_RESULTS.find(r => r.value === result)?.noteRequired ?? true;

  return (
    <DialogShell
      size="sm"
      title={`Appel — ${getLeadFullName(lead)}`}
      subtitle={lead.phone || undefined}
      closable={false}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm w-full sm:w-auto">Appel non passé</button>
          <button
            type="button"
            onClick={() => { setTried(true); if (result && errors.length === 0) onSave(note.trim(), result); }}
            className="btn-primary btn-sm w-full sm:w-auto"
          >
            Enregistrer l'appel
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <div>
          <p className="label" id="call-result-label">Résultat *</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="call-result-label">
            {CALL_RESULTS.map(r => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={result === r.value}
                onClick={() => setResult(r.value)}
                className={result === r.value ? 'px-3 py-1.5 rounded-full text-xs font-medium bg-primary-600 text-white' : 'px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600'}
              >
                {r.value}
              </button>
            ))}
          </div>
          {tried && !result && <p className="text-xs text-danger-600 mt-1">Choisissez le résultat de l'appel.</p>}
        </div>
        <div>
          <label className="label" htmlFor="call-note">Note récapitulative{noteRequired ? ' *' : ' (facultative)'}</label>
          <textarea
            id="call-note"
            className="input min-h-[90px]"
            maxLength={1000}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ex. intéressé par le Flyer 6, veut un devis avec remorque"
          />
          {noteRequired && (
            <p className={tried && result && errors.length > 0 ? 'text-xs text-danger-600 mt-1' : 'text-xs text-gray-500 mt-1'}>
              Quelques mots au minimum (2 mots, 10 caractères).
            </p>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
