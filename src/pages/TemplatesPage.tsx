import { useState } from 'react';
import { Save, RotateCcw, Mail, Check } from 'lucide-react';
import { useApp } from '../context/useApp';
import { EMAIL_TEMPLATE_VARIABLES, DEFAULT_EMAIL_TEMPLATES } from '../data/constants';
import type { EmailTemplate } from '../data/types';

function TemplateEditor({ template }: { template: EmailTemplate }) {
  const { updateEmailTemplate } = useApp();
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

  const flashSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 1200); };

  const save = () => {
    updateEmailTemplate(template.id, { ...draft });
    flashSaved();
  };

  const reset = () => {
    const def = DEFAULT_EMAIL_TEMPLATES.find(t => t.id === template.id);
    if (!def) return;
    const next = { title: def.title, subject: def.subject, body: def.body };
    setDraft(next);
    updateEmailTemplate(template.id, next);
    flashSaved();
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary-600" />
          <input
            className="input font-semibold text-gray-900 max-w-xs"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="btn-ghost btn-sm text-gray-500" title="Restaurer le modèle par défaut">
            <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser
          </button>
          <button onClick={save} disabled={!dirty && !saved} className="btn-primary btn-sm disabled:opacity-60">
            {saved ? <><Check className="w-3.5 h-3.5" /> Enregistré</> : <><Save className="w-3.5 h-3.5" /> Enregistrer</>}
          </button>
        </div>
      </div>

      <div>
        <label className="label">Sujet</label>
        <input
          className="input"
          value={draft.subject}
          onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
        />
      </div>

      <div>
        <label className="label">Corps</label>
        <textarea
          className="input min-h-[180px] font-mono text-sm"
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
        />
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { state } = useApp();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Modèles d'email</h1>
        <p className="text-sm text-gray-500 mt-1">
          Éditez les modèles utilisés depuis la fiche d'un lead. Les modifications sont enregistrées localement.
        </p>
      </div>

      {/* Aide variables */}
      <div className="card p-4">
        <p className="text-xs font-medium text-gray-600 mb-2">
          Variables disponibles (remplacées automatiquement à l'envoi) :
        </p>
        <div className="flex flex-wrap gap-2">
          {EMAIL_TEMPLATE_VARIABLES.map(v => (
            <span key={v.key} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
              <code className="text-primary-600 font-mono">{`{{${v.key}}}`}</code>
              <span className="text-gray-400">{v.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {state.emailTemplates.map(t => (
          <TemplateEditor key={t.id} template={t} />
        ))}
      </div>
    </div>
  );
}
