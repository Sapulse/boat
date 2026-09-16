import { useState } from 'react';
import type { Lead } from '../../data/types';
import { isValidCallNote } from '../../lib/plannedActions';
import { getLeadFullName } from '../../lib/utils';
import DialogShell from './DialogShell';

/**
 * « Fait » depuis l'agenda pour un RDV, une visite, un devis, « Autre »… :
 * compte rendu OBLIGATOIRE (2 mots, 10 caractères), puis ligne réalisée dans
 * l'historique, action grisée et fenêtre Prochaine action.
 * « Annuler » -> rien n'est enregistré, l'action reste à faire.
 */
export default function DoneReportDialog({ lead, label, onSave, onCancel }: {
  lead: Lead;
  label: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const valid = isValidCallNote(note);

  return (
    <DialogShell
      size="sm"
      title={`${label} fait — ${getLeadFullName(lead)}`}
      subtitle="Comment ça s'est passé ?"
      closable={false}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm w-full sm:w-auto">Annuler</button>
          <button type="button" onClick={() => { setTried(true); if (valid) onSave(note.trim()); }} className="btn-primary btn-sm w-full sm:w-auto">
            Enregistrer
          </button>
        </div>
      )}
    >
      <div>
        <label className="label" htmlFor="done-report">Compte rendu *</label>
        <textarea
          id="done-report"
          className="input min-h-[90px]"
          maxLength={1000}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Ex. essai du Flyer 6 concluant, attend le devis avec remorque"
        />
        <p className={tried && !valid ? 'text-xs text-danger-600 mt-1' : 'text-xs text-gray-500 mt-1'}>
          Quelques mots au minimum (2 mots, 10 caractères).
        </p>
      </div>
    </DialogShell>
  );
}
