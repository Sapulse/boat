import { useState } from 'react';
import type { Lead } from '../../data/types';
import { isValidCallNote } from '../../lib/plannedActions';
import { getLeadFullName } from '../../lib/utils';
import DialogShell from './DialogShell';

const RESULTS = ['Joint', 'Messagerie', 'Pas de réponse', 'Rappel demandé'] as const;

/**
 * Note d'appel OBLIGATOIRE (lot 2, décision F) : au moins 2 mots et 10 caractères.
 * Enregistrer -> action « appel » dans l'historique, puis fenêtre Prochaine action.
 * « Appel non passé » -> rien n'est enregistré.
 */
export default function CallNoteDialog({ lead, onSave, onCancel }: {
  lead: Lead;
  onSave: (note: string, result: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [result, setResult] = useState<string>('Joint');
  const [tried, setTried] = useState(false);
  const valid = isValidCallNote(note);

  return (
    <DialogShell
      size="sm"
      title={`Appel — ${getLeadFullName(lead)}`}
      subtitle={lead.phone || undefined}
      closable={false}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm w-full sm:w-auto">Appel non passé</button>
          <button type="button" onClick={() => { setTried(true); if (valid) onSave(note.trim(), result); }} className="btn-primary btn-sm w-full sm:w-auto">
            Enregistrer l'appel
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Résultat de l'appel">
          {RESULTS.map(r => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={result === r}
              onClick={() => setResult(r)}
              className={result === r ? 'px-3 py-1 rounded-full text-xs font-medium bg-primary-600 text-white' : 'px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600'}
            >
              {r}
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="call-note">Note récapitulative *</label>
          <textarea
            id="call-note"
            className="input min-h-[90px]"
            maxLength={1000}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ex. intéressé par le Flyer 6, veut un devis avec remorque"
          />
          <p className={tried && !valid ? 'text-xs text-danger-600 mt-1' : 'text-xs text-gray-500 mt-1'}>
            Quelques mots au minimum (2 mots, 10 caractères).
          </p>
        </div>
      </div>
    </DialogShell>
  );
}
