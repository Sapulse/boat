import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Trash2, Plus, Phone, Mail, Calendar,
  Ship, DollarSign, User, Clock, FileText, MessageSquare,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import LeadForm from '../components/leads/LeadForm';
import ActionForm from '../components/leads/ActionForm';
import { ACTION_TYPES } from '../data/constants';
import { formatDate, formatCurrency, getAlertLevel, getLeadFullName, daysSince, cn } from '../lib/utils';
import type { Lead } from '../data/types';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state, updateLead, deleteLead, addAction, getLeadActions, getCommercialName } = useApp();
  const [editMode, setEditMode] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);

  const lead = state.leads.find(l => l.id === id);
  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500 mb-4">Lead introuvable</p>
        <button onClick={() => navigate('/leads')} className="btn-primary">Retour aux leads</button>
      </div>
    );
  }

  const actions = getLeadActions(lead.id);
  const alert = getAlertLevel(lead);
  const days = daysSince(lead.lastActionDate || lead.createdAt);

  const handleSave = (data: Omit<Lead, 'id'>) => {
    updateLead(lead.id, data);
    setEditMode(false);
  };

  const handleDelete = () => {
    if (confirm('Supprimer ce lead définitivement ?')) {
      deleteLead(lead.id);
      navigate('/leads');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/leads')} className="btn-ghost btn-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <AlertDot level={alert} />
            <h2 className="text-xl font-bold text-gray-900">{getLeadFullName(lead)}</h2>
            <StatusBadge status={lead.status} />
            <TemperatureBadge temperature={lead.temperature} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Créé le {formatDate(lead.createdAt)} · {getCommercialName(lead.commercialId)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditMode(true)} className="btn-secondary btn-sm">
            <Edit2 className="w-4 h-4" /> Modifier
          </button>
          <button onClick={handleDelete} className="btn-ghost btn-sm text-danger-600 hover:text-danger-700 hover:bg-danger-50">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact info */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-primary-600" /> Informations client
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Phone className="w-4 h-4 text-gray-400" />
                <span>{lead.phone || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Mail className="w-4 h-4 text-gray-400" />
                <span>{lead.email || '-'}</span>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Source</span>
                <p className="text-gray-700">{lead.source || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Bateau actuel</span>
                <p className="text-gray-700">{lead.currentBoat || '-'}</p>
              </div>
            </div>
            {lead.comments && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">Commentaires</span>
                </div>
                <p className="text-sm text-gray-600">{lead.comments}</p>
              </div>
            )}
          </div>

          {/* Boat project */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Ship className="w-4 h-4 text-primary-600" /> Projet bateau
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-400 text-xs">Type</span>
                <p className="text-gray-700">{lead.boatType || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">État</span>
                <p className="text-gray-700">{lead.boatCondition || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Marque</span>
                <p className="text-gray-700">{lead.brand || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Intérêt</span>
                <p className="text-gray-700 font-medium">{lead.boatInterest || '-'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Budget</span>
                <p className="text-gray-700 font-semibold">{formatCurrency(lead.budget)}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Date livraison</span>
                <p className="text-gray-700">{formatDate(lead.deliveryDate)}</p>
              </div>
            </div>
          </div>

          {/* Financial */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary-600" /> Financier
            </h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-400 text-xs">Montant devis</span>
                <p className="text-gray-700 font-semibold">{formatCurrency(lead.quoteAmount)}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">% Réalisation</span>
                <p className="text-gray-700">{lead.probability !== null ? `${lead.probability}%` : '-'}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Budget</span>
                <p className="text-gray-700">{formatCurrency(lead.budget)}</p>
              </div>
            </div>
          </div>

          {/* Actions history */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary-600" /> Historique des actions ({actions.length})
              </h3>
              <button onClick={() => setShowActionForm(true)} className="btn-primary btn-sm">
                <Plus className="w-3 h-3" /> Action
              </button>
            </div>
            {showActionForm && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <ActionForm
                  leadId={lead.id}
                  onSave={(action) => { addAction(action); setShowActionForm(false); }}
                  onCancel={() => setShowActionForm(false)}
                />
              </div>
            )}
            {actions.length > 0 ? (
              <div className="space-y-3">
                {actions.map(action => (
                  <div key={action.id} className="flex gap-3 text-sm border-l-2 border-primary-200 pl-4 py-1">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {ACTION_TYPES.find(a => a.value === action.type)?.label ?? action.type}
                        </span>
                        <span className="text-xs text-gray-400">{formatDate(action.date)}</span>
                        <span className="text-xs text-gray-400">par {getCommercialName(action.authorId)}</span>
                      </div>
                      {action.result && <p className="text-gray-600 mt-0.5">{action.result}</p>}
                      {action.notes && <p className="text-gray-400 text-xs mt-0.5">{action.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 py-4 text-center">Aucune action enregistrée</p>
            )}
          </div>
        </div>

        {/* Right column - Summary */}
        <div className="space-y-4">
          {/* Quick info */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary-600" /> Suivi commercial
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Date contact</span>
                <span className="text-gray-900">{formatDate(lead.contactDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dernière action</span>
                <span className={cn(
                  days > 14 ? 'text-danger-600 font-medium' : days > 7 ? 'text-warning-600' : 'text-gray-900'
                )}>
                  {days === Infinity ? '-' : days === 0 ? "Aujourd'hui" : `il y a ${days}j`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Prochaine action</span>
                <span className="text-gray-900">
                  {ACTION_TYPES.find(a => a.value === lead.nextActionType)?.label ?? '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date proch. action</span>
                <span className="text-gray-900">{formatDate(lead.nextActionDate)}</span>
              </div>
            </div>
          </div>

          {/* Status timeline */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary-600" /> Jalons
            </h3>
            <div className="space-y-2 text-sm">
              <TimelineItem label="Création" date={lead.createdAt} active />
              <TimelineItem label="Contact" date={lead.contactDate} active={!!lead.contactDate} />
              <TimelineItem label="Signé" date={lead.signedAt} active={!!lead.signedAt} success />
              <TimelineItem label="Perdu" date={lead.lostAt} active={!!lead.lostAt} danger />
              <TimelineItem label="Reporté" date={lead.reportedAt} active={!!lead.reportedAt} />
              {lead.deliveryDate && <TimelineItem label="Livraison" date={lead.deliveryDate} active />}
            </div>
            {lead.lossReason && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">Motif de perte</span>
                <p className="text-sm text-danger-600">{lead.lossReason}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={editMode} onClose={() => setEditMode(false)} title="Modifier le lead" size="xl">
        <LeadForm lead={lead} onSave={handleSave} onCancel={() => setEditMode(false)} />
      </Modal>
    </div>
  );
}

function TimelineItem({ label, date, active, success, danger }: {
  label: string;
  date: string;
  active: boolean;
  success?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn(
        'w-2.5 h-2.5 rounded-full shrink-0',
        active
          ? success ? 'bg-success-500' : danger ? 'bg-danger-500' : 'bg-primary-500'
          : 'bg-gray-200'
      )} />
      <span className={cn('flex-1', active ? 'text-gray-700' : 'text-gray-400')}>{label}</span>
      <span className={cn('text-xs', active ? 'text-gray-500' : 'text-gray-300')}>
        {formatDate(date)}
      </span>
    </div>
  );
}
