/**
 * Harnais lot 3 — rangement des modèles sur base SQLite JETABLE (jamais Turso) :
 * migration (script Turso), lecture d'une base pas encore migrée, API (store),
 * refus de supprimer une catégorie non vide, restauration d'avant / d'après.
 *
 * Exécution : npx tsx scripts/harness-template-layout-db.ts
 *
 * Données de la même forme que la prod du 17/09 : 16 modèles email, dates de
 * création réelles (ordre « plus récent d'abord » à conserver), aucune catégorie.
 */
import { createClient, type Client } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';
import { applyPlannedActionsSchema } from './apply-planned-actions-turso';
import {
  applyTemplateLayoutSchema, templateLayoutTodo, proveTemplateLayout, templatesFingerprint,
} from './apply-template-layout-turso';
import { fingerprint } from './apply-planned-actions-turso';
import { getState, detectSchema, saveTemplateLayout, createTemplate, updateTemplate, restoreBackup } from '../api/_lib/store';
import { parseRestorePayload } from '../api/_lib/validate';
import { HttpError } from '../api/_lib/http';
import { orderedTemplates } from '../src/lib/templateLayout';
import type { AppState } from '../src/data/types';

const DB_FILE = path.resolve('.harness-template-layout-db.db');
const PRISMA_DB_FILE = path.resolve('.harness-template-layout-prisma.db');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

function migrationSql(suffix: string): string {
  const dir = path.resolve('prisma/migrations');
  const sub = readdirSync(dir).find(d => d.endsWith(suffix));
  if (!sub) throw new Error(`migration ${suffix} introuvable`);
  return readFileSync(path.join(dir, sub, 'migration.sql'), 'utf-8');
}
async function schemaOf(db: Client, table: string): Promise<string> {
  const cols = (await db.execute(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY name`)).rows.map(r => ({ ...r }));
  const idx = (await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${table}' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`)).rows.map(r => r.name);
  const fks = (await db.execute(`SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('${table}') ORDER BY "from"`)).rows.map(r => ({ ...r }));
  return JSON.stringify({ cols, idx, fks });
}

// Dates de création réelles des 16 modèles de prod (17/09), titres génériques.
const CREATED = [
  '2026-08-05T11:57:17.300Z', '2026-08-05T11:57:17.100Z', '2026-08-05T11:57:17.000Z', '2026-08-05T11:57:16.500Z',
  '2026-08-05T11:57:16.100Z', '2026-08-05T11:57:15.000Z', '2026-08-05T11:57:10.000Z', '2026-08-05T11:50:58.000Z',
  '2026-08-05T11:50:52.000Z', '2026-08-05T11:50:09.000Z', '2026-07-31T14:09:51.000Z', '2026-07-31T14:09:26.000Z',
  '2026-07-31T14:05:13.000Z', '2026-07-31T14:05:06.000Z', '2026-07-30T14:21:08.000Z', '2026-07-30T09:13:22.000Z',
];

async function main() {
  rmSync(DB_FILE, { force: true });
  rmSync(PRISMA_DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  section('Mise en condition : base au lot 2, 16 modèles, aucune catégorie');
  await db.executeMultiple(migrationSql('_init_crm_schema'));
  await db.executeMultiple(migrationSql('_add_login_attempts'));
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);
  await applyPlannedActionsSchema(db);
  await db.execute(`INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES ('tom', 'Tom', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  for (let i = 0; i < 3; i++) {
    await db.execute({ sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition, boatInterest, brand, status, contactDate, currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate, lastActionDate, lossReason, signedAt, lostAt, reportedAt) VALUES (?, '2026-08-01', '2026-09-16T08:00:00Z', 'LBC', 'tom', 'P', 'T', '', '', '', '', '', '', 'contacte', '', '', '', '', 'neutre', 'normale', '', '', '', '', '', '', '')`, args: [`lead-${i}`] });
  }
  // Insertion dans un ordre MÉLANGÉ : l'ordre affiché ne doit dépendre que des dates.
  const order = [7, 2, 15, 0, 11, 4, 9, 13, 1, 6, 14, 3, 10, 5, 12, 8];
  for (const i of order) {
    await db.execute({ sql: `INSERT INTO message_templates (id, createdAt, updatedAt, type, title, subject, body) VALUES (?, ?, ?, 'email', ?, '', 'Bonjour')`, args: [`tpl-${String(i).padStart(2, '0')}`, CREATED[i], CREATED[i], `Modèle ${i}`] });
  }
  const expectedOrder = CREATED.map((_, i) => `tpl-${String(i).padStart(2, '0')}`).join(',');

  section('Base PAS ENCORE migrée au lot 3 : la sauvegarde sait la lire');
  let oldBackup: AppState;
  {
    const p = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
    const f = await detectSchema(p);
    check('schéma détecté : lot 2 oui, lot 3 non', f.lot2 && !f.templateLayout, JSON.stringify(f));
    let full: unknown = null;
    try { await getState(p); } catch (e) { full = e; }
    check('lecture complète impossible (colonnes du lot 3 absentes)', full !== null);
    oldBackup = await getState(p, { features: f });
    check('lecture adaptée : 16 modèles, sans champs du lot 3 inventés', oldBackup.templates.length === 16 && oldBackup.templates.every(t => !('position' in t) && !('categoryId' in t)) && !('templateCategories' in oldBackup));
    check('lecture adaptée : ordre « plus récent d\'abord »', oldBackup.templates.map(t => t.id).join(',') === expectedOrder);
    let restorable = true;
    try { parseRestorePayload({ format: 'bob-crm-backup', version: 1, data: oldBackup }); } catch { restorable = false; }
    check('ce fichier passe le validateur de restauration', restorable);
    await p.$disconnect();
  }

  section('Script Turso : à blanc, application, rejeu, preuve');
  const before = { templates: await templatesFingerprint(db), leads: await fingerprint(db, 'leads', ['id', 'source', 'status', 'updatedAt']) };
  const todo = await templateLayoutTodo(db);
  check('à blanc : 1 table et 2 colonnes à créer', todo.tables.length === 1 && todo.columns.length === 2, JSON.stringify(todo));
  check('à blanc : rien écrit', (await templateLayoutTodo(db)).columns.length === 2 && (await templatesFingerprint(db)).sha256 === before.templates.sha256);
  const s1 = await applyTemplateLayoutSchema(db);
  check('application : table créée, 2 colonnes ajoutées', s1.createdTables.length === 1 && s1.addedColumns.length === 2);
  for (const c of await proveTemplateLayout(db, before, true)) check(`preuve : ${c.label}`, c.ok, c.detail);
  const s2 = await applyTemplateLayoutSchema(db);
  check('rejeu : rien à faire, sans erreur', s2.createdTables.length === 0 && s2.addedColumns.length === 0);
  for (const c of await proveTemplateLayout(db, before, false)) check(`preuve après rejeu : ${c.label}`, c.ok, c.detail);

  section('Migration Prisma (dev) et script Turso : MÊME schéma');
  {
    const pdb = createClient({ url: `file:${PRISMA_DB_FILE}` });
    await pdb.executeMultiple(migrationSql('_init_crm_schema'));
    await pdb.executeMultiple(migrationSql('_lot2_planned_actions'));
    await pdb.executeMultiple(migrationSql('_lot3_template_layout'));
    for (const t of ['message_templates', 'template_categories']) check(`schéma identique : ${t}`, (await schemaOf(db, t)) === (await schemaOf(pdb, t)));
    pdb.close();
  }
  db.close();

  section('API (store) sur la base migrée');
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
  let st = await getState(prisma);
  check('getState : 16 modèles, ordre inchangé, aucune catégorie', st.templates.map(t => t.id).join(',') === expectedOrder && st.templateCategories?.length === 0);
  check('ordre calculé côté app = ordre lu (même source)', orderedTemplates(st.templates, st.templateCategories).map(t => t.id).join(',') === expectedOrder);

  await saveTemplateLayout(prisma, {
    categories: [{ id: 'cat-devis', name: 'Devis', position: 1 }, { id: 'cat-contact', name: 'Prise de contact', position: 0 }],
    placements: [
      { id: 'tpl-03', categoryId: 'cat-devis', position: 1 }, { id: 'tpl-02', categoryId: 'cat-devis', position: 0 },
      { id: 'tpl-15', categoryId: 'cat-contact', position: 0 }, { id: 'modele-supprime-ailleurs', categoryId: 'cat-devis', position: 9 },
    ],
  });
  st = await getState(prisma);
  const groups = (await import('../src/lib/templateLayout')).groupTemplates(st.templates, st.templateCategories);
  check('rangement : catégories dans l\'ordre manuel', groups.map(g => g.name).slice(0, 3).join(' | ') === 'Non classés | Prise de contact | Devis');
  check('rangement : ordre manuel dans Devis', groups[2].templates.map(t => t.id).join() === 'tpl-02,tpl-03');
  check('rangement : modèle inconnu ignoré, aucun modèle créé', st.templates.length === 16);
  check('rangement : 13 modèles restés « Non classés », ordre conservé', groups[0].templates.length === 13 && groups[0].templates[0].id === 'tpl-00');

  const created = await createTemplate(prisma, { id: 'tpl-new', type: 'sms', title: 'Nouveau', subject: '', body: 'x', categoryId: 'cat-fantome', position: 0 });
  check('création avec catégorie inconnue -> « Non classés » (pas d\'erreur de clé)', created.categoryId === undefined);
  const moved = await updateTemplate(prisma, 'tpl-new', { categoryId: 'cat-devis', position: 2 });
  check('modification : rangé dans Devis', moved.categoryId === 'cat-devis' && moved.position === 2);

  let refused: unknown = null;
  try { await saveTemplateLayout(prisma, { categories: [{ id: 'cat-contact', name: 'Prise de contact', position: 0 }], placements: [] }); } catch (e) { refused = e; }
  check('supprimer une catégorie NON VIDE -> 409', refused instanceof HttpError && refused.status === 409, String((refused as Error)?.message));
  st = await getState(prisma);
  check('409 : rien n\'a été écrit (Devis toujours là, modèles toujours rangés)', st.templateCategories?.some(c => c.id === 'cat-devis') === true && st.templates.filter(t => t.categoryId === 'cat-devis').length === 3);

  await saveTemplateLayout(prisma, {
    categories: [{ id: 'cat-contact', name: 'Prise de contact', position: 0 }, { id: 'cat-devis', name: 'Devis & offres', position: 1 }, { id: 'cat-vide', name: 'Après-vente', position: 2 }],
    placements: [],
  });
  await saveTemplateLayout(prisma, { categories: [{ id: 'cat-contact', name: 'Prise de contact', position: 0 }, { id: 'cat-devis', name: 'Devis & offres', position: 1 }], placements: [] });
  st = await getState(prisma);
  check('renommer puis supprimer une catégorie VIDE : accepté', st.templateCategories?.map(c => c.name).join() === 'Prise de contact,Devis & offres');

  section('Restauration');
  const roundtrip = await getState(prisma);
  // Positions renumérotées à la restauration (ordre FIGÉ) : on compare catégories + appartenance, puis l'ordre affiché.
  const norm = (s: AppState) => JSON.stringify({ c: s.templateCategories, t: [...s.templates].sort((a, b) => a.id.localeCompare(b.id)).map(t => [t.id, t.categoryId ?? '']) });
  const rep = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: roundtrip });
  const after = await getState(prisma);
  check('sauvegarde d\'après le lot 3 : catégories et rangement identiques', norm(after) === norm(roundtrip) && rep.templateCategories === 2, `${rep.templateCategories}`);
  check('… et l\'ordre affiché identique alors que createdAt est remis à l\'heure du jour', orderedTemplates(after.templates, after.templateCategories).map(t => t.id).join() === orderedTemplates(roundtrip.templates, roundtrip.templateCategories).map(t => t.id).join());

  const rep2 = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: oldBackup });
  const afterOld = await getState(prisma);
  check('sauvegarde d\'AVANT le lot 3 : restaurable, 16 modèles, aucune catégorie', rep2.templates === 16 && rep2.templateCategories === 0 && afterOld.templateCategories?.length === 0);
  check('… ordre « plus récent d\'abord » figé en positions 0..15', afterOld.templates.map(t => `${t.id}:${t.position}`).join(',') === CREATED.map((_, i) => `tpl-${String(i).padStart(2, '0')}:${i}`).join(','));

  await prisma.$disconnect();
  for (const f of [DB_FILE, PRISMA_DB_FILE]) { try { rmSync(f, { force: true }); } catch { /* verrou Windows */ } }
  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
