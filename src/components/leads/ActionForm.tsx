import { useState } from 'react';
import type { LeadAction, ActionType, LeadStatus } from '../../data/types';
import { ACTION_TYPES, LEAD_STATUSES, LOSS_REASONS } from '../../data/constants';
import { useApp } from '../../context/useApp';
import { toISODate } from '../../lib/utils';
import { useSubmitLock } from '../../hooks/useSubmitLock';

interface ActionFormProps {
  leadId: string;
  // extras (B1/B2) : quand l'action bascule le lead en Signé (montant) ou en
  // Perdu (motif), la donnée est saisie ICI (champ inline) et remonte au parent
  // qui l'écrit sur le lead — le formulaire ne dispatch rien lui-même.
  onSave: (action: Omit<LeadAction, 'id'>, extras?: { quoteAmount?: number; lossReason?: string }) => void;
  onCancel: () => void;
  // Si fournie -> mode edition : le formulaire est pre-rempli et le bloc
  // "Changer statut / Prochaine action" (declencheurs d'effets de bord propres a
  // l'ajout) est masque. On n'edite que les champs de l'action elle-meme.
  action?: LeadAction;
}

export default function ActionForm({ leadId, onSave, onCancel, action }: ActionFormProps) {
  const { state } = useApp();
  const isEdit = !!action;
  const lead = state.leads.find(l => l.id === leadId);
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
  // Montant de la vente (B1) : requis seulement si newStatus === 'signe'.
  // Pré-rempli devis ?? budget — cas nominal : rien à retaper.
  const [saleAmount, setSaleAmount] = useState(String(lead?.quoteAmount ?? lead?.budget ?? ''));
  const parsedAmount = Number(saleAmount);
  const signing = form.newStatus === 'signe';
  const amountValid = saleAmount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  // Motif de perte (B2) : requis seulement si newStatus === 'perdu' ; liste
  // fermée, "Autre" ouvre un champ libre requis.
  const [lossReason, setLossReason] = useState('');
  const [lossCustom, setLossCustom] = useState('');
  const losing = form.newStatus === 'perdu';
  const lossOther = lossReason === 'Autre';
  const lossValid = lossReason !== '' && (!lossOther || lossCustom.trim() !== '');

  // Verrou anti-double-soumission (correctif #2) : pas de double action créée.
  const { locked, guard } = useSubmitLock();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (signing && !amountValid) return; // ceinture : l'input required/min bloque déjà
    if (losing && !lossValid) return;    // idem : select/input required
    const extras = signing
      ? { quoteAmount: parsedAmount }
      : losing
        ? { lossReason: lossOther ? lossCustom.trim() : lossReason }
        : undefined;
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
    }, extras));
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
          {signing && (
            <div className="md:col-span-3">
              <label htmlFor="action-sale-amount" className="label">Montant de la vente (€) *</label>
              <input
                id="action-sale-amount"
                className="input"
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={saleAmount}
                onChange={e => setSaleAmount(e.target.value)}
                required
              />
              <p className="text-xs text-gray-400 mt-1">
                Pré-rempli avec le devis/budget — ce montant alimente le chiffre d'affaires.
              </p>
            </div>
          )}
          {losing && (
            <>
              <div className={lossOther ? '' : 'md:col-span-3'}>
                <label htmlFor="action-loss-reason" className="label">Motif de la perte *</label>
                <select
                  id="action-loss-reason"
                  className="select"
                  value={lossReason}
                  onChange={e => setLossReason(e.target.value)}
                  required
                >
                  <option value="">— Choisir un motif —</option>
                  {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {lossOther && (
                <div className="md:col-span-2">
                  <label htmlFor="action-loss-custom" className="label">Précisez le motif *</label>
                  <input
                    id="action-loss-custom"
                    className="input"
                    value={lossCustom}
                    onChange={e => setLossCustom(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>
        <button type="submit" className="btn-primary btn-sm" disabled={locked}>{isEdit ? 'Enregistrer' : "Ajouter l'action"}</button>
      </div>
    </form>
  );
}
