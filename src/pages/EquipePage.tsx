import { useState, useMemo } from 'react';
import { Plus, Pencil, Check, X, PowerOff, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useApp } from '../context/AppContext';
import { formatCurrency, generateId } from '../lib/utils';
import { ACTIVE_STATUSES } from '../data/constants';

export default function EquipePage() {
  const { state, dispatch } = useApp();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const commercialStats = useMemo(() => {
    return state.commercials.map(c => {
      const allLeads = state.leads.filter(l => l.commercialId === c.id);
      const actifs = allLeads.filter(l => ACTIVE_STATUSES.includes(l.status)).length;
      const signes = allLeads.filter(l => l.status === 'signe').length;
      const perdus = allLeads.filter(l => l.status === 'perdu').length;
      const montantSigne = allLeads
        .filter(l => l.status === 'signe')
        .reduce((sum, l) => sum + (l.quoteAmount ?? l.budget ?? 0), 0);
      return { ...c, actifs, signes, perdus, montantSigne };
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
    dispatch({ type: 'ADD_COMMERCIAL', payload: { id: generateId(), name, active: true } });
    setNewName('');
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const confirmEdit = (id: string) => {
    const name = editingName.trim();
    if (name) {
      dispatch({ type: 'UPDATE_COMMERCIAL', payload: { id, data: { name } } });
    }
    setEditingId(null);
    setEditingName('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const toggleActive = (id: string) => {
    dispatch({ type: 'TOGGLE_COMMERCIAL', payload: id });
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
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
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
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-5 py-3 text-left font-medium text-gray-600">Commercial</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Leads actifs</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Signés</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Perdus</th>
              <th className="px-5 py-3 text-right font-medium text-gray-600">Montant signé</th>
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
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="input py-1 text-sm w-40"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmEdit(c.id);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => confirmEdit(c.id)}
                        className="btn-ghost btn-sm text-success-600 p-1"
                        title="Valider"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="btn-ghost btn-sm text-gray-400 p-1"
                        title="Annuler"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="font-medium text-gray-900">{c.name}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right text-gray-600">{c.actifs}</td>
                <td className="px-5 py-3 text-right text-success-600 font-medium">{c.signes}</td>
                <td className="px-5 py-3 text-right text-danger-600">{c.perdus}</td>
                <td className="px-5 py-3 text-right font-semibold text-gray-900">
                  {formatCurrency(c.montantSigne)}
                </td>
                <td className="px-5 py-3 text-right">
                  <span className={`badge ${c.active ? 'bg-success-100 text-success-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.active ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {editingId !== c.id && (
                      <button
                        onClick={() => startEdit(c.id, c.name)}
                        className="btn-ghost btn-sm p-1.5 text-gray-400 hover:text-gray-600"
                        title="Modifier le nom"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
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
                <td colSpan={7} className="px-5 py-10 text-center text-gray-400">
                  Aucun commercial enregistré
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
    </div>
  );
}
