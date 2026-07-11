import { useState, useMemo } from 'react';
import { Plus, Pencil, Check, X, PowerOff, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useApp } from '../context/useApp';
import { useToast } from '../context/useToast';
import { formatCurrency } from '../lib/utils';
import { ACTIVE_STATUSES } from '../data/constants';
import { useSubmitLock } from '../hooks/useSubmitLock';

export default function EquipePage() {
  const { state, updateLead, addCommercial, updateCommercial, toggleCommercial } = useApp();
  const toast = useToast();
  const { locked, guard } = useSubmitLock();

  const [newName, setNewName] = useState('');
  const [editDraft, setEditDraft] = useState<{ id: string; name: string; email: string; signature: string } | null>(null);
  const [reassignFrom, setReassignFrom] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  const commercialStats = useMemo(() => {
    return state.commercials.map(c => {
      const allLeads = state.leads.filter(l => l.commercialId === c.id);
      const actifs = allLeads.filter(l => ACTIVE_STATUSES.includes(l.status)).length;
      const signes = allLeads.filter(l => l.status === 'signe').length;
      const perdus = allLeads.filter(l => l.status === 'perdu').length;
      const montantSigne = allLeads
        .filter(l => l.status === 'signe')
        .reduce((sum, l) => sum + (l.quoteAmount ?? l.budget ?? 0), 0);
      const total = allLeads.length;
      const tauxConversion = (signes + perdus) > 0
        ? Math.round((signes / (signes + perdus)) * 100) + '%'
        : '-';
      return { ...c, actifs, signes, perdus, montantSigne, total, tauxConversion };
    });
  }, [state.commercials, state.leads]);

  const chartData = useMemo(() => {
    return commercialStats.map(c => ({
      name: c.name,
      Actifs: c.actifs,
      Signés: c.signes,
      Perdus: c.perdus,
    }));
  }, [commercialStats]);

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    guard(() => { addCommercial({ name, active: true }); setNewName(''); toast.success('Commercial ajouté'); });
  };

  const openEdit = (id: string, name: string, email?: string, signature?: string) => {
    setEditDraft({ id, name, email: email ?? '', signature: signature ?? '' });
  };

  const confirmEdit = () => {
    if (!editDraft) return;
    const name = editDraft.name.trim();
    if (!name) return;
    updateCommercial(editDraft.id, { name, email: editDraft.email.trim(), signature: editDraft.signature });
    setEditDraft(null);
  };

  const cancelEdit = () => setEditDraft(null);

  const toggleActive = (id: string) => {
    const commercial = state.commercials.find(c => c.id === id);
    if (commercial?.active) {
      const activeLeadCount = state.leads.filter(l => l.commercialId === id && ACTIVE_STATUSES.includes(l.status)).length;
      if (activeLeadCount > 0) {
        setReassignFrom(id);
        return;
      }
    }
    toggleCommercial(id);
  };

  const handleReassign = () => {
    if (!reassignFrom || !reassignTo) return;
    state.leads.forEach(l => {
      if (l.commercialId === reassignFrom && ACTIVE_STATUSES.includes(l.status)) {
        updateLead(l.id, { commercialId: reassignTo });
      }
    });
    toggleCommercial(reassignFrom);
    setReassignFrom(null);
    setReassignTo('');
  };

  return (
    <div className="space-y-6">
      {/* Add commercial */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary-600" />
          Ajouter un commercial
        </h2>
        <div className="flex gap-3 max-w-sm">
          <input
            className="input flex-1"
            placeholder="Nom du commercial"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || locked}
            className="btn-primary btn-sm"
          >
            <Plus className="w-4 h-4" />
            Ajouter
          </button>
        </div>
      </div>

      {/* Commercial list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Équipe commerciale</h2>
        </div>
        {/* 9 colonnes : scroll horizontal sur petit ecran (meme pattern que
            les autres tableaux larges), sinon le card overflow-hidden coupe. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-5 py-3 text-left font-medium text-gray-600">Commercial</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Leads actifs</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Signés</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Perdus</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Total leads</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Montant signé</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Taux conversion</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Statut</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {commercialStats.map(c => (
              <tr
                key={c.id}
                className={`border-b border-gray-100 ${!c.active ? 'opacity-50' : ''}`}
              >
                <td className="px-5 py-3">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <div className="text-xs text-gray-400 flex items-center gap-2">
                    <span>{c.email || 'pas d\'email'}</span>
                    {c.signature ? <span className="text-success-600">· signature ✓</span> : null}
                  </div>
                </td>
                <td className="px-5 py-3 text-right text-gray-600">{c.actifs}</td>
                <td className="px-5 py-3 text-right text-success-600 font-medium">{c.signes}</td>
                <td className="px-5 py-3 text-right text-danger-600">{c.perdus}</td>
                <td className="px-5 py-3 text-right text-gray-600">{c.total}</td>
                <td className="px-5 py-3 text-right font-semibold text-gray-900">
                  {formatCurrency(c.montantSigne)}
                </td>
                <td className="px-5 py-3 text-right text-gray-600">{c.tauxConversion}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`badge ${c.active ? 'bg-success-100 text-success-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.active ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => openEdit(c.id, c.name, c.email, c.signature)}
                      className="btn-ghost btn-sm p-1.5 text-gray-400 hover:text-gray-600"
                      title="Modifier (nom, email, signature)"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => toggleActive(c.id)}
                      className={`btn-ghost btn-sm p-1.5 ${c.active ? 'text-gray-400 hover:text-danger-600' : 'text-gray-400 hover:text-success-600'}`}
                      title={c.active ? 'Désactiver' : 'Réactiver'}
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {state.commercials.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center text-gray-400">
                  Aucun commercial enregistré
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Performance chart */}
      {commercialStats.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary-600" />
            Performance par commercial
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barGap={4} barCategoryGap="30%">
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="Actifs" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Signés" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Perdus" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 justify-center mt-2">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> Actifs
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> Signés
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Perdus
            </span>
          </div>
        </div>
      )}
      {editDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={cancelEdit} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Modifier le commercial</h3>
              <button onClick={cancelEdit} className="btn-ghost btn-sm p-1 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="label">Nom *</label>
              <input className="input" value={editDraft.name} autoFocus
                onChange={e => setEditDraft(d => d && { ...d, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') cancelEdit(); }} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={editDraft.email} placeholder="prenom@oceanboat.fr"
                onChange={e => setEditDraft(d => d && { ...d, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Signature</label>
              <textarea className="input min-h-[90px]" value={editDraft.signature}
                placeholder={'Prénom Nom\nOcean Boat\n06 00 00 00 00'}
                onChange={e => setEditDraft(d => d && { ...d, signature: e.target.value })} />
              <p className="text-xs text-gray-400 mt-1">Injectée via la variable <code className="font-mono text-primary-600">{'{{signature}}'}</code> des modèles d'email.</p>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button onClick={cancelEdit} className="btn-secondary btn-sm">Annuler</button>
              <button onClick={confirmEdit} disabled={!editDraft.name.trim()} className="btn-primary btn-sm"><Check className="w-3.5 h-3.5" /> Enregistrer</button>
            </div>
          </div>
        </div>
      )}
      {reassignFrom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setReassignFrom(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Réassigner les leads</h3>
            <p className="text-sm text-gray-600 mb-4">
              Ce commercial a {state.leads.filter(l => l.commercialId === reassignFrom && ACTIVE_STATUSES.includes(l.status)).length} lead(s) actif(s).
              Choisissez un commercial pour les réassigner avant la désactivation.
            </p>
            <select className="select mb-4" value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
              <option value="">Choisir un commercial...</option>
              {state.commercials.filter(c => c.active && c.id !== reassignFrom).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setReassignFrom(null); setReassignTo(''); }} className="btn-secondary btn-sm">Annuler</button>
              <button onClick={() => { toggleCommercial(reassignFrom); setReassignFrom(null); }} className="btn-ghost btn-sm text-gray-500">Désactiver sans réassigner</button>
              <button onClick={handleReassign} disabled={!reassignTo} className="btn-primary btn-sm">Réassigner et désactiver</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
