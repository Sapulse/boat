/**
 * Lot 3 — migration ADDITIVE « rangement des modèles » (catégories + ordre
 * manuel), sur la base Turso. Même patron que apply-planned-actions-turso.ts :
 * À BLANC par défaut, verrou de cible (scripts/lib/dbTarget).
 *
 * Exécution (cible TOUJOURS explicite) :
 *   à blanc, prod    : npx tsx scripts/apply-template-layout-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/apply-template-layout-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/apply-template-layout-turso.ts --target=local --db=<fichier> --apply
 * AVANT --apply en prod : `npm run backup:prod`.
 *
 * MIGRATION DE RÉFÉRENCE = CE SQL ÉCRIT À LA MAIN (identique à
 * prisma/migrations/20260917100000_lot3_template_layout, en IF NOT EXISTS).
 * Aucune donnée réécrite : les modèles existants gardent tout, `categoryId` NULL
 * (« Non classés ») et `position` 0 (ordre « plus récent d'abord » inchangé).
 *
 * --apply : 1. empreinte des modèles (colonnes d'origine) ; 2. table
 * template_categories (IF NOT EXISTS) ; 3. colonnes categoryId / position si
 * absentes ; 4. index ; 5. preuve (mêmes modèles ligne à ligne, nouvelles
 * colonnes à leur défaut, leads intacts).
 * Le DDL et les fonctions sont EXPORTÉS pour les harnais.
 */
import { createClient, type Client } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';

/** Table créée AVANT les colonnes (categoryId la référence). */
export const TEMPLATE_LAYOUT_TABLES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "template_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0
)`,
];

/** Colonnes ajoutées (ALTER TABLE ADD COLUMN si absentes). */
export const TEMPLATE_LAYOUT_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'message_templates', column: 'categoryId', ddl: `ALTER TABLE "message_templates" ADD COLUMN "categoryId" TEXT REFERENCES "template_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE` },
  { table: 'message_templates', column: 'position', ddl: `ALTER TABLE "message_templates" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0` },
];

export const TEMPLATE_LAYOUT_INDEX_DDL: string[] = [
  `CREATE INDEX IF NOT EXISTS "message_templates_categoryId_idx" ON "message_templates"("categoryId")`,
];

const ORIGINAL_TEMPLATE_COLUMNS = ['id', 'createdAt', 'updatedAt', 'type', 'title', 'subject', 'body'];

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}
const hasColumn = async (db: Client, table: string, column: string) =>
  (await rows(db, `SELECT name FROM pragma_table_info('${table}')`)).some(r => r.name === column);
const hasTable = async (db: Client, table: string) =>
  (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).length === 1;

export const templatesFingerprint = (db: Client) => fingerprint(db, 'message_templates', ORIGINAL_TEMPLATE_COLUMNS);

/** Ce qui manque (lecture seule). */
export async function templateLayoutTodo(db: Client): Promise<{ tables: string[]; columns: string[] }> {
  const tables = (await hasTable(db, 'template_categories')) ? [] : ['template_categories'];
  const columns: string[] = [];
  for (const c of TEMPLATE_LAYOUT_COLUMNS) if (!(await hasColumn(db, c.table, c.column))) columns.push(`${c.table}.${c.column}`);
  return { tables, columns };
}

/** Applique le schéma (idempotent). */
export async function applyTemplateLayoutSchema(db: Client): Promise<{ createdTables: string[]; addedColumns: string[] }> {
  const todo = await templateLayoutTodo(db);
  for (const ddl of TEMPLATE_LAYOUT_TABLES_DDL) await db.execute(ddl);
  for (const c of TEMPLATE_LAYOUT_COLUMNS) if (!(await hasColumn(db, c.table, c.column))) await db.execute(c.ddl);
  for (const ddl of TEMPLATE_LAYOUT_INDEX_DDL) await db.execute(ddl);
  return { createdTables: todo.tables, addedColumns: todo.columns };
}

type Fp = { count: number; sha256: string };
/** Preuve : modèles identiques (colonnes d'origine), nouvelles colonnes au défaut si elles viennent d'être créées, leads intacts. */
export async function proveTemplateLayout(db: Client, before: { templates: Fp; leads: Fp }, freshColumns: boolean): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const t = await templatesFingerprint(db);
  checks.push({ label: `modèles : même nombre (${before.templates.count}) et contenu d'origine identique ligne à ligne`, ok: t.count === before.templates.count && t.sha256 === before.templates.sha256 });
  const l = await fingerprint(db, 'leads', ['id', 'source', 'status', 'updatedAt']);
  checks.push({ label: `leads : intacts (${before.leads.count})`, ok: l.count === before.leads.count && l.sha256 === before.leads.sha256 });
  checks.push({ label: 'table template_categories présente', ok: await hasTable(db, 'template_categories') });
  const cols = await rows(db, `SELECT name FROM pragma_table_info('message_templates')`);
  checks.push({ label: 'colonnes categoryId et position présentes', ok: ['categoryId', 'position'].every(c => cols.some(r => r.name === c)) });
  if (freshColumns) {
    const bad = await rows(db, `SELECT COUNT(*) n FROM message_templates WHERE categoryId IS NOT NULL OR position <> 0`);
    checks.push({ label: 'modèles existants : « Non classés », position 0 (ordre inchangé)', ok: Number(bad[0].n) === 0 });
  }
  return checks;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'apply-template-layout-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const before = { templates: await templatesFingerprint(db), leads: await fingerprint(db, 'leads', ['id', 'source', 'status', 'updatedAt']) };
  const todo = await templateLayoutTodo(db);
  console.log(`\nModèles : ${before.templates.count} (empreinte ${before.templates.sha256.slice(0, 12)}…) · leads : ${before.leads.count}`);
  console.log(`Tables à créer     : ${todo.tables.join(', ') || 'aucune'}`);
  console.log(`Colonnes à ajouter : ${todo.columns.join(', ') || 'aucune'}`);

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD) après la sauvegarde.'); db.close(); return; }

  const tWrite = Date.now();
  const done = await applyTemplateLayoutSchema(db);
  const writeMs = Date.now() - tWrite;
  console.log(`\nSchéma : tables créées ${done.createdTables.length}, colonnes ajoutées ${done.addedColumns.length}`);
  const checks = await proveTemplateLayout(db, before, done.addedColumns.length > 0);
  db.close();
  console.log(`Durée : écriture ${writeMs} ms · total avec lectures et preuve ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base (la sauvegarde permet la restauration).'); process.exit(1); }
  console.log('\n✅ Migration additive appliquée et prouvée.');
}

if (process.argv[1]?.includes('apply-template-layout-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
