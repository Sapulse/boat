import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Trash2, Plus, Phone, Mail, Calendar,
  Ship, DollarSign, User, Clock, FileText, MessageSquare, MessageCircle,
  AlertTriangle, Flame, ExternalLink, ShieldAlert, RotateCw, ChevronDown, Contact,
} from 'lucide-react';
import { useApp } from '../context/useApp';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import LeadForm from '../components/leads/LeadForm';
import ActionForm from '../components/leads/ActionForm';
import { ACTION_TYPES, getNextStatus, getPriorityInfo, getStatusLabel } from '../data/constants';
import { formatDate, formatCurrency, getAlertLevel, getLeadFullName, daysSince, cn, isLeadActive, getLeadRisks, toISODate, hasPlannedNextAction } from '../lib/utils';
import { buildLeadVars, renderEmail, renderTemplate, buildMailto } from '../lib/email';
import { buildSms } from '../lib/sms';
import { buildWhatsApp } from '../lib/whatsapp';
import { buildCommunicationAction } from '../lib/communication';
import { generateVCard } from '../lib/vcard';
import { isEndAfterStart } from '../lib/agenda';
import type { Lead, LeadStatus, MessageTemplate, ActionType } from '../data/types';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state, updateLead, deleteLead, addAction, updateAction, deleteAction, setNextAction, getLeadActions, getCommercialName, updateLeadStatus } = useApp();
  const [editMode, setEditMode] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingNextAction, setEditingNextAction] = useState(false);
  const [nextActionDraft, setNextActionDraft] = useState<{ type: ActionType | ''; date: string; time: string; endTime: string }>({ type: '', date: '', time: '', endTime: '' });
  const [showEmailMenu, setShowEmailMenu] = useState(false);
  const [showSmsMenu, setShowSmsMenu] = useState(false);
  const [showWhatsappMenu, setShowWhatsappMenu] = useState(false);

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
  const isActive = isLeadActive(lead.status);
  const risks = getLeadRisks(lead);
  const nextStatus = getNextStatus(lead.status);

  const handleSave = (data: Omit<Lead, 'id'>) => {
    updateLead(lead.id, data);
    setEditMode(false);
  };

  const handleDelete = () => {
    if (confirm('Supprimer ce lead definitivement ?')) {
      deleteLead(lead.id);
      navigate('/leads');
    }
  };

  const quickStatusChange = (status: LeadStatus) => {
    updateLeadStatus(lead.id, status);
  };

  // Export du contact au format vCard 3.0 (.vcf) : genere la carte (helper pur)
  // puis declenche le telechargement.
  const exportContact = () => {
    const vcf = generateVCard(lead, getCommercialName(lead.commercialId));
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getLeadFullName(lead).replace(/\s+/g, '-') || 'contact'}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Envoi pre-rempli : interpole le template avec les variables du lead + la
  // signature du commercial ASSIGNE, ouvre un mailto: encode, et journalise une
  // action 'email' dans l'historique. `template` null = email vierge (repli
  // quand il ne reste aucun modele de type email).
  const sendEmail = (template: MessageTemplate | null) => {
    const commercial = state.commercials.find(c => c.id === lead.commercialId);
    const vars = buildLeadVars(lead, commercial);
    const { subject, body } = template ? renderEmail(template, vars) : { subject: '', body: '' };
    window.location.assign(buildMailto(lead.email, subject, body));
    addAction(buildCommunicationAction(lead, 'email', toISODate(new Date()), {
      result: template ? `Email envoyé — ${template.title}` : 'Email envoyé — sans modèle',
      notes: subject,
    }));
    setShowEmailMenu(false);
  };

  // Chaque bouton (Email / SMS / WhatsApp) ne liste que les modeles de son type.
  const emailTemplates = state.templates.filter(t => t.type === 'email');
  const smsTemplates = state.templates.filter(t => t.type === 'sms');
  const whatsappTemplates = state.templates.filter(t => t.type === 'whatsapp');

  // Envoi SMS pre-rempli : miroir strict de sendEmail — interpole UNIQUEMENT
  // le corps du modele (un SMS n'a pas de sujet), memes variables que l'email,
  // ouvre un lien sms: (helper buildSms) et journalise une action 'sms'.
  // `template` null = SMS vierge (repli quand aucun modele de type sms).
  const sendSms = (template: MessageTemplate | null) => {
    const commercial = state.commercials.find(c => c.id === lead.commercialId);
    const vars = buildLeadVars(lead, commercial);
    const body = template ? renderTemplate(template.body, vars) : '';
    window.location.assign(buildSms(lead.phone, body));
    addAction(buildCommunicationAction(lead, 'sms', toISODate(new Date()), {
      result: template ? `SMS envoyé — ${template.title}` : 'SMS envoyé — sans modèle',
      notes: body,
    }));
    setShowSmsMenu(false);
  };

  // Envoi WhatsApp pre-rempli : miroir strict de sendSms — interpole UNIQUEMENT
  // le corps (pas de sujet), memes variables. Specificite : wa.me est une URL
  // https, ouverte dans un NOUVEL ONGLET (window.open _blank noopener) pour ne
  // pas quitter le CRM (contrairement aux schemes mailto:/sms: qui delèguent a
  // une app externe). Journalise une action 'whatsapp'. `template` null =
  // WhatsApp vierge (repli quand aucun modele de type whatsapp).
  const sendWhatsapp = (template: MessageTemplate | null) => {
    const commercial = state.commercials.find(c => c.id === lead.commercialId);
    const vars = buildLeadVars(lead, commercial);
    const body = template ? renderTemplate(template.body, vars) : '';
    window.open(buildWhatsApp(lead.phone, body), '_blank', 'noopener,noreferrer');
    addAction(buildCommunicationAction(lead, 'whatsapp', toISODate(new Date()), {
      result: template ? `WhatsApp envoyé — ${template.title}` : 'WhatsApp envoyé — sans modèle',
      notes: body,
    }));
    setShowWhatsappMenu(false);
  };

  // --- Prochaine action (Amelioration 1) : confine a nextActionType/Date via setNextAction ---
  const openNextActionEditor = () => {
    setNextActionDraft({ type: lead.nextActionType, date: lead.nextActionDate, time: lead.nextActionTime ?? '', endTime: lead.nextActionEndTime ?? '' });
    setEditingNextAction(true);
  };
  const saveNextAction = () => {
    // Pas de type -> on efface date, heure ET fin. Pas d'heure sans jour ; pas de
    // fin sans heure de debut, et seulement si fin > debut (sinon undefined).
    const date = nextActionDraft.type ? nextActionDraft.date : '';
    const time = date ? (nextActionDraft.time || undefined) : undefined;
    const endTime = time && nextActionDraft.endTime && isEndAfterStart(time, nextActionDraft.endTime)
      ? nextActionDraft.endTime
      : undefined;
    setNextAction(lead.id, nextActionDraft.type, date, time, endTime);
    setEditingNextAction(false);
  };
  // Fin saisie mais incoherente (sans debut, ou <= debut) -> blocage + message.
  const endTimeInvalid = !!nextActionDraft.endTime && !isEndAfterStart(nextActionDraft.time, nextActionDraft.endTime);
  const clearNextAction = () => {
    setNextAction(lead.id, '', '');
    setEditingNextAction(false);
  };

  // --- Historique (Amelioration 2) : suppression confirmee, sans effet sur le lead ---
  const handleDeleteAction = (actionId: string) => {
    if (confirm("Supprimer cette action de l'historique ? (sans effet sur le statut ni les dates du lead)")) {
      deleteAction(actionId);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header — flex-wrap : sous ~500px les boutons passent a la ligne au
          lieu d'ecraser le titre / deborder. */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate(-1)} className="btn-ghost btn-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <AlertDot level={alert} />
            <h2 className="text-xl font-bold text-gray-900">{getLeadFullName(lead)}</h2>
            <StatusBadge status={lead.status} />
            <TemperatureBadge temperature={lead.temperature} />
            <span className={cn('badge', getPriorityInfo(lead.priority).color)}>
              {getPriorityInfo(lead.priority).label}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Créé le {formatDate(lead.createdAt)} · {getCommercialName(lead.commercialId)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportContact} className="btn-secondary btn-sm"><Contact className="w-4 h-4" /> Exporter contact (.vcf)</button>
          <button onClick={() => setEditMode(true)} className="btn-secondary btn-sm"><Edit2 className="w-4 h-4" /> Modifier</button>
          <button onClick={handleDelete} className="btn-ghost btn-sm text-danger-600 hover:text-danger-700 hover:bg-danger-50"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Alert/Priority banner */}
      {alert !== 'none' && isActive && (
        <div className={cn('rounded-lg p-4 flex items-center gap-3', alert === 'red' ? 'bg-danger-50 border border-danger-200' : 'bg-warning-50 border border-warning-200')}>
          <AlertTriangle className={cn('w-5 h-5 shrink-0', alert === 'red' ? 'text-danger-600' : 'text-warning-600')} />
          <div>
            <p className={cn('text-sm font-medium', alert === 'red' ? 'text-danger-800' : 'text-warning-800')}>
              {alert === 'red' ? 'Attention urgente requise' : 'Action recommandée'}
            </p>
            <p className={cn('text-xs mt-0.5', alert === 'red' ? 'text-danger-600' : 'text-warning-600')}>
              {lead.temperature === 'chaud' && !hasPlannedNextAction(lead) ? 'Lead chaud sans prochaine action planifiée' :
               days >= 14 ? `Aucune action depuis ${days} jours` : `${days} jours depuis la dernière action`}
            </p>
          </div>
          <button onClick={() => setShowActionForm(true)} className="btn-primary btn-sm ml-auto shrink-0">
            <Plus className="w-3 h-3" /> Action
          </button>
        </div>
      )}

      {/* Risk / blocage detection */}
      {isActive && risks.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-warning-600" /> Risques détectés
          </h3>
          <div className="space-y-1.5">
            {risks.map((r, i) => (
              <div key={i} className={cn('text-xs px-3 py-1.5 rounded-lg flex items-center gap-2', r.severity === 'danger' ? 'bg-danger-50 text-danger-700' : 'bg-warning-50 text-warning-700')}>
                <span className={cn('w-1.5 h-1.5 rounded-full', r.severity === 'danger' ? 'bg-danger-500' : 'bg-warning-500')} />
                {r.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions bar */}
      {isActive && (
        <div className="card p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500 mr-2">Actions rapides :</span>
            <button onClick={() => setShowActionForm(true)} className="btn-primary btn-sm"><Plus className="w-3 h-3" /> Ajouter action</button>
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                onClick={() => addAction(buildCommunicationAction(lead, 'appel', toISODate(new Date()), { result: 'Appel passé' }))}
                className="btn-secondary btn-sm"
              >
                <Phone className="w-3 h-3" /> Appeler
              </a>
            )}
            {lead.email && (
              <div className="relative">
                <button onClick={() => setShowEmailMenu(v => !v)} className="btn-secondary btn-sm">
                  <Mail className="w-3 h-3" /> Email <ChevronDown className="w-3 h-3" />
                </button>
                {showEmailMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowEmailMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
                      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">Modèle pré-rempli</p>
                      {emailTemplates.map(t => (
                        <button key={t.id} onClick={() => sendEmail(t)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          {t.title}
                        </button>
                      ))}
                      {emailTemplates.length === 0 && (
                        <button onClick={() => sendEmail(null)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Email vierge (sans modèle)
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="relative">
              <button
                onClick={() => setShowSmsMenu(v => !v)}
                disabled={!lead.phone}
                title={lead.phone ? undefined : 'Aucun numéro de téléphone renseigné'}
                className="btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MessageSquare className="w-3 h-3" /> SMS <ChevronDown className="w-3 h-3" />
              </button>
              {showSmsMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowSmsMenu(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
                    <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">Modèle pré-rempli</p>
                    {smsTemplates.map(t => (
                      <button key={t.id} onClick={() => sendSms(t)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        {t.title}
                      </button>
                    ))}
                    {smsTemplates.length === 0 && (
                      <button onClick={() => sendSms(null)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        SMS vierge (sans modèle)
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowWhatsappMenu(v => !v)}
                disabled={!lead.phone}
                title={lead.phone ? undefined : 'Aucun numéro de téléphone renseigné'}
                className="btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MessageCircle className="w-3 h-3" /> WhatsApp <ChevronDown className="w-3 h-3" />
              </button>
              {showWhatsappMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowWhatsappMenu(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white rounded-lg border border-gray-200 shadow-lg py-1">
                    <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400">Modèle pré-rempli</p>
                    {whatsappTemplates.map(t => (
                      <button key={t.id} onClick={() => sendWhatsapp(t)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        {t.title}
                      </button>
                    ))}
                    {whatsappTemplates.length === 0 && (
                      <button onClick={() => sendWhatsapp(null)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        WhatsApp vierge (sans modèle)
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => { setShowActionForm(true); }} className="btn-secondary btn-sm"><RotateCw className="w-3 h-3" /> Relancer</button>
            {nextStatus && (
              <button onClick={() => quickStatusChange(nextStatus)} className="btn-primary btn-sm ml-auto">
                Passer à : {getStatusLabel(nextStatus)}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-primary-600" /> Informations client
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Phone className="w-4 h-4 text-gray-400" />
                {lead.phone ? <a href={`tel:${lead.phone}`} className="hover:text-primary-600">{lead.phone}</a> : '-'}
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Mail className="w-4 h-4 text-gray-400" />
                {lead.email ? <a href={`mailto:${lead.email}`} className="hover:text-primary-600">{lead.email}</a> : '-'}
              </div>
              <div><span className="text-gray-400 text-xs">Source</span><p className="text-gray-700">{lead.source || '-'}</p></div>
              <div><span className="text-gray-400 text-xs">Bateau actuel</span><p className="text-gray-700">{lead.currentBoat || '-'}</p></div>
            </div>
            {lead.comments && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2 mb-1"><MessageSquare className="w-3.5 h-3.5 text-gray-400" /><span className="text-xs text-gray-400">Commentaires</span></div>
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
              <div><span className="text-gray-400 text-xs">Type</span><p className="text-gray-700">{lead.boatType || '-'}</p></div>
              <div><span className="text-gray-400 text-xs">État</span><p className="text-gray-700">{lead.boatCondition || '-'}</p></div>
              <div><span className="text-gray-400 text-xs">Marque</span><p className="text-gray-700">{lead.brand || '-'}</p></div>
              <div><span className="text-gray-400 text-xs">Intérêt</span><p className="text-gray-700 font-medium">{lead.boatInterest || '-'}</p></div>
              <div><span className="text-gray-400 text-xs">Budget</span><p className="text-gray-700 font-semibold">{formatCurrency(lead.budget)}</p></div>
              <div><span className="text-gray-400 text-xs">Livraison</span><p className="text-gray-700">{formatDate(lead.deliveryDate)}</p></div>
            </div>
          </div>

          {/* Financial */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary-600" /> Financier
            </h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-gray-400 text-xs">Montant devis</span><p className="text-gray-700 font-semibold">{formatCurrency(lead.quoteAmount)}</p></div>
              <div><span className="text-gray-400 text-xs">% Réalisation</span><p className="text-gray-700">{lead.probability !== null ? `${lead.probability}%` : '-'}</p></div>
              <div><span className="text-gray-400 text-xs">Budget</span><p className="text-gray-700">{formatCurrency(lead.budget)}</p></div>
            </div>
          </div>

          {/* Actions history */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary-600" /> Historique ({actions.length})
              </h3>
              <button onClick={() => setShowActionForm(true)} className="btn-primary btn-sm"><Plus className="w-3 h-3" /> Action</button>
            </div>
            {showActionForm && (
              <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <ActionForm leadId={lead.id} onSave={(action) => { addAction(action); setShowActionForm(false); }} onCancel={() => setShowActionForm(false)} />
              </div>
            )}
            {actions.length > 0 ? (
              <div className="space-y-3">
                {actions.map(action => (
                  editingActionId === action.id ? (
                    <div key={action.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <ActionForm
                        leadId={lead.id}
                        action={action}
                        onSave={(data) => { updateAction(action.id, data); setEditingActionId(null); }}
                        onCancel={() => setEditingActionId(null)}
                      />
                    </div>
                  ) : (
                    <div key={action.id} className="group flex gap-3 text-sm border-l-2 border-primary-200 pl-4 py-1">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{ACTION_TYPES.find(a => a.value === action.type)?.label ?? action.type}</span>
                          <span className="text-xs text-gray-400">{formatDate(action.date)}</span>
                          <span className="text-xs text-gray-400">par {getCommercialName(action.authorId)}</span>
                        </div>
                        {action.result && <p className="text-gray-600 mt-0.5">{action.result}</p>}
                        {action.notes && <p className="text-gray-400 text-xs mt-0.5">{action.notes}</p>}
                      </div>
                      {/* Comme sur la liste Leads : cache-jusqu'au-survol
                          seulement sur pointeur fin — au doigt, modifier/
                          supprimer une action doivent rester accessibles. */}
                      <div className="flex items-start gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
                        <button onClick={() => setEditingActionId(action.id)} className="p-1 text-gray-400 hover:text-primary-600 rounded" title="Modifier l'action">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteAction(action.id)} className="p-1 text-gray-400 hover:text-danger-600 rounded" title="Supprimer l'action">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 py-4 text-center">Aucune action enregistrée</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Next action */}
          <div className={cn('card p-5', !hasPlannedNextAction(lead) && isActive ? 'ring-2 ring-warning-300' : '')}>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              {lead.temperature === 'chaud' && <Flame className="w-4 h-4 text-danger-500" />}
              <ExternalLink className="w-4 h-4 text-primary-600" /> Prochaine action
            </h3>
            {editingNextAction ? (
              <div className="space-y-3">
                <div>
                  <label className="label">Type</label>
                  <select className="select" value={nextActionDraft.type} onChange={e => setNextActionDraft(d => ({ ...d, type: e.target.value as ActionType | '' }))}>
                    <option value="">--</option>
                    {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Date</label>
                    <input className="input" type="date" value={nextActionDraft.date} disabled={!nextActionDraft.type} onChange={e => setNextActionDraft(d => ({ ...d, date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Heure</label>
                    <input className="input" type="time" value={nextActionDraft.time} disabled={!nextActionDraft.date} onChange={e => setNextActionDraft(d => ({ ...d, time: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Fin</label>
                    <input className="input" type="time" value={nextActionDraft.endTime} disabled={!nextActionDraft.time} onChange={e => setNextActionDraft(d => ({ ...d, endTime: e.target.value }))} />
                  </div>
                </div>
                {endTimeInvalid && (
                  <p className="text-xs text-danger-600">L'heure de fin doit être postérieure à l'heure de début.</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setEditingNextAction(false)} className="btn-secondary btn-sm">Annuler</button>
                  <button onClick={saveNextAction} disabled={!nextActionDraft.type || endTimeInvalid} className="btn-primary btn-sm disabled:opacity-50">Enregistrer</button>
                </div>
              </div>
            ) : (
              <>
                {lead.nextActionType ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Action</span>
                      <span className="text-gray-900 font-medium">{ACTION_TYPES.find(a => a.value === lead.nextActionType)?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Date</span>
                      <span className="text-gray-900">
                        {formatDate(lead.nextActionDate)}
                        {lead.nextActionTime ? (lead.nextActionEndTime ? ` de ${lead.nextActionTime} à ${lead.nextActionEndTime}` : ` à ${lead.nextActionTime}`) : ''}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-warning-600">Aucune action planifiée</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button onClick={openNextActionEditor} className="btn-secondary btn-sm">
                    {lead.nextActionType ? 'Modifier' : 'Définir'}
                  </button>
                  {lead.nextActionType && (
                    <button onClick={clearNextAction} className="btn-ghost btn-sm text-gray-500">Effacer</button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Commercial tracking */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary-600" /> Suivi commercial
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date contact</span><span className="text-gray-900">{formatDate(lead.contactDate)}</span></div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dernière action</span>
                <span className={cn(days > 14 ? 'text-danger-600 font-medium' : days > 7 ? 'text-warning-600' : 'text-gray-900')}>
                  {days === Infinity ? '-' : days === 0 ? "Aujourd'hui" : `il y a ${days}j`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Priorité</span>
                <span className={cn('badge', getPriorityInfo(lead.priority).color)}>{getPriorityInfo(lead.priority).label}</span>
              </div>
            </div>
          </div>

          {/* Milestones */}
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

function TimelineItem({ label, date, active, success, danger }: { label: string; date: string; active: boolean; success?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', active ? success ? 'bg-success-500' : danger ? 'bg-danger-500' : 'bg-primary-500' : 'bg-gray-200')} />
      <span className={cn('flex-1', active ? 'text-gray-700' : 'text-gray-400')}>{label}</span>
      <span className={cn('text-xs', active ? 'text-gray-500' : 'text-gray-300')}>{formatDate(date)}</span>
    </div>
  );
}
