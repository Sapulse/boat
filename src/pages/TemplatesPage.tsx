import { useMemo, useState, type ReactNode } from 'react';
import {
  Save, Mail, MessageSquare, MessageCircle, Check, Plus, Trash2, ChevronDown, ChevronUp, GripVertical,
  ArrowUp, ArrowDown, Pencil, X, FolderPlus,
} from 'lucide-react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useApp } from '../context/useApp';
import { TEMPLATE_VARIABLES } from '../data/constants';
import type { MessageTemplate, TemplateCategory, TemplateType } from '../data/types';
import { templatePreview } from '../lib/templates';
import {
  UNCATEGORIZED_ID, UNCATEGORIZED_NAME, groupTemplates, orderedCategories, moveTemplate, nudgeTemplate, moveCategory,
  canDeleteCategory, validateCategoryName, type TemplateGroup,
} from '../lib/templateLayout';
import { cn, generateId } from '../lib/utils';
import Repliable from '../components/ui/Repliable';

function TypeBadge({ type }: { type: TemplateType }) {
  if (type === 'email') {
    return <span className="badge bg-primary-50 text-primary-700 gap-1" title="Email"><Mail className="w-3 h-3" /><span className="hidden sm:inline">Email</span></span>;
  }
  if (type === 'whatsapp') {
    return <span className="badge bg-green-100 text-green-700 gap-1" title="WhatsApp"><MessageCircle className="w-3 h-3" /><span className="hidden sm:inline">WhatsApp</span></span>;
  }
  return <span className="badge bg-success-100 text-success-700 gap-1" title="SMS"><MessageSquare className="w-3 h-3" /><span className="hidden sm:inline">SMS</span></span>;
}

/** Transformation CSS d'un élément triable (sans dépendre de @dnd-kit/utilities). */
function sortableStyle(transform: { x: number; y: number } | null, transition: string | undefined, isDragging: boolean) {
  return {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 30 : undefined,
    position: 'relative' as const,
  };
}

/**
 * Contrôles d'ordre : poignée de glisser-déposer sur ordinateur (≥ 640 px),
 * flèches ▲▼ sur mobile (le glisser au doigt dans une longue liste est pénible).
 */
function OrderControls({ handle, label, canUp, canDown, onUp, onDown }: {
  handle: ReactNode; label: string; canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void;
}) {
  return (
    <div className="flex items-center shrink-0">
      <span className="hidden sm:inline-flex">{handle}</span>
      <span className="inline-flex sm:hidden">
        <button type="button" onClick={onUp} disabled={!canUp} aria-label={`Monter ${label}`} className="p-1.5 text-gray-500 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
        <button type="button" onClick={onDown} disabled={!canDown} aria-label={`Descendre ${label}`} className="p-1.5 text-gray-500 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
      </span>
    </div>
  );
}

/**
 * Une carte modele, REPLIABLE (7d6ac45) : en-tête toujours visible + chevron
 * `aria-expanded`, contenu en rendu conditionnel. Le brouillon vit dans ce
 * composant, qui reste monté une fois replié : replier une saisie ne la perd pas.
 * Lot 3 : poignée d'ordre (ordinateur) / flèches (mobile) + choix de la catégorie.
 */
function TemplateEditor({ template, canDelete, open, onToggle, categories, order, onMoveTo }: {
  template: MessageTemplate;
  canDelete: boolean;
  open: boolean;
  onToggle: () => void;
  categories: TemplateCategory[];
  order: { canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void };
  onMoveTo: (categoryId: string) => void;
}) {
  const { updateTemplate, deleteTemplate } = useApp();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: template.id });
  const [draft, setDraft] = useState({ title: template.title, subject: template.subject, body: template.body });
  const [saved, setSaved] = useState(false);

  const dirty = draft.title !== template.title || draft.subject !== template.subject || draft.body !== template.body;

  const save = () => {
    updateTemplate(template.id, { ...draft });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const remove = () => {
    if (confirm(`Supprimer le modèle « ${template.title} » définitivement ?`)) deleteTemplate(template.id);
  };

  const preview = templatePreview(template);
  const handle = (
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      aria-label={`Déplacer le modèle ${template.title}`} title="Glisser pour réordonner"
      className="p-1.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none">
      <GripVertical className="w-4 h-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={sortableStyle(transform, transition, isDragging)} className={cn('card overflow-hidden', isDragging && 'shadow-lg ring-2 ring-primary-200')}>
      {/* Sous 640px, DEUX lignes : ordre + badge + titre, puis les boutons. */}
      <div className="flex items-center justify-between gap-2 flex-wrap px-3 sm:px-4 py-3">
        <div className="flex items-center gap-1.5 min-w-0 w-full sm:w-auto sm:flex-1">
          <OrderControls handle={handle} label={`le modèle ${template.title}`} {...order} />
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
          {!open && dirty && <span className="badge bg-amber-100 text-amber-700 shrink-0 hidden sm:inline-flex">Non enregistré</span>}
          {!open && !dirty && preview && <span className="text-xs text-gray-400 truncate hidden md:block">{preview}</span>}
        </div>
        {(open || dirty || saved) && (
          <div className="flex items-center justify-end gap-2 w-full sm:w-auto sm:justify-start">
            {!open && dirty && <span className="badge bg-amber-100 text-amber-700 mr-auto sm:hidden">Non enregistré</span>}
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
        <div className="px-4 sm:px-5 pb-5 pt-4 space-y-4 border-t border-gray-100">
          <div className="sm:max-w-xs">
            <label className="label" htmlFor={`cat-${template.id}`}>Catégorie</label>
            <select id={`cat-${template.id}`} className="select" value={template.categoryId && categories.some(c => c.id === template.categoryId) ? template.categoryId : UNCATEGORIZED_ID} onChange={e => onMoveTo(e.target.value)}>
              <option value={UNCATEGORIZED_ID}>{UNCATEGORIZED_NAME}</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {template.type === 'email' && (
            <div>
              <label className="label">Sujet</label>
              <input className="input" value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} />
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
              <p className="text-xs text-gray-400 mt-1">Un SMS n'a pas de sujet. Pensez court : au-delà de 160 caractères, le message sera fractionné.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Une catégorie : volet repliable (replié par défaut), renommer / supprimer, modèles triables. */
function CategorySection({ group, index, count, open, onToggle, categories, allTemplates, openIds, onToggleTemplate, canDeleteTemplates, onLayout, onMoveCategory }: {
  group: TemplateGroup;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  categories: TemplateCategory[];
  allTemplates: MessageTemplate[];
  openIds: ReadonlySet<string>;
  onToggleTemplate: (id: string) => void;
  canDeleteTemplates: boolean;
  onLayout: (categories: TemplateCategory[], placements: ReturnType<typeof moveTemplate>) => void;
  onMoveCategory: (id: string, toIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `cat:${group.id || 'non-classes'}`, disabled: group.virtual });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const deletable = !group.virtual && canDeleteCategory(allTemplates, group.id);

  const commitRename = () => {
    if (renaming === null) return;
    const err = validateCategoryName(renaming, categories, group.id);
    if (err) { setError(err); return; }
    onLayout(categories.map(c => (c.id === group.id ? { ...c, name: renaming.trim() } : c)), []);
    setRenaming(null);
    setError(null);
  };
  const remove = () => {
    if (!deletable) return;
    if (confirm(`Supprimer la catégorie « ${group.name} » ? (elle est vide, aucun modèle n'est touché)`)) {
      onLayout(orderedCategories(categories.filter(c => c.id !== group.id)).map((c, i) => ({ ...c, position: i })), []);
    }
  };
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = group.templates.findIndex(t => t.id === e.over!.id);
    onLayout(categories, moveTemplate(allTemplates, categories, String(e.active.id), group.id, to));
  };

  const catHandle = (
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      aria-label={`Déplacer la catégorie ${group.name}`} title="Glisser pour réordonner les catégories"
      className="p-1.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none">
      <GripVertical className="w-4 h-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={sortableStyle(transform, transition, isDragging)}
      className={cn('rounded-xl border border-gray-200 bg-gray-50/60', isDragging && 'shadow-lg')}>
      <div className="flex items-center gap-1 px-2 sm:px-3 py-2">
        {!group.virtual && (
          <OrderControls handle={catHandle} label={`la catégorie ${group.name}`}
            canUp={index > 0} canDown={index < categories.length - 1}
            onUp={() => onMoveCategory(group.id, index - 1)} onDown={() => onMoveCategory(group.id, index + 1)} />
        )}
        {renaming !== null ? (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <input autoFocus className="input flex-1 min-w-0" value={renaming} maxLength={60} aria-label="Nom de la catégorie"
                onChange={e => { setRenaming(e.target.value); setError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(null); setError(null); } }} />
              <button type="button" onClick={commitRename} className="btn-primary btn-sm"><Check className="w-3.5 h-3.5" /> OK</button>
              <button type="button" onClick={() => { setRenaming(null); setError(null); }} aria-label="Annuler" className="btn-ghost btn-sm"><X className="w-4 h-4" /></button>
            </div>
            {error && <p className="text-xs text-danger-600 mt-1">{error}</p>}
          </div>
        ) : (
          <Repliable
            className="flex-1 min-w-0"
            open={open}
            onToggle={onToggle}
            label={`la catégorie ${group.name}`}
            title={(
              <span className="flex items-center gap-2 min-w-0">
                <span className={cn('font-semibold truncate', group.virtual ? 'text-gray-500 italic' : 'text-gray-900')}>{group.name}</span>
                <span className="badge bg-white border border-gray-200 text-gray-500 shrink-0">{count}</span>
              </span>
            )}
            aside={!group.virtual && (
              <div className="flex items-center shrink-0">
                <button type="button" onClick={() => setRenaming(group.name)} aria-label={`Renommer la catégorie ${group.name}`} title="Renommer" className="p-2 text-gray-400 hover:text-gray-700"><Pencil className="w-4 h-4" /></button>
                <button type="button" onClick={remove} disabled={!deletable} aria-label={`Supprimer la catégorie ${group.name}`}
                  title={deletable ? 'Supprimer la catégorie (vide)' : 'Catégorie non vide : déplacez d\'abord ses modèles'}
                  className="p-2 text-gray-400 hover:text-danger-600 disabled:opacity-30 disabled:hover:text-gray-400"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          >
            <span className="sr-only">{group.name}</span>
          </Repliable>
        )}
      </div>
      {open && renaming === null && (
        <div className="px-2 sm:px-3 pb-3 space-y-2">
          {group.templates.length === 0 && (
            <p className="text-sm text-gray-400 px-2 py-3">Aucun modèle. Ouvrez un modèle et choisissez « {group.name} » comme catégorie.</p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={group.templates.map(t => t.id)} strategy={verticalListSortingStrategy}>
              {group.templates.map((t, i) => (
                <TemplateEditor
                  key={t.id}
                  template={t}
                  canDelete={canDeleteTemplates}
                  open={openIds.has(t.id)}
                  onToggle={() => onToggleTemplate(t.id)}
                  categories={categories}
                  order={{
                    canUp: i > 0,
                    canDown: i < group.templates.length - 1,
                    onUp: () => onLayout(categories, nudgeTemplate(allTemplates, categories, t.id, -1)),
                    onDown: () => onLayout(categories, nudgeTemplate(allTemplates, categories, t.id, 1)),
                  }}
                  onMoveTo={(catId) => onLayout(categories, moveTemplate(allTemplates, categories, t.id, catId, 0))}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

export default function TemplatesPage() {
  const { state, addTemplate, saveTemplateLayout } = useApp();
  const categories = useMemo(() => orderedCategories(state.templateCategories), [state.templateCategories]);
  const groups = useMemo(() => groupTemplates(state.templates, categories), [state.templates, categories]);

  // Catégories et modèles DÉPLIÉS, par id. Tout est REPLIÉ à l'ouverture de la
  // page (c'est le but : voir la liste). Non persisté.
  const [openCats, setOpenCats] = useState<ReadonlySet<string>>(() => new Set());
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [newCat, setNewCat] = useState<string | null>(null);
  const [newCatError, setNewCatError] = useState<string | null>(null);

  const toggleIn = (set: (f: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string) => set(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const TEMPLATE_TITLES: Record<TemplateType, string> = {
    email: 'Nouveau modèle email',
    sms: 'Nouveau modèle SMS',
    whatsapp: 'Nouveau modèle WhatsApp',
  };

  // Nouveau modèle : « Non classés », EN TÊTE (position 0 + date la plus récente),
  // volet ouvert pour qu'on le voie tout de suite.
  const createTemplate = (type: TemplateType) => {
    const id = addTemplate({ type, title: TEMPLATE_TITLES[type], subject: '', body: '', position: 0 });
    setOpenCats(prev => new Set(prev).add(UNCATEGORIZED_ID));
    setOpenIds(prev => new Set(prev).add(id));
  };

  const createCategory = () => {
    if (newCat === null) return;
    const err = validateCategoryName(newCat, categories);
    if (err) { setNewCatError(err); return; }
    const id = generateId();
    saveTemplateLayout([...categories, { id, name: newCat.trim(), position: categories.length }], []);
    setOpenCats(prev => new Set(prev).add(id));
    setNewCat(null);
    setNewCatError(null);
  };

  const onMoveCategory = (id: string, toIndex: number) => saveTemplateLayout(moveCategory(categories, id, toIndex), []);
  const handleCategoryDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = String(e.active.id).slice(4);
    const to = categories.findIndex(c => `cat:${c.id}` === e.over!.id);
    if (to !== -1) onMoveCategory(from, to);
  };

  const canDeleteTemplates = state.templates.length > 1;
  const realGroups = groups.filter(g => !g.virtual);
  const uncategorized = groups.find(g => g.virtual);
  const renderGroup = (g: TemplateGroup, index: number) => (
    <CategorySection
      key={g.id || 'non-classes'}
      group={g}
      index={index}
      count={g.templates.length}
      open={openCats.has(g.id)}
      onToggle={() => toggleIn(setOpenCats, g.id)}
      categories={categories}
      allTemplates={state.templates}
      openIds={openIds}
      onToggleTemplate={(id) => toggleIn(setOpenIds, id)}
      canDeleteTemplates={canDeleteTemplates}
      onLayout={saveTemplateLayout}
      onMoveCategory={onMoveCategory}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Modèles de message</h1>
          <p className="text-sm text-gray-500 mt-1">
            Rangés par catégorie, dans l'ordre choisi par l'équipe — le même ordre que dans la fiche d'un lead.
            Glissez pour réordonner (flèches sur téléphone).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setNewCat(''); setNewCatError(null); }} className="btn-secondary btn-sm">
            <FolderPlus className="w-4 h-4" /> Catégorie
          </button>
          <button onClick={() => createTemplate('email')} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> Modèle email</button>
          <button onClick={() => createTemplate('sms')} className="btn-secondary btn-sm"><Plus className="w-4 h-4" /> Modèle SMS</button>
          <button onClick={() => createTemplate('whatsapp')} className="btn-secondary btn-sm"><Plus className="w-4 h-4" /> Modèle WhatsApp</button>
        </div>
      </div>

      <div className="card p-4">
        <p className="text-xs font-medium text-gray-600 mb-2">Variables disponibles (remplacées automatiquement à l'envoi, email comme SMS) :</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_VARIABLES.map(v => (
            <span key={v.key} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
              <code className="text-primary-600 font-mono">{`{{${v.key}}}`}</code>
              <span className="text-gray-400">{v.label}</span>
            </span>
          ))}
        </div>
      </div>

      {newCat !== null && (
        <div className="card p-3">
          <label className="label" htmlFor="new-category">Nouvelle catégorie</label>
          <div className="flex items-center gap-2">
            <input id="new-category" autoFocus className="input flex-1 min-w-0" maxLength={60} value={newCat} placeholder="Ex. Prise de contact, Devis, Après-vente"
              onChange={e => { setNewCat(e.target.value); setNewCatError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') createCategory(); if (e.key === 'Escape') setNewCat(null); }} />
            <button type="button" onClick={createCategory} className="btn-primary btn-sm">Créer</button>
            <button type="button" onClick={() => setNewCat(null)} aria-label="Annuler" className="btn-ghost btn-sm"><X className="w-4 h-4" /></button>
          </div>
          {newCatError && <p className="text-xs text-danger-600 mt-1">{newCatError}</p>}
        </div>
      )}

      <div className="space-y-3">
        {/* « Non classés » : virtuel, toujours en tête, non déplaçable. */}
        {uncategorized && renderGroup(uncategorized, -1)}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
          <SortableContext items={realGroups.map(g => `cat:${g.id}`)} strategy={verticalListSortingStrategy}>
            {realGroups.map((g, i) => renderGroup(g, i))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
