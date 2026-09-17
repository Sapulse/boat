import type { MessageTemplate, TemplateCategory, TemplateType } from '../data/types.js';
// Suffixe .js : ce module est aussi chargé par l'API (restauration) en ESM Node.

// ===========================================================================
// Lot 3 — rangement des modèles de message : catégories + ordre MANUEL.
// Module PUR (sans React ni I/O), prouvé par scripts/harness-template-layout.ts.
// La page Modèles ET les menus de la fiche lead lisent l'ordre ICI, et nulle
// part ailleurs : un même state donne partout le même ordre.
//
//  - « Non classés » est une catégorie VIRTUELLE (id ''), toujours en tête, non
//    renommable, non supprimable : ce sont les modèles sans catégorie (ou dont la
//    catégorie n'existe plus).
//  - Ordre dans une catégorie : `position` croissante, puis « plus récent
//    d'abord » (createdAt décroissant), puis id. Tant qu'aucun rangement n'a été
//    fait (toutes les positions à 0), on retrouve donc l'ordre d'avant le lot.
//  - Supprimer une catégorie NON VIDE est interdit (jamais de modèle supprimé ni
//    déplacé en silence).
// ===========================================================================

export const UNCATEGORIZED_ID = '';
export const UNCATEGORIZED_NAME = 'Non classés';

export interface TemplateGroup {
  /** '' pour « Non classés ». */
  id: string;
  name: string;
  virtual: boolean;
  templates: MessageTemplate[];
}

const byCategoryOrder = (a: TemplateCategory, b: TemplateCategory) =>
  a.position - b.position || a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id);

/** Catégories réelles dans l'ordre manuel. Ne mute pas l'entrée. */
export function orderedCategories(categories: readonly TemplateCategory[] | undefined): TemplateCategory[] {
  return [...(categories ?? [])].sort(byCategoryOrder);
}

/** Ordre total et déterministe des modèles d'une même catégorie. */
export function compareTemplates(a: MessageTemplate, b: MessageTemplate): number {
  const pa = a.position ?? 0;
  const pb = b.position ?? 0;
  if (pa !== pb) return pa - pb;
  const da = a.createdAt ?? '';
  const db = b.createdAt ?? '';
  if (da !== db) return da < db ? 1 : -1; // plus récent d'abord (ordre d'avant le lot 3)
  return a.id.localeCompare(b.id);
}

/** Catégorie effective d'un modèle : '' si absente ou inconnue (catégorie supprimée ailleurs). */
export function effectiveCategoryId(t: Pick<MessageTemplate, 'categoryId'>, known: ReadonlySet<string>): string {
  return t.categoryId && known.has(t.categoryId) ? t.categoryId : UNCATEGORIZED_ID;
}

/**
 * Groupes affichés : « Non classés » en tête puis les catégories dans l'ordre
 * manuel ; chaque groupe trié. `type` : seulement les modèles de ce canal (menus
 * de la fiche). `hideEmpty` : masque les groupes vides (menus de la fiche) ; la
 * page Modèles les garde (catégorie qu'on vient de créer). « Non classés » vide
 * est masqué dès qu'il existe au moins une catégorie réelle, sauf `keepUncategorized`.
 */
export function groupTemplates(
  templates: readonly MessageTemplate[],
  categories: readonly TemplateCategory[] | undefined,
  opts: { type?: TemplateType; hideEmpty?: boolean; keepUncategorized?: boolean } = {},
): TemplateGroup[] {
  const cats = orderedCategories(categories);
  const known = new Set(cats.map(c => c.id));
  const list = opts.type ? templates.filter(t => t.type === opts.type) : [...templates];
  const groups: TemplateGroup[] = [
    { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_NAME, virtual: true, templates: [] },
    ...cats.map(c => ({ id: c.id, name: c.name, virtual: false, templates: [] as MessageTemplate[] })),
  ];
  const byId = new Map(groups.map(g => [g.id, g]));
  for (const t of list) byId.get(effectiveCategoryId(t, known))!.templates.push(t);
  for (const g of groups) g.templates.sort(compareTemplates);
  return groups.filter(g => {
    if (g.templates.length > 0) return true;
    if (opts.hideEmpty) return false;
    if (g.virtual) return !!opts.keepUncategorized || cats.length === 0;
    return true;
  });
}

/** Tous les modèles dans l'ordre d'affichage global (groupes aplatis). */
export function orderedTemplates(templates: readonly MessageTemplate[], categories: readonly TemplateCategory[] | undefined): MessageTemplate[] {
  return groupTemplates(templates, categories, { keepUncategorized: true }).flatMap(g => g.templates);
}

// ---------------------------------------------------------------------------
// Mutations pures : renvoient les NOUVELLES positions (seules les lignes qui
// changent), prêtes pour le reducer. Positions renumérotées 0..n-1.
// ---------------------------------------------------------------------------

export interface TemplatePlacement { id: string; categoryId: string; position: number }

function renumber(group: MessageTemplate[], categoryId: string): TemplatePlacement[] {
  return group.map((t, i) => ({ id: t.id, categoryId, position: i }));
}

/** Déplace un élément d'un tableau (copie). Index bornés. */
export function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x);
  return out;
}

/**
 * Place un modèle dans `toCategoryId` à l'index `toIndex` (dans l'ordre affiché
 * de cette catégorie, le modèle retiré). Renvoie les placements de la catégorie
 * d'arrivée ET de celle de départ (renumérotées). Modèle inconnu : [].
 */
export function moveTemplate(
  templates: readonly MessageTemplate[],
  categories: readonly TemplateCategory[] | undefined,
  templateId: string,
  toCategoryId: string,
  toIndex: number,
): TemplatePlacement[] {
  const known = new Set((categories ?? []).map(c => c.id));
  const moving = templates.find(t => t.id === templateId);
  if (!moving) return [];
  const target = toCategoryId && known.has(toCategoryId) ? toCategoryId : UNCATEGORIZED_ID;
  const from = effectiveCategoryId(moving, known);
  const inCat = (cat: string) => templates.filter(t => t.id !== templateId && effectiveCategoryId(t, known) === cat).sort(compareTemplates);
  const dest = inCat(target);
  dest.splice(Math.max(0, Math.min(toIndex, dest.length)), 0, moving);
  const out = renumber(dest, target);
  if (from !== target) out.push(...renumber(inCat(from), from));
  return out;
}

/** Monte (-1) ou descend (+1) un modèle dans sa catégorie (flèches mobile). */
export function nudgeTemplate(templates: readonly MessageTemplate[], categories: readonly TemplateCategory[] | undefined, templateId: string, delta: -1 | 1): TemplatePlacement[] {
  const known = new Set((categories ?? []).map(c => c.id));
  const t = templates.find(x => x.id === templateId);
  if (!t) return [];
  const cat = effectiveCategoryId(t, known);
  const group = templates.filter(x => effectiveCategoryId(x, known) === cat).sort(compareTemplates);
  const from = group.findIndex(x => x.id === templateId);
  const to = from + delta;
  if (to < 0 || to >= group.length) return [];
  return renumber(arrayMove(group, from, to), cat);
}

/** Nouvel ordre des catégories après déplacement de `categoryId` à `toIndex`. */
export function moveCategory(categories: readonly TemplateCategory[] | undefined, categoryId: string, toIndex: number): TemplateCategory[] {
  const cats = orderedCategories(categories);
  const from = cats.findIndex(c => c.id === categoryId);
  if (from === -1) return cats;
  return arrayMove(cats, from, toIndex).map((c, i) => ({ ...c, position: i }));
}

/** Nombre de modèles rangés dans une catégorie (tous canaux). */
export function templatesInCategory(templates: readonly MessageTemplate[], categoryId: string): number {
  return templates.filter(t => t.categoryId === categoryId).length;
}

/** Suppression autorisée seulement si la catégorie est VIDE (jamais de modèle perdu ni déplacé en silence). */
export function canDeleteCategory(templates: readonly MessageTemplate[], categoryId: string): boolean {
  return !!categoryId && templatesInCategory(templates, categoryId) === 0;
}

/** Nom de catégorie valide : non vide, ≤ 60 caractères, pas « Non classés », pas de doublon (casse ignorée). */
export function validateCategoryName(name: string, categories: readonly TemplateCategory[] | undefined, selfId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Donnez un nom à la catégorie.';
  if (n.length > 60) return 'Nom trop long (60 caractères au plus).';
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (fold(n) === fold(UNCATEGORIZED_NAME)) return '« Non classés » est réservé.';
  if ((categories ?? []).some(c => c.id !== selfId && fold(c.name) === fold(n))) return 'Une catégorie porte déjà ce nom.';
  return null;
}

/**
 * Restauration : la base remet `createdAt` à l'heure de la restauration (constat
 * du 16/09), ce qui détruirait l'ordre « plus récent d'abord » des modèles jamais
 * rangés. On FIGE donc l'ordre d'affichage du fichier : dans chaque catégorie,
 * tri par `compareTemplates` (positions et dates DU FICHIER), puis position =
 * rang. Vaut pour une sauvegarde d'avant le lot 3 (aucune position) comme
 * d'après. Les catégories inconnues du fichier retombent dans « Non classés ».
 */
export function positionsFromBackup<T extends MessageTemplate>(templates: readonly T[], categories: readonly TemplateCategory[] | undefined): (T & { position: number; categoryId?: string })[] {
  const known = new Set((categories ?? []).map(c => c.id));
  const rank = new Map<string, number>();
  const groups = new Map<string, T[]>();
  for (const t of templates) {
    const cat = effectiveCategoryId(t, known);
    groups.set(cat, [...(groups.get(cat) ?? []), t]);
  }
  // Tri STABLE : à position et date égales (ou absentes), l'ordre du fichier fait foi.
  const stable = (a: T, b: T) => {
    const pa = a.position ?? 0; const pb = b.position ?? 0;
    if (pa !== pb) return pa - pb;
    const da = a.createdAt ?? ''; const db = b.createdAt ?? '';
    return da === db ? 0 : da < db ? 1 : -1;
  };
  for (const g of groups.values()) [...g].sort(stable).forEach((t, i) => rank.set(t.id, i));
  return templates.map(t => {
    const cat = effectiveCategoryId(t, known);
    return { ...t, categoryId: cat || undefined, position: rank.get(t.id) ?? 0 };
  });
}
