import { useMemo, useState } from 'react';
import { Save, Mail, MessageSquare, MessageCircle, Check, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../context/useApp';
import { TEMPLATE_VARIABLES } from '../data/constants';
import type { MessageTemplate, TemplateType } from '../data/types';
import { sortTemplatesByNewest, templatePreview } from '../lib/templates';
import { cn } from '../lib/utils';

function TypeBadge({ type }: { type: TemplateType }) {
  if (type === 'email') {
    return <span className="badge bg-primary-50 text-primary-700 gap-1"><Mail className="w-3 h-3" /> Email</span>;
  }
  if (type === 'whatsapp') {
    return <span className="badge bg-green-100 text-green-700 gap-1"><MessageCircle className="w-3 h-3" /> WhatsApp</span>;
  }
  return <span className="badge bg-success-100 text-success-700 gap-1"><MessageSquare className="w-3 h-3" /> SMS</span>;
}

/**
 * Une carte modele, REPLIABLE (retour terrain BOB : la page affichait tous les
 * corps de message en permanence, illisible des qu'il y a plus de trois
 * modeles). Meme patron que la zone de saisie d'ObjectifsPage : en-tete toujours
 * visible + bouton chevron `aria-expanded`, contenu en rendu conditionnel.
 *
 * Pas de <details>/<summary> ici, contrairement au reste de l'app : l'en-tete
 * porte des BOUTONS (enregistrer, supprimer) et un champ de saisie (le titre),
 * qu'on ne peut pas imbriquer dans un <summary> sans casser le clic et
 * l'accessibilite. Seul le couple chevron + badge declenche donc le repli.
 *
 * Le brouillon (`draft`) vit dans ce composant, qui reste MONTE une fois replie :
 * replier une saisie en cours ne la perd pas — l'en-tete la signale meme
 * explicitement, et le bouton d'enregistrement reste accessible.
 */
function TemplateEditor({ template, canDelete, open, onToggle }: {
  template: MessageTemplate;
  canDelete: boolean;
  open: boolean;
  onToggle: () => void;
}) {
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

  const preview = templatePreview(template);

  return (
    <div className="card overflow-hidden">
      {/* Sous 640px, DEUX lignes : badge + titre en pleine largeur, puis les
          boutons. Sur une seule ligne, `flex-1` (base 0) laissait les boutons
          ecraser le titre a ~26px, illisible et colle a « Supprimer ». Le
          `w-full` force le retour a la ligne ; >= 640px strictement inchange. */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4">
        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Replier' : 'Déplier'} le modèle ${template.title}`}
            className="flex items-center gap-2 shrink-0 text-gray-400 hover:text-gray-600"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <TypeBadge type={template.type} />
          </button>
          <input
            className="input font-semibold text-gray-900 min-w-0 flex-1 sm:flex-initial sm:max-w-xs"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            aria-label="Nom du modèle"
          />
          {/* REPLIE : de quoi reconnaitre le modele sans le deplier — et surtout
              ne jamais laisser croire qu'une saisie en cours a ete perdue. */}
          {!open && dirty && (
            <span className="badge bg-amber-100 text-amber-700 shrink-0 hidden sm:inline-flex">Non enregistré</span>
          )}
          {!open && !dirty && preview && (
            <span className="text-xs text-gray-400 truncate hidden md:block">{preview}</span>
          )}
        </div>
        {/* Replie et rien a enregistrer : aucun bouton. Une liste repliee doit se
            lire d'un coup d'oeil, pas presenter deux boutons par ligne. */}
        {(open || dirty || saved) && (
          <div className="flex items-center justify-end gap-2 w-full sm:w-auto sm:justify-start">
            {/* Mobile : le badge descend sur la ligne des boutons, sinon il ecrase
                le titre replie (~80px). Desktop : il reste a cote du titre. */}
            {!open && dirty && (
              <span className="badge bg-amber-100 text-amber-700 mr-auto sm:hidden">Non enregistré</span>
            )}
            {open && (
              <button
                onClick={remove}
                disabled={!canDelete}
                className="btn-ghost btn-sm text-gray-400 hover:text-danger-600 disabled:opacity-40 disabled:hover:text-gray-400"
                title={canDelete ? 'Supprimer ce modèle' : 'Au moins un modèle est requis'}
              >
                <Trash2 className="w-3.5 h-3.5" /> Supprimer
              </button>
            )}
            <button onClick={save} disabled={!dirty && !saved} className="btn-primary btn-sm disabled:opacity-60">
              {saved ? <><Check className="w-3.5 h-3.5" /> Enregistré</> : <><Save className="w-3.5 h-3.5" /> Enregistrer</>}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="px-5 pb-5 pt-4 space-y-4 border-t border-gray-100">
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
            <label className="label">{template.type === 'email' ? 'Corps' : 'Message'}</label>
            <textarea
              className={cn('input font-mono text-sm', template.type === 'email' ? 'min-h-[180px]' : 'min-h-[100px]')}
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
      )}
    </div>
  );
}

export default function TemplatesPage() {
  const { state, addTemplate } = useApp();

  // Modeles DEPLIES, par id. Tout est replie a l'ouverture de la page (c'est le
  // but : voir la liste, pas les contenus) ; plusieurs modeles peuvent etre
  // ouverts en meme temps — on compare souvent deux modeles. Etat volontairement
  // NON persiste : il ne survit pas a la navigation, et c'est tres bien ainsi.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) => setOpenIds(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const TEMPLATE_TITLES: Record<TemplateType, string> = {
    email: 'Nouveau modèle email',
    sms: 'Nouveau modèle SMS',
    whatsapp: 'Nouveau modèle WhatsApp',
  };

  const createTemplate = (type: TemplateType) => {
    const id = addTemplate({
      type,
      title: TEMPLATE_TITLES[type],
      subject: '',
      body: '',
    });
    // DEPLIE d'office : un modele qu'on vient de creer est vide, l'ajouter
    // replie donnerait l'impression qu'il ne s'est rien passe. Il arrive en tete
    // de liste (tri par date de creation), donc sous les yeux.
    setOpenIds(prev => new Set(prev).add(id));
  };

  const canDelete = state.templates.length > 1;

  // Dernier créé EN PREMIER (retour terrain BOB) : un modèle qu'on vient
  // d'ajouter était relégué en bas de page. Tri à l'affichage seulement — le
  // state, lui, reste dans son ordre d'insertion.
  const ordered = useMemo(() => sortTemplatesByNewest(state.templates), [state.templates]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Modèles de message</h1>
          <p className="text-sm text-gray-500 mt-1">
            Modèles email, SMS et WhatsApp utilisés depuis la fiche d'un lead. Les plus récents en haut ;
            cliquez sur le chevron d'un modèle pour le déplier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => createTemplate('email')} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Modèle email
          </button>
          <button onClick={() => createTemplate('sms')} className="btn-secondary btn-sm">
            <Plus className="w-4 h-4" /> Modèle SMS
          </button>
          <button onClick={() => createTemplate('whatsapp')} className="btn-secondary btn-sm">
            <Plus className="w-4 h-4" /> Modèle WhatsApp
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

      <div className="space-y-3">
        {ordered.map(t => (
          <TemplateEditor
            key={t.id}
            template={t}
            canDelete={canDelete}
            open={openIds.has(t.id)}
            onToggle={() => toggle(t.id)}
          />
        ))}
      </div>
    </div>
  );
}
