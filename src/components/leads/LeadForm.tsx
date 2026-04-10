import { useState } from 'react';
import type { Lead, LeadStatus, BoatType, BoatCondition, Temperature, ActionType } from '../../data/types';
import { LEAD_STATUSES, BOAT_TYPES, BOAT_CONDITIONS, TEMPERATURES, SOURCES, ACTION_TYPES } from '../../data/constants';
import { useApp } from '../../context/AppContext';
import { toISODate } from '../../lib/utils';

interface LeadFormProps {
  lead?: Lead;
  onSave: (data: Omit<Lead, 'id'>) => void;
  onCancel: () => void;
}

export default function LeadForm({ lead, onSave, onCancel }: LeadFormProps) {
  const { state } = useApp();
  const [form, setForm] = useState({
    firstName: lead?.firstName ?? '',
    lastName: lead?.lastName ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    source: lead?.source ?? '',
    commercialId: lead?.commercialId ?? state.commercials[0]?.id ?? '',
    boatType: lead?.boatType ?? '' as BoatType | '',
    boatCondition: lead?.boatCondition ?? '' as BoatCondition | '',
    boatInterest: lead?.boatInterest ?? '',
    brand: lead?.brand ?? '',
    budget: lead?.budget ?? null as number | null,
    status: lead?.status ?? 'nouveau' as LeadStatus,
    temperature: lead?.temperature ?? 'tiede' as Temperature,
    contactDate: lead?.contactDate ?? '',
    quoteAmount: lead?.quoteAmount ?? null as number | null,
    probability: lead?.probability ?? null as number | null,
    currentBoat: lead?.currentBoat ?? '',
    comments: lead?.comments ?? '',
    deliveryDate: lead?.deliveryDate ?? '',
    nextActionType: lead?.nextActionType ?? '' as ActionType | '',
    nextActionDate: lead?.nextActionDate ?? '',
    lossReason: lead?.lossReason ?? '',
  });

  const update = (field: string, value: string | number | null) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      createdAt: lead?.createdAt ?? toISODate(new Date()),
      lastActionDate: lead?.lastActionDate ?? '',
      signedAt: lead?.signedAt ?? '',
      lostAt: lead?.lostAt ?? '',
      reportedAt: lead?.reportedAt ?? '',
    } as Omit<Lead, 'id'>);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Prénom *</label>
          <input
            className="input"
            value={form.firstName}
            onChange={e => update('firstName', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Nom *</label>
          <input
            className="input"
            value={form.lastName}
            onChange={e => update('lastName', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Téléphone</label>
          <input
            className="input"
            value={form.phone}
            onChange={e => update('phone', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={e => update('email', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Source</label>
          <select className="select" value={form.source} onChange={e => update('source', e.target.value)}>
            <option value="">--</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Commercial *</label>
          <select className="select" value={form.commercialId} onChange={e => update('commercialId', e.target.value)} required>
            {state.commercials.filter(c => c.active).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Statut</label>
          <select className="select" value={form.status} onChange={e => update('status', e.target.value as LeadStatus)}>
            {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Type de bateau</label>
          <select className="select" value={form.boatType} onChange={e => update('boatType', e.target.value)}>
            <option value="">--</option>
            {BOAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">État</label>
          <select className="select" value={form.boatCondition} onChange={e => update('boatCondition', e.target.value)}>
            <option value="">--</option>
            {BOAT_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Température</label>
          <select className="select" value={form.temperature} onChange={e => update('temperature', e.target.value as Temperature)}>
            {TEMPERATURES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Intérêt bateau</label>
          <input className="input" value={form.boatInterest} onChange={e => update('boatInterest', e.target.value)} />
        </div>
        <div>
          <label className="label">Marque</label>
          <input className="input" value={form.brand} onChange={e => update('brand', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Budget (EUR)</label>
          <input
            className="input"
            type="number"
            value={form.budget ?? ''}
            onChange={e => update('budget', e.target.value ? Number(e.target.value) : null)}
          />
        </div>
        <div>
          <label className="label">Montant devis (EUR)</label>
          <input
            className="input"
            type="number"
            value={form.quoteAmount ?? ''}
            onChange={e => update('quoteAmount', e.target.value ? Number(e.target.value) : null)}
          />
        </div>
        <div>
          <label className="label">% Réalisation</label>
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            value={form.probability ?? ''}
            onChange={e => update('probability', e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Date de contact</label>
          <input className="input" type="date" value={form.contactDate} onChange={e => update('contactDate', e.target.value)} />
        </div>
        <div>
          <label className="label">Prochaine action</label>
          <select className="select" value={form.nextActionType} onChange={e => update('nextActionType', e.target.value)}>
            <option value="">--</option>
            {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date prochaine action</label>
          <input className="input" type="date" value={form.nextActionDate} onChange={e => update('nextActionDate', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Bateau actuel</label>
          <input className="input" value={form.currentBoat} onChange={e => update('currentBoat', e.target.value)} />
        </div>
        <div>
          <label className="label">Date de livraison</label>
          <input className="input" type="date" value={form.deliveryDate} onChange={e => update('deliveryDate', e.target.value)} />
        </div>
      </div>

      {form.status === 'perdu' && (
        <div>
          <label className="label">Motif de perte</label>
          <input className="input" value={form.lossReason} onChange={e => update('lossReason', e.target.value)} />
        </div>
      )}

      <div>
        <label className="label">Commentaires</label>
        <textarea className="input min-h-[80px]" value={form.comments} onChange={e => update('comments', e.target.value)} />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="submit" className="btn-primary">
          {lead ? 'Enregistrer' : 'Créer le lead'}
        </button>
      </div>
    </form>
  );
}
