/**
 * Lot 5 — migration ADDITIVE « réseaux sociaux », sur la base Turso.
 * Même patron que apply-weekly-objectives-turso.ts : À BLANC par défaut, verrou de
 * cible (scripts/lib/dbTarget).
 *
 * Exécution (cible TOUJOURS explicite) :
 *   à blanc, prod    : npx tsx scripts/apply-social-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/apply-social-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/apply-social-turso.ts --target=local --db=<fichier> --apply
 * AVANT --apply en prod : `npm run backup:prod`.
 *
 * MIGRATION DE RÉFÉRENCE = CE SQL ÉCRIT À LA MAIN (identique à
 * prisma/migrations/20260918090000_lot5_social, en IF NOT EXISTS / OR IGNORE).
 * Deux tables NEUVES, un index unique, et les 3 réseaux par défaut (Facebook,
 * Instagram, LinkedIn) à identifiants FIXES : aucune table existante touchée —
 * monthly_stats (acquisition) comprise.
 *
 * --apply : 1. empreintes (commerciaux, leads, stats mensuelles) ; 2. tables
 * (IF NOT EXISTS) ; 3. index ; 4. réseaux par défaut (INSERT OR IGNORE : un réseau
 * renommé ou archivé n'est jamais réécrit) ; 5. preuve.
 * Le SQL et les fonctions sont EXPORTÉS pour les harnais.
 */
import { createClient, type Client } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';

export const SOCIAL_TABLES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "social_networks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false
)`,
  `CREATE TABLE IF NOT EXISTS "social_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "networkId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "followers" INTEGER NOT NULL,
    "posts" INTEGER,
    "reach" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "social_stats_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "social_networks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
];

export const SOCIAL_INDEX_DDL: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "social_stats_networkId_year_month_key" ON "social_stats"("networkId", "year", "month")`,
];

/** Réseaux par défaut : mêmes ids que src/lib/social.ts (DEFAULT_SOCIAL_NETWORKS). */
export const SOCIAL_DEFAULTS_SQL: string[] = [
  `INSERT OR IGNORE INTO "social_networks" ("id", "updatedAt", "name", "position", "archived") VALUES ('reseau-facebook', CURRENT_TIMESTAMP, 'Facebook', 1, false)`,
  `INSERT OR IGNORE INTO "social_networks" ("id", "updatedAt", "name", "position", "archived") VALUES ('reseau-instagram', CURRENT_TIMESTAMP, 'Instagram', 2, false)`,
  `INSERT OR IGNORE INTO "social_networks" ("id", "updatedAt", "name", "position", "archived") VALUES ('reseau-linkedin', CURRENT_TIMESTAMP, 'LinkedIn', 3, false)`,
];
export const DEFAULT_NETWORK_IDS = ['reseau-facebook', 'reseau-instagram', 'reseau-linkedin'];

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}
const hasTable = async (db: Client, table: string) =>
  (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).length === 1;

type Fp = { count: number; sha256: string };
export interface SocialBefore { commercials: Fp; leads: Fp; monthlyStats: Fp }

/** Empreintes des tables voisines (lecture seule), dont les stats mensuelles de l'acquisition. */
export async function socialBefore(db: Client): Promise<SocialBefore> {
  return {
    commercials: await fingerprint(db, 'commercials', ['id', 'name', 'active', 'updatedAt']),
    leads: await fingerprint(db, 'leads', ['id', 'commercialId', 'status', 'updatedAt']),
    monthlyStats: await fingerprint(db, 'monthly_stats', ['id', 'year', 'month', 'source', 'budget', 'leads', 'updatedAt']),
  };
}

/** Ce qui manque (lecture seule). */
export async function socialTodo(db: Client): Promise<{ tables: string[]; defaultNetworks: string[] }> {
  const tables = [];
  for (const t of ['social_networks', 'social_stats']) if (!(await hasTable(db, t))) tables.push(t);
  let present: unknown[] = [];
  if (!tables.includes('social_networks')) present = (await rows(db, `SELECT id FROM social_networks`)).map(r => r.id);
  return { tables, defaultNetworks: DEFAULT_NETWORK_IDS.filter(id => !present.includes(id)) };
}

/** Applique le schéma et les réseaux par défaut (idempotent). */
export async function applySocialSchema(db: Client): Promise<{ createdTables: string[]; insertedNetworks: string[] }> {
  const todo = await socialTodo(db);
  for (const ddl of SOCIAL_TABLES_DDL) await db.execute(ddl);
  for (const ddl of SOCIAL_INDEX_DDL) await db.execute(ddl);
  for (const sql of SOCIAL_DEFAULTS_SQL) await db.execute(sql);
  return { createdTables: todo.tables, insertedNetworks: todo.defaultNetworks };
}

/** Preuve : voisines identiques, tables / index / colonnes présents, 3 réseaux par défaut, stats vides si tables neuves. */
export async function proveSocial(db: Client, before: SocialBefore, freshTables: boolean): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const after = await socialBefore(db);
  const same = (a: Fp, b: Fp) => a.count === b.count && a.sha256 === b.sha256;
  checks.push({ label: `commerciaux : intacts (${before.commercials.count})`, ok: same(after.commercials, before.commercials) });
  checks.push({ label: `leads : intacts (${before.leads.count})`, ok: same(after.leads, before.leads) });
  checks.push({ label: `stats mensuelles de l'acquisition : intactes (${before.monthlyStats.count})`, ok: same(after.monthlyStats, before.monthlyStats) });
  checks.push({ label: 'tables social_networks et social_stats présentes', ok: (await hasTable(db, 'social_networks')) && (await hasTable(db, 'social_stats')) });
  const idx = await rows(db, `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='social_stats'`);
  checks.push({ label: 'index unique (réseau, année, mois) présent', ok: idx.some(r => r.name === 'social_stats_networkId_year_month_key' && /UNIQUE/i.test(String(r.sql))) });
  const colsOf = async (t: string) => (await rows(db, `SELECT name FROM pragma_table_info('${t}')`)).map(r => r.name);
  const netCols = await colsOf('social_networks');
  const expNet = ['id', 'createdAt', 'updatedAt', 'name', 'position', 'archived'];
  checks.push({ label: 'colonnes social_networks (6)', ok: expNet.every(c => netCols.includes(c)) && netCols.length === expNet.length, detail: netCols.join(',') });
  const statCols = await colsOf('social_stats');
  const expStat = ['id', 'createdAt', 'updatedAt', 'networkId', 'year', 'month', 'followers', 'posts', 'reach', 'comment'];
  checks.push({ label: 'colonnes social_stats (10)', ok: expStat.every(c => statCols.includes(c)) && statCols.length === expStat.length, detail: statCols.join(',') });
  const nets = await rows(db, `SELECT id FROM social_networks`);
  checks.push({ label: 'réseaux par défaut présents (Facebook, Instagram, LinkedIn)', ok: DEFAULT_NETWORK_IDS.every(id => nets.some(r => r.id === id)), detail: nets.map(r => r.id).join(',') });
  if (freshTables) {
    const n = await rows(db, 'SELECT COUNT(*) n FROM social_stats');
    checks.push({ label: 'tables neuves : 3 réseaux, aucune stat', ok: Number(n[0].n) === 0 && nets.length === 3 });
  }
  return checks;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'apply-social-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const before = await socialBefore(db);
  const todo = await socialTodo(db);
  console.log(`\nCommerciaux : ${before.commercials.count} · leads : ${before.leads.count} · stats mensuelles : ${before.monthlyStats.count}`);
  console.log(`Tables à créer : ${todo.tables.join(', ') || 'aucune (déjà migrée)'}`);
  console.log(`Réseaux par défaut à créer : ${todo.defaultNetworks.join(', ') || 'aucun'}`);

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD) après la sauvegarde.'); db.close(); return; }

  const tWrite = Date.now();
  const done = await applySocialSchema(db);
  const writeMs = Date.now() - tWrite;
  console.log(`\nSchéma : tables créées ${done.createdTables.length} · réseaux par défaut créés ${done.insertedNetworks.length}`);
  const checks = await proveSocial(db, before, done.createdTables.length === 2);
  db.close();
  console.log(`Durée : écriture ${writeMs} ms · total avec lectures et preuve ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail && !c.ok ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base (la sauvegarde permet la restauration).'); process.exit(1); }
  console.log('\n✅ Migration additive appliquée et prouvée.');
}

if (process.argv[1]?.includes('apply-social-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
