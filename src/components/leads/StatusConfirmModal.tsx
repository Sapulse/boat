import { useEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import { getLeadFullName } from '../../lib/utils';
import type { Lead, LeadStatus } from '../../data/types';

// Confirmation de bascule vers un statut terminal sensible (lot frictions UX).
// B1 (Signé) : le montant de la vente est OBLIGATOIRE et > 0 — c'est lui qui
// alimente le CA (quoteAmount ?? budget dans goals.ts). Pré-rempli avec le
// devis/budget : dans le cas nominal, confirmer reste UN clic.
// Le rendu est conditionnel côté parent (monté = ouvert) ; Modal fournit
// focus-trap, Échap et restauration du focus.

export interface StatusConfirmExtras {
  quoteAmount?: number;
}

interface StatusConfirmModalProps {
  lead: Lead;
  status: LeadStatus;
  onConfirm: (extras: StatusConfirmExtras) => void;
  onCancel: () => void;
}

export default function StatusConfirmModal({ lead, status, onConfirm, onCancel }: StatusConfirmModalProps) {
  // Chaîne (pas number) : permet le champ vidé sans NaN dans l'input contrôlé.
  const [amount, setAmount] = useState(String(lead.quoteAmount ?? lead.budget ?? ''));
  const parsed = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(parsed) && parsed > 0;

  // Focus + sélection du montant à l'ouverture : taper remplace directement le
  // pré-rempli. Passe APRÈS le focus générique de Modal (effet enfant d'abord,
  // Modal est notre enfant) — c'est donc bien ce focus-ci qui gagne.
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => { amountRef.current?.select(); }, []);

  if (status !== 'signe') return null; // B2 ajoutera la variante Perdu.

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountValid) return;
    onConfirm({ quoteAmount: parsed });
  };

  return (
    <Modal open onClose={onCancel} title="Confirmer la vente" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Passer <span className="font-medium text-gray-900">{getLeadFullName(lead)}</span> au
          statut <span className="font-medium text-success-700">Signé</span>.
        </p>
        <div>
          <label htmlFor="sale-amount" className="label">Montant de la vente (€) *</label>
          <input
            ref={amountRef}
            id="sale-amount"
            className="input"
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            Pré-rempli avec le devis/budget — ce montant alimente le chiffre d'affaires.
          </p>
          {!amountValid && amount.trim() !== '' && (
            <p className="text-xs text-danger-600 mt-1">Le montant doit être supérieur à 0.</p>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>
          <button type="submit" className="btn-primary btn-sm" disabled={!amountValid}>
            Confirmer la vente
          </button>
        </div>
      </form>
    </Modal>
  );
}
