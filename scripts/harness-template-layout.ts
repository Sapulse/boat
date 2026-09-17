/**
 * Harnais lot 3 — rangement des modèles (src/lib/templateLayout.ts), logique PURE + vrai reducer.
 *
 * Exécution : npx tsx scripts/harness-template-layout.ts
 */
import {
  UNCATEGORIZED_ID, UNCATEGORIZED_NAME, groupTemplates, orderedTemplates, orderedCategories, compareTemplates,
  moveTemplate, nudgeTemplate, moveCategory, canDeleteCategory, validateCategoryName, positionsFromBackup, arrayMove,
} from '../src/lib/templateLayout';
import { reducer } from '../src/context/appReducer';
import type { AppState, MessageTemplate, TemplateCategory } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const tpl = (id: string, over: Partial<MessageTemplate> = {}): MessageTemplate =>
  ({ id, type: 'email', title: id, subject: '', body: '', createdAt: `2026-08-0${id.length % 9 + 1}T10:00:00.000Z`, ...over });
const ids = (list: { id: string }[]) => list.map(x => x.id).join(',');

section('Avant tout rangement : ordre d\'avant le lot 3 (plus récent d\'abord), tout « Non classés »');
{
  const list = [tpl('a', { createdAt: '2026-07-30T09:00:00Z' }), tpl('b', { createdAt: '2026-08-05T11:57:00Z' }), tpl('c', { createdAt: '2026-07-31T14:05:00Z' })];
  const groups = groupTemplates(list, []);
  check('un seul groupe « Non classés » (virtuel)', groups.length === 1 && groups[0].id === UNCATEGORIZED_ID && groups[0].name === UNCATEGORIZED_NAME && groups[0].virtual);
  check('ordre = plus récent d\'abord', ids(groups[0].templates) === 'b,c,a', ids(groups[0].templates));
  check('aucun modèle perdu', orderedTemplates(list, undefined).length === 3);
  check('date égale : départage par id (ordre total)', compareTemplates(tpl('x', { createdAt: 'z' }), tpl('y', { createdAt: 'z' })) < 0);
}

section('Catégories : « Non classés » en tête, puis ordre manuel ; même ordre partout');
{
  const cats: TemplateCategory[] = [{ id: 'devis', name: 'Devis', position: 1 }, { id: 'contact', name: 'Prise de contact', position: 0 }];
  const list = [
    tpl('t1', { categoryId: 'devis', position: 1 }), tpl('t2', { categoryId: 'devis', position: 0 }),
    tpl('t3', { categoryId: 'contact', position: 0 }), tpl('t4'), tpl('t5', { categoryId: 'supprimee' }),
    tpl('s1', { type: 'sms', categoryId: 'devis', position: 2 }),
  ];
  const groups = groupTemplates(list, cats);
  check('ordre des groupes : Non classés, Prise de contact, Devis', groups.map(g => g.name).join(' | ') === 'Non classés | Prise de contact | Devis');
  check('catégorie inconnue -> « Non classés »', ids(groups[0].templates).split(',').sort().join() === 't4,t5');
  check('ordre manuel dans la catégorie', ids(groups[2].templates) === 't2,t1,s1');
  const emailOnly = groupTemplates(list, cats, { type: 'email', hideEmpty: true });
  check('menu Email de la fiche : même ordre, SMS exclus', emailOnly.map(g => `${g.name}:${ids(g.templates)}`).join(' | ') === 'Non classés:t4,t5 | Prise de contact:t3 | Devis:t2,t1', emailOnly.map(g => `${g.name}:${ids(g.templates)}`).join(' | '));
  const smsOnly = groupTemplates(list, cats, { type: 'sms', hideEmpty: true });
  check('menu SMS : catégories vides masquées', smsOnly.length === 1 && smsOnly[0].name === 'Devis');
  const emptyCat = groupTemplates([tpl('z', { categoryId: 'devis' })], cats);
  check('page Modèles : catégorie vide gardée, « Non classés » vide masqué quand il y a des catégories', emptyCat.map(g => g.name).join('|') === 'Prise de contact|Devis');
  check('page Modèles : « Non classés » gardé si demandé', groupTemplates([], cats, { keepUncategorized: true })[0].id === UNCATEGORIZED_ID);
  check('orderedCategories ne mute pas l\'entrée', orderedCategories(cats)[0].id === 'contact' && cats[0].id === 'devis');
}

section('Déplacements : renumérotation 0..n-1, aucun modèle perdu');
{
  const cats: TemplateCategory[] = [{ id: 'devis', name: 'Devis', position: 0 }];
  const list = [tpl('a'), tpl('bb'), tpl('ccc', { categoryId: 'devis', position: 0 }), tpl('dddd', { categoryId: 'devis', position: 1 })];
  const apply = (l: MessageTemplate[], pl: { id: string; categoryId: string; position: number }[]) =>
    l.map(t => { const p = pl.find(x => x.id === t.id); return p ? { ...t, categoryId: p.categoryId || undefined, position: p.position } : t; });
  const toDevis = moveTemplate(list, cats, 'a', 'devis', 1);
  const after = apply(list, toDevis);
  check('déplacer « a » en 2e position de Devis', ids(groupTemplates(after, cats)[1].templates) === 'ccc,a,dddd', ids(groupTemplates(after, cats)[1].templates));
  check('catégorie de départ renumérotée aussi', toDevis.some(p => p.id === 'bb' && p.categoryId === '' && p.position === 0));
  check('positions 0..n-1 dans Devis', toDevis.filter(p => p.categoryId === 'devis').map(p => p.position).join() === '0,1,2');
  check('vers une catégorie inconnue -> « Non classés »', moveTemplate(list, cats, 'ccc', 'fantome', 0).some(p => p.id === 'ccc' && p.categoryId === ''));
  check('modèle inconnu -> rien', moveTemplate(list, cats, 'zz', 'devis', 0).length === 0);
  const up = nudgeTemplate(list, cats, 'dddd', -1);
  check('flèche ▲ : échange avec le précédent', up.map(p => `${p.id}:${p.position}`).join() === 'dddd:0,ccc:1');
  check('flèche ▲ sur le premier : rien', nudgeTemplate(list, cats, 'ccc', -1).length === 0);
  check('flèche ▼ sur le dernier : rien', nudgeTemplate(list, cats, 'dddd', 1).length === 0);
  const cats3: TemplateCategory[] = [{ id: 'a', name: 'A', position: 0 }, { id: 'b', name: 'B', position: 1 }, { id: 'c', name: 'C', position: 2 }];
  check('déplacer une catégorie : renumérotée', moveCategory(cats3, 'c', 0).map(c => `${c.id}${c.position}`).join() === 'c0,a1,b2');
  check('arrayMove borne les index', arrayMove([1, 2, 3], 0, 99).join() === '2,3,1');
}

section('Suppression et noms de catégorie');
{
  const list = [tpl('a', { categoryId: 'devis' }), tpl('b', { type: 'sms', categoryId: 'relance' })];
  check('catégorie non vide (même un seul SMS) -> suppression interdite', !canDeleteCategory(list, 'devis') && !canDeleteCategory(list, 'relance'));
  check('catégorie vide -> suppression autorisée', canDeleteCategory(list, 'vide'));
  check('« Non classés » jamais supprimable', !canDeleteCategory([], UNCATEGORIZED_ID));
  const cats: TemplateCategory[] = [{ id: 'devis', name: 'Devis', position: 0 }];
  check('nom vide refusé', validateCategoryName('  ', cats) !== null);
  check('« non classes » réservé (casse/accents)', validateCategoryName('non classes', cats) !== null);
  check('doublon refusé (casse)', validateCategoryName('DEVIS', cats) !== null);
  check('renommer avec le même nom : autorisé', validateCategoryName('Devis', cats, 'devis') === null);
  check('nom valide', validateCategoryName('Après-vente', cats) === null);
  check('61 caractères refusés', validateCategoryName('x'.repeat(61), cats) !== null);
}

section('Restauration : l\'ordre affiché du fichier est figé en positions');
{
  const old = [tpl('t1', { createdAt: '2026-08-05T11:57:17Z' }), tpl('t2', { createdAt: '2026-07-30T09:13:22Z' }), tpl('t3', { createdAt: '2026-07-31T14:05:06Z' })];
  const fixed = positionsFromBackup(old, undefined);
  check('sauvegarde d\'avant le lot 3 : positions = ordre « plus récent d\'abord »', fixed.map(t => `${t.id}:${t.position}`).join() === 't1:0,t2:2,t3:1');
  const noDates = positionsFromBackup([tpl('x', { createdAt: undefined }), tpl('y', { createdAt: undefined })], undefined);
  check('sans dates : l\'ordre du fichier fait foi', noDates.map(t => `${t.id}:${t.position}`).join() === 'x:0,y:1');
  const cats: TemplateCategory[] = [{ id: 'devis', name: 'Devis', position: 0 }];
  const withLayout = positionsFromBackup([tpl('a', { categoryId: 'devis', position: 5 }), tpl('b', { categoryId: 'devis', position: 2 }), tpl('c', { categoryId: 'gone', position: 1 })], cats);
  check('sauvegarde d\'après : ordre conservé, renuméroté ; catégorie inconnue -> Non classés', withLayout.map(t => `${t.id}:${t.categoryId ?? ''}:${t.position}`).join() === 'a:devis:1,b:devis:0,c::0');
  check('restauration : dates absentes du résultat stockables telles quelles (même nombre)', fixed.length === 3);
}

section('Vrai reducer : SAVE_TEMPLATE_LAYOUT');
{
  const state = {
    leads: [], actions: [], commercials: [], monthlyStats: [], calendarEvents: [], goals: [], plannedActions: [],
    defaultGoal: { prospectsCreated: null, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null },
    templates: [tpl('a'), tpl('b')], templateCategories: [],
  } as AppState;
  const cats: TemplateCategory[] = [{ id: 'devis', name: 'Devis', position: 0 }];
  let s = reducer(state, { type: 'SAVE_TEMPLATE_LAYOUT', payload: { categories: cats, placements: [{ id: 'a', categoryId: 'devis', position: 0 }] } });
  check('catégorie créée + modèle rangé', s.templateCategories?.length === 1 && s.templates.find(t => t.id === 'a')?.categoryId === 'devis');
  const refused = reducer(s, { type: 'SAVE_TEMPLATE_LAYOUT', payload: { categories: [], placements: [] } });
  check('retirer une catégorie NON VIDE : refusé (state inchangé)', refused === s);
  s = reducer(s, { type: 'SAVE_TEMPLATE_LAYOUT', payload: { categories: cats, placements: [{ id: 'a', categoryId: '', position: 0 }] } });
  s = reducer(s, { type: 'SAVE_TEMPLATE_LAYOUT', payload: { categories: [], placements: [] } });
  check('catégorie vidée puis supprimée : accepté, modèle intact en « Non classés »', s.templateCategories?.length === 0 && s.templates.length === 2 && !s.templates.find(t => t.id === 'a')?.categoryId);
  const del = reducer(s, { type: 'DELETE_TEMPLATE', payload: 'a' });
  check('supprimer un modèle reste possible (garde min-1 inchangée)', del.templates.length === 1 && reducer(del, { type: 'DELETE_TEMPLATE', payload: 'b' }).templates.length === 1);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais rangement des modèles : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
