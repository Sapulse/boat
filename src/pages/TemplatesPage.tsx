import { useState } from 'react';
import { Save, Mail, MessageSquare, Check, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../context/useApp';
import { TEMPLATE_VARIABLES } from '../data/constants';
import type { MessageTemplate, TemplateType } from '../data/types';
import { cn } from '../lib/utils';

function TypeBadge({ type }: { type: TemplateType }) {
  return type === 'email' ? (
    <span className="badge bg-primary-50 text-primary-700 gap-1"><Mail className="w-3 h-3" /> Email</span>
  ) : (
    <span className="badge bg-success-100 text-success-700 gap-1"><MessageSquare className="w-3 h-3" /> SMS</span>
  );
}

function TemplateEditor({ template, canDelete }: { template: MessageTemplate; canDelete: boolean }) {
  const { updateTemplate, deleteTemplate } = useApp();
  const [draft, setDraft] = useState({
    title: template.title,
    subject: template.subject,
    body: template.body,
  });
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.title !== template.title ||
    draft.subject !== template.subject ||
    draft.body !== template.body;

  const save = () => {
    updateTemplate(template.id, { ...draft });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const remove = () => {
    if (confirm(`Supprimer le modèle « ${template.title} » définitivement ?`)) {
      deleteTemplate(template.id);
    }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TypeBadge type={template.type} />
          <input
            className="input font-semibold text-gray-900 max-w-xs"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            aria-label="Nom du modèle"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={remove}
            disabled={!canDelete}
            className="btn-ghost btn-sm text-gray-400 hover:text-danger-600 disabled:opacity-40 disabled:hover:text-gray-400"
            title={canDelete ? 'Supprimer ce modèle' : 'Au moins un modèle est requis'}
          >
            <Trash2 className="w-3.5 h-3.5" /> Supprimer
          </button>
          <button onClick={save} disabled={!dirty && !saved} className="btn-primary btn-sm disabled:opacity-60">
            {saved ? <><Check className="w-3.5 h-3.5" /> Enregistré</> : <><Save className="w-3.5 h-3.5" /> Enregistrer</>}
          </button>
        </div>
      </div>

      {template.type === 'email' && (
        <div>
          <label className="label">Sujet</label>
          <input
            className="input"
            value={draft.subject}
            onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
          />
        </div>
      )}

      <div>
        <label className="label">{template.type === 'sms' ? 'Message' : 'Corps'}</label>
        <textarea
          className={cn('input font-mono text-sm', template.type === 'sms' ? 'min-h-[100px]' : 'min-h-[180px]')}
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
        />
        {template.type === 'sms' && (
          <p className="text-xs text-gray-400 mt-1">
            Un SMS n'a pas de sujet. Pensez court : au-delà de 160 caractères, le message sera fractionné.
          </p>
        )}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { state, addTemplate } = useApp();

  const createTemplate = (type: TemplateType) => {
    addTemplate({
      type,
      title: type === 'email' ? 'Nouveau modèle email' : 'Nouveau modèle SMS',
      subject: '',
      body: '',
    });
  };

  const canDelete = state.templates.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Modèles de message</h1>
          <p className="text-sm text-gray-500 mt-1">
            Modèles email et SMS utilisés depuis la fiche d'un lead. Les modifications sont enregistrées localement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => createTemplate('email')} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Modèle email
          </button>
          <button onClick={() => createTemplate('sms')} className="btn-secondary btn-sm">
            <Plus className="w-4 h-4" /> Modèle SMS
          </button>
        </div>
      </div>

      {/* Aide variables */}
      <div className="card p-4">
        <p className="text-xs font-medium text-gray-600 mb-2">
          Variables disponibles (remplacées automatiquement à l'envoi, email comme SMS) :
        </p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_VARIABLES.map(v => (
            <span key={v.key} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
              <code className="text-primary-600 font-mono">{`{{${v.key}}}`}</code>
              <span className="text-gray-400">{v.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {state.templates.map(t => (
          <TemplateEditor key={t.id} template={t} canDelete={canDelete} />
        ))}
      </div>
    </div>
  );
}
