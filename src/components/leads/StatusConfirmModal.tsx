import { useEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import { getLeadFullName } from '../../lib/utils';
import { LOSS_REASONS } from '../../data/constants';
import type { Lead, LeadStatus } from '../../data/types';

// Confirmation de bascule vers un statut terminal sensible (lot frictions UX).
// B1 (Signé) : montant de la vente OBLIGATOIRE et > 0 — c'est lui qui alimente
// le CA (quoteAmount ?? budget dans goals.ts). Pré-rempli devis/budget : dans le
// cas nominal, confirmer reste UN clic.
// B2 (Perdu) : motif OBLIGATOIRE via liste fermée (agrégeable en stat) ; "Autre"
// ouvre un champ libre requis.
// Le rendu est conditionnel côté parent (monté = ouvert) ; Modal fournit
// focus-trap, Échap et restauration du focus.

export interface StatusConfirmExtras {
  quoteAmount?: number;
  lossReason?: string;
}

interface StatusConfirmModalProps {
  lead: Lead;
  status: LeadStatus;
  onConfirm: (extras: StatusConfirmExtras) => void;
  onCancel: () => void;
}

export default function StatusConfirmModal({ lead, status, onConfirm, onCancel }: StatusConfirmModalProps) {
  if (status === 'signe') return <SignConfirm lead={lead} onConfirm={onConfirm} onCancel={onCancel} />;
  if (status === 'perdu') return <LostConfirm lead={lead} onConfirm={onConfirm} onCancel={onCancel} />;
  return null;
}

type VariantProps = Omit<StatusConfirmModalProps, 'status'>;

function SignConfirm({ lead, onConfirm, onCancel }: VariantProps) {
  // Chaîne (pas number) : permet le champ vidé sans NaN dans l'input contrôlé.
  const [amount, setAmount] = useState(String(lead.quoteAmount ?? lead.budget ?? ''));
  const parsed = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(parsed) && parsed > 0;

  // Focus + sélection du montant à l'ouverture : taper remplace directement le
  // pré-rempli. Passe APRÈS le focus générique de Modal (effet enfant d'abord,
  // Modal est notre enfant) — c'est donc bien ce focus-ci qui gagne.
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => { amountRef.current?.select(); }, []);

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

function LostConfirm({ lead, onConfirm, onCancel }: VariantProps) {
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const isOther = reason === 'Autre';
  const reasonValid = reason !== '' && (!isOther || custom.trim() !== '');

  // Même mécanique de focus que la variante Signé : directement sur le motif.
  const reasonRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { reasonRef.current?.focus(); }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonValid) return;
    onConfirm({ lossReason: isOther ? custom.trim() : reason });
  };

  return (
    <Modal open onClose={onCancel} title="Confirmer la perte" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Passer <span className="font-medium text-gray-900">{getLeadFullName(lead)}</span> au
          statut <span className="font-medium text-danger-600">Perdu</span>.
        </p>
        <div>
          <label htmlFor="loss-reason" className="label">Motif de la perte *</label>
          <select
            ref={reasonRef}
            id="loss-reason"
            className="select"
            value={reason}
            onChange={e => setReason(e.target.value)}
            required
          >
            <option value="">— Choisir un motif —</option>
            {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {isOther && (
          <div>
            <label htmlFor="loss-reason-custom" className="label">Précisez le motif *</label>
            <input
              id="loss-reason-custom"
              className="input"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              required
              autoFocus
            />
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>
          <button type="submit" className="btn-danger btn-sm" disabled={!reasonValid}>
            Confirmer la perte
          </button>
        </div>
      </form>
    </Modal>
  );
}
