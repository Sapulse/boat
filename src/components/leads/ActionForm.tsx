import { useState } from 'react';
import type { LeadAction, ActionType, LeadStatus } from '../../data/types';
import { ACTION_TYPES, LEAD_STATUSES } from '../../data/constants';
import { useApp } from '../../context/useApp';
import { toISODate } from '../../lib/utils';
import { useSubmitLock } from '../../hooks/useSubmitLock';

interface ActionFormProps {
  leadId: string;
  onSave: (action: Omit<LeadAction, 'id'>) => void;
  onCancel: () => void;
  // Si fournie -> mode edition : le formulaire est pre-rempli et le bloc
  // "Changer statut / Prochaine action" (declencheurs d'effets de bord propres a
  // l'ajout) est masque. On n'edite que les champs de l'action elle-meme.
  action?: LeadAction;
}

export default function ActionForm({ leadId, onSave, onCancel, action }: ActionFormProps) {
  const { state } = useApp();
  const isEdit = !!action;
  const [form, setForm] = useState({
    type: action?.type ?? 'appel' as ActionType,
    date: action?.date ?? toISODate(new Date()),
    result: action?.result ?? '',
    notes: action?.notes ?? '',
    authorId: action?.authorId ?? state.commercials[0]?.id ?? '',
    newStatus: (action?.newStatus ?? '') as LeadStatus | '',
    nextActionType: (action?.nextActionType ?? '') as ActionType | '',
    nextActionDate: action?.nextActionDate ?? '',
  });

  // Verrou anti-double-soumission (correctif #2) : pas de double action créée.
  const { locked, guard } = useSubmitLock();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    guard(() => onSave({
      leadId,
      type: form.type,
      date: form.date,
      result: form.result,
      notes: form.notes,
      authorId: form.authorId,
      newStatus: form.newStatus || undefined,
      nextActionType: form.nextActionType || undefined,
      nextActionDate: form.nextActionDate || undefined,
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Type d'action *</label>
          <select className="select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ActionType }))} required>
            {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date *</label>
          <input className="input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
        </div>
      </div>

      <div>
        <label className="label">Auteur</label>
        <select className="select" value={form.authorId} onChange={e => setForm(f => ({ ...f, authorId: e.target.value }))}>
          {state.commercials.filter(c => c.active).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Résultat</label>
        <input className="input" value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value }))} placeholder="Ex: Intéressé, À rappeler..." />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[60px]" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>

      {!isEdit && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 bg-gray-50 rounded-lg">
          <div>
            <label className="label">Changer statut</label>
            <select className="select" value={form.newStatus} onChange={e => setForm(f => ({ ...f, newStatus: e.target.value as LeadStatus }))}>
              <option value="">Ne pas changer</option>
              {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Prochaine action</label>
            <select className="select" value={form.nextActionType} onChange={e => setForm(f => ({ ...f, nextActionType: e.target.value as ActionType }))}>
              <option value="">--</option>
              {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date prochaine action</label>
            <input className="input" type="date" value={form.nextActionDate} onChange={e => setForm(f => ({ ...f, nextActionDate: e.target.value }))} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>
        <button type="submit" className="btn-primary btn-sm" disabled={locked}>{isEdit ? 'Enregistrer' : "Ajouter l'action"}</button>
      </div>
    </form>
  );
}
