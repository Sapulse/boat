/**
 * Lot 4 — migration ADDITIVE « objectifs de la semaine », sur la base Turso.
 * Même patron que apply-template-layout-turso.ts : À BLANC par défaut, verrou de
 * cible (scripts/lib/dbTarget).
 *
 * Exécution (cible TOUJOURS explicite) :
 *   à blanc, prod    : npx tsx scripts/apply-weekly-objectives-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/apply-weekly-objectives-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/apply-weekly-objectives-turso.ts --target=local --db=<fichier> --apply
 * AVANT --apply en prod : `npm run backup:prod`.
 *
 * MIGRATION DE RÉFÉRENCE = CE SQL ÉCRIT À LA MAIN (identique à
 * prisma/migrations/20260917180000_lot4_weekly_objectives, en IF NOT EXISTS).
 * Une table NEUVE et ses index : aucune table existante n'est touchée, aucune
 * donnée écrite (la table part vide).
 *
 * --apply : 1. empreintes (commerciaux, leads, actions programmées) ; 2. table
 * weekly_objectives (IF NOT EXISTS) ; 3. index ; 4. preuve (tables existantes
 * identiques ligne à ligne, table neuve présente, vide si elle vient d'être créée).
 * Le DDL et les fonctions sont EXPORTÉS pour les harnais.
 */
import { createClient, type Client } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';

export const WEEKLY_OBJECTIVES_TABLES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "weekly_objectives" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "weekStart" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "ownerId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "copiedFromId" TEXT,
    "modifiedAfterWeekAt" TEXT,
    CONSTRAINT "weekly_objectives_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
];

export const WEEKLY_OBJECTIVES_INDEX_DDL: string[] = [
  `CREATE INDEX IF NOT EXISTS "weekly_objectives_weekStart_idx" ON "weekly_objectives"("weekStart")`,
  `CREATE INDEX IF NOT EXISTS "weekly_objectives_ownerId_idx" ON "weekly_objectives"("ownerId")`,
];

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}
const hasTable = async (db: Client, table: string) =>
  (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).length === 1;

type Fp = { count: number; sha256: string };
export interface WeeklyObjectivesBefore { commercials: Fp; leads: Fp; planned: Fp | null }

/** Empreintes des tables voisines (lecture seule). planned_actions absente (base d'avant lot 2) -> null. */
export async function weeklyObjectivesBefore(db: Client): Promise<WeeklyObjectivesBefore> {
  return {
    commercials: await fingerprint(db, 'commercials', ['id', 'name', 'active', 'updatedAt']),
    leads: await fingerprint(db, 'leads', ['id', 'commercialId', 'status', 'updatedAt']),
    planned: (await hasTable(db, 'planned_actions')) ? await fingerprint(db, 'planned_actions', ['id', 'status', 'date', 'updatedAt']) : null,
  };
}

/** Ce qui manque (lecture seule). */
export async function weeklyObjectivesTodo(db: Client): Promise<{ tables: string[] }> {
  return { tables: (await hasTable(db, 'weekly_objectives')) ? [] : ['weekly_objectives'] };
}

/** Applique le schéma (idempotent). */
export async function applyWeeklyObjectivesSchema(db: Client): Promise<{ createdTables: string[] }> {
  const todo = await weeklyObjectivesTodo(db);
  for (const ddl of WEEKLY_OBJECTIVES_TABLES_DDL) await db.execute(ddl);
  for (const ddl of WEEKLY_OBJECTIVES_INDEX_DDL) await db.execute(ddl);
  return { createdTables: todo.tables };
}

/** Preuve : tables voisines identiques, table et index présents, table vide si elle vient d'être créée. */
export async function proveWeeklyObjectives(db: Client, before: WeeklyObjectivesBefore, freshTable: boolean): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const after = await weeklyObjectivesBefore(db);
  checks.push({ label: `commerciaux : intacts (${before.commercials.count})`, ok: after.commercials.count === before.commercials.count && after.commercials.sha256 === before.commercials.sha256 });
  checks.push({ label: `leads : intacts (${before.leads.count})`, ok: after.leads.count === before.leads.count && after.leads.sha256 === before.leads.sha256 });
  if (before.planned) checks.push({ label: `actions programmées : intactes (${before.planned.count})`, ok: !!after.planned && after.planned.count === before.planned.count && after.planned.sha256 === before.planned.sha256 });
  checks.push({ label: 'table weekly_objectives présente', ok: await hasTable(db, 'weekly_objectives') });
  const idx = await rows(db, `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='weekly_objectives'`);
  checks.push({ label: 'index weekStart et ownerId présents', ok: ['weekly_objectives_weekStart_idx', 'weekly_objectives_ownerId_idx'].every(n => idx.some(r => r.name === n)) });
  const cols = (await rows(db, `SELECT name FROM pragma_table_info('weekly_objectives')`)).map(r => r.name);
  const expected = ['id', 'createdAt', 'updatedAt', 'weekStart', 'position', 'text', 'ownerId', 'done', 'doneAt', 'active', 'copiedFromId', 'modifiedAfterWeekAt'];
  checks.push({ label: 'colonnes attendues (12)', ok: expected.every(c => cols.includes(c)) && cols.length === expected.length, detail: cols.join(',') });
  if (freshTable) {
    const n = await rows(db, 'SELECT COUNT(*) n FROM weekly_objectives');
    checks.push({ label: 'table neuve vide (aucune donnée écrite)', ok: Number(n[0].n) === 0 });
  }
  return checks;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'apply-weekly-objectives-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const before = await weeklyObjectivesBefore(db);
  const todo = await weeklyObjectivesTodo(db);
  console.log(`\nCommerciaux : ${before.commercials.count} · leads : ${before.leads.count} · actions programmées : ${before.planned?.count ?? 'table absente'}`);
  console.log(`Tables à créer : ${todo.tables.join(', ') || 'aucune (déjà migrée)'}`);

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD) après la sauvegarde.'); db.close(); return; }

  const tWrite = Date.now();
  const done = await applyWeeklyObjectivesSchema(db);
  const writeMs = Date.now() - tWrite;
  console.log(`\nSchéma : tables créées ${done.createdTables.length}`);
  const checks = await proveWeeklyObjectives(db, before, done.createdTables.length > 0);
  db.close();
  console.log(`Durée : écriture ${writeMs} ms · total avec lectures et preuve ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail && !c.ok ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base (la sauvegarde permet la restauration).'); process.exit(1); }
  console.log('\n✅ Migration additive appliquée et prouvée.');
}

if (process.argv[1]?.includes('apply-weekly-objectives-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
