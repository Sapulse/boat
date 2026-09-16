/**
 * Lot 2 — migration ADDITIVE « actions programmées » + REPRISE des prochaines
 * actions déjà saisies, sur la base Turso. Même patron que
 * apply-inbound-emails-turso.ts, avec en plus un mode À BLANC par défaut.
 *
 * Exécution (cible TOUJOURS explicite — scripts/lib/dbTarget) :
 *   à blanc, prod    : npx tsx scripts/apply-planned-actions-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/apply-planned-actions-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/apply-planned-actions-turso.ts --target=local --db=<fichier> --apply
 * Sans --target : refus. --apply en prod sans BOB_CONFIRM_PROD exact : refus, aucune connexion.
 * AVANT --apply en prod : `npm run backup:prod` (vérif de restaurabilité incluse).
 *
 * MIGRATION DE RÉFÉRENCE = CE SQL ÉCRIT À LA MAIN. Ne JAMAIS le remplacer par la
 * sortie de `prisma migrate diff` / `migrate dev` : Prisma recrée les tables
 * (copie + DROP TABLE) pour ajouter une colonne sous SQLite. Voir prisma/MIGRATIONS.md
 * et le harnais harness-migrations-guard.ts (aucun DROP / RENAME / copie).
 *
 * Ce que fait --apply, dans cet ordre :
 *  1. relit l'état : leads et historique complets (empreintes), prochaines actions à reprendre ;
 *  2. schéma, IDEMPOTENT : ALTER TABLE ADD COLUMN seulement si la colonne manque
 *     (leads.noNextActionReason / noNextActionAt, lead_actions.kind /
 *     plannedActionId), CREATE TABLE / INDEX IF NOT EXISTS ;
 *  3. reprise, en UNE transaction : INSERT OR IGNORE des actions programmées
 *     (id déterministe « pa-reprise-<lead> ») et de leur responsable ;
 *  4. preuve : mêmes leads et même historique qu'avant (toutes les colonnes
 *     d'origine, ligne à ligne), nouvelles colonnes à leur valeur par défaut,
 *     une action programmée par prochaine action reprise, champs identiques.
 * Aucun DROP, aucun DELETE, aucune recréation de table.
 *
 * Le DDL et les fonctions sont EXPORTÉS : le harnais base-jetable
 * (scripts/harness-planned-actions-db.ts) exerce EXACTEMENT ce code.
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import { createHash } from 'node:crypto';
import { migrateLegacyNextActions } from '../src/lib/plannedActions';
import { guardDbTarget } from './lib/dbTarget';
import type { Lead, PlannedAction } from '../src/data/types';

/** Colonnes ajoutées (ALTER TABLE ADD COLUMN si absentes). */
export const PLANNED_ACTIONS_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'leads', column: 'noNextActionReason', ddl: `ALTER TABLE "leads" ADD COLUMN "noNextActionReason" TEXT NOT NULL DEFAULT ''` },
  { table: 'leads', column: 'noNextActionAt', ddl: `ALTER TABLE "leads" ADD COLUMN "noNextActionAt" TEXT NOT NULL DEFAULT ''` },
  { table: 'lead_actions', column: 'kind', ddl: `ALTER TABLE "lead_actions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'realisee'` },
  { table: 'lead_actions', column: 'plannedActionId', ddl: `ALTER TABLE "lead_actions" ADD COLUMN "plannedActionId" TEXT` },
];

/** Tables et index (identiques à la migration Prisma 20260916180000_lot2_planned_actions, en IF NOT EXISTS). */
export const PLANNED_ACTIONS_TABLES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "planned_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "time" TEXT,
    "endTime" TEXT,
    "originalDate" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'a_faire',
    "doneAt" TEXT,
    "doneActionId" TEXT,
    CONSTRAINT "planned_actions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
  `CREATE TABLE IF NOT EXISTS "planned_action_people" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "plannedActionId" TEXT NOT NULL,
    "commercialId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "planned_action_people_plannedActionId_fkey" FOREIGN KEY ("plannedActionId") REFERENCES "planned_actions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "planned_action_people_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS "planned_actions_leadId_idx" ON "planned_actions"("leadId")`,
  `CREATE INDEX IF NOT EXISTS "planned_actions_status_date_idx" ON "planned_actions"("status", "date")`,
  `CREATE INDEX IF NOT EXISTS "planned_action_people_commercialId_idx" ON "planned_action_people"("commercialId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "planned_action_people_plannedActionId_commercialId_key" ON "planned_action_people"("plannedActionId", "commercialId")`,
];

const ORIGINAL_LEAD_COLUMNS = ['id', 'createdAt', 'updatedAt', 'source', 'commercialId', 'firstName', 'lastName', 'phone', 'email', 'boatType', 'boatCondition', 'boatInterest', 'brand', 'budget', 'status', 'contactDate', 'quoteAmount', 'probability', 'currentBoat', 'comments', 'deliveryDate', 'temperature', 'priority', 'nextActionType', 'nextActionDate', 'nextActionTime', 'nextActionEndTime', 'lastActionDate', 'lossReason', 'signedAt', 'lostAt', 'reportedAt'];
const ORIGINAL_ACTION_COLUMNS = ['id', 'createdAt', 'updatedAt', 'leadId', 'authorId', 'type', 'date', 'result', 'notes', 'newStatus', 'nextActionType', 'nextActionDate'];

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}

async function hasColumn(db: Client, table: string, column: string): Promise<boolean> {
  return (await rows(db, `SELECT name FROM pragma_table_info('${table}')`)).some(r => r.name === column);
}

async function hasTable(db: Client, table: string): Promise<boolean> {
  return (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).length === 1;
}

/** Empreinte SHA-256 d'un jeu de lignes (colonnes données, ordre par id). */
export async function fingerprint(db: Client, table: string, columns: string[]): Promise<{ count: number; sha256: string }> {
  const list = columns.map(c => `"${c}"`).join(', ');
  const r = await rows(db, `SELECT ${list} FROM "${table}" ORDER BY id`);
  return { count: r.length, sha256: createHash('sha256').update(JSON.stringify(r)).digest('hex') };
}

export const leadsFingerprint = (db: Client) => fingerprint(db, 'leads', ORIGINAL_LEAD_COLUMNS);
export const actionsFingerprint = (db: Client) => fingerprint(db, 'lead_actions', ORIGINAL_ACTION_COLUMNS);

/** Applique le schéma (idempotent). Renvoie ce qui a été réellement ajouté. */
export async function applyPlannedActionsSchema(db: Client): Promise<{ addedColumns: string[]; createdTables: string[] }> {
  const addedColumns: string[] = [];
  for (const c of PLANNED_ACTIONS_COLUMNS) {
    if (!(await hasColumn(db, c.table, c.column))) { await db.execute(c.ddl); addedColumns.push(`${c.table}.${c.column}`); }
  }
  const createdTables: string[] = [];
  for (const t of ['planned_actions', 'planned_action_people']) if (!(await hasTable(db, t))) createdTables.push(t);
  for (const ddl of PLANNED_ACTIONS_TABLES_DDL) await db.execute(ddl);
  return { addedColumns, createdTables };
}

/** Prochaines actions à reprendre (lecture seule) : même règle que l'app (migrateLegacyNextActions). */
export async function planReprise(db: Client): Promise<PlannedAction[]> {
  const leads = (await rows(db, `SELECT id, commercialId, nextActionType, nextActionDate, nextActionTime, nextActionEndTime FROM leads ORDER BY id`))
    .map(r => ({ ...r, nextActionTime: r.nextActionTime ?? undefined, nextActionEndTime: r.nextActionEndTime ?? undefined }) as unknown as Lead);
  const existing = (await hasTable(db, 'planned_actions'))
    ? (await rows(db, `SELECT id, leadId FROM planned_actions`)) as unknown as PlannedAction[]
    : [];
  return migrateLegacyNextActions(leads, existing);
}

/** Écrit la reprise en UNE transaction (INSERT OR IGNORE : rejouable). Renvoie le nombre d'actions insérées. */
export async function applyReprise(db: Client, planned: PlannedAction[], nowIso: string): Promise<number> {
  if (planned.length === 0) return 0;
  const tx = await db.transaction('write');
  try {
    let inserted = 0;
    for (const pa of planned) {
      const res = await tx.execute({
        sql: `INSERT OR IGNORE INTO planned_actions (id, createdAt, updatedAt, leadId, type, customLabel, date, time, endTime, originalDate, note, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [pa.id, nowIso, nowIso, pa.leadId, pa.type, pa.customLabel, pa.date, pa.time ?? null, pa.endTime ?? null, pa.originalDate, pa.note, pa.status] as InValue[],
      });
      inserted += res.rowsAffected;
      for (const p of pa.people) {
        await tx.execute({
          sql: `INSERT OR IGNORE INTO planned_action_people (id, createdAt, updatedAt, plannedActionId, commercialId, role, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
          args: [`${pa.id}:${p.commercialId}`, nowIso, nowIso, pa.id, p.commercialId, p.role],
        });
      }
    }
    await tx.commit();
    return inserted;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

/** Preuve après application : ce qui doit être vrai, sous forme de contrôles nommés. */
export async function proveMigration(db: Client, before: { leads: { count: number; sha256: string }; actions: { count: number; sha256: string } }, expected: PlannedAction[]): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const leadsAfter = await leadsFingerprint(db);
  const actionsAfter = await actionsFingerprint(db);
  checks.push({ label: `leads : même nombre (${before.leads.count}) et colonnes d'origine identiques ligne à ligne`, ok: leadsAfter.count === before.leads.count && leadsAfter.sha256 === before.leads.sha256 });
  checks.push({ label: `historique : même nombre (${before.actions.count}) et colonnes d'origine identiques`, ok: actionsAfter.count === before.actions.count && actionsAfter.sha256 === before.actions.sha256 });
  const badLead = await rows(db, `SELECT COUNT(*) n FROM leads WHERE noNextActionReason <> '' OR noNextActionAt <> ''`);
  checks.push({ label: 'leads : nouvelles colonnes à leur valeur par défaut', ok: Number(badLead[0].n) === 0 });
  const badKind = await rows(db, `SELECT COUNT(*) n FROM lead_actions WHERE kind <> 'realisee' OR plannedActionId IS NOT NULL`);
  checks.push({ label: 'historique : toutes les lignes existantes en kind « realisee »', ok: Number(badKind[0].n) === 0 });
  const legacy = await rows(db, `SELECT p.id, p.leadId, p.type, p.date, p.time, p.endTime, p.originalDate, p.status, l.nextActionType, l.nextActionDate, l.nextActionTime, l.nextActionEndTime, l.commercialId,
      (SELECT COUNT(*) FROM planned_action_people x WHERE x.plannedActionId = p.id AND x.active = 1 AND x.role = 'responsable' AND x.commercialId = l.commercialId) AS resp
    FROM planned_actions p JOIN leads l ON l.id = p.leadId WHERE p.id LIKE 'pa-reprise-%'`);
  const expectedIds = new Set(expected.map(p => p.id));
  const found = legacy.filter(r => expectedIds.has(String(r.id)));
  checks.push({ label: `reprise : ${expected.length} action(s) programmée(s) attendue(s) présente(s)`, ok: found.length === expected.length, detail: `${found.length}/${expected.length}` });
  const mismatch = found.filter(r => r.status !== 'a_faire' || r.date !== r.nextActionDate || r.originalDate !== r.nextActionDate
    || (r.type !== (r.nextActionType || 'autre')) || (r.time ?? null) !== (r.nextActionTime ?? null) || Number(r.resp) !== 1);
  checks.push({ label: 'reprise : date, type, heure et responsable identiques au lead', ok: mismatch.length === 0, detail: mismatch.map(r => r.id).join(', ') });
  return checks;
}

async function main() {
  // VERROU (scripts/lib/dbTarget) : cible explicite, affichée avant tout ;
  // écriture en prod = --apply + --target=prod + BOB_CONFIRM_PROD=<base>.
  const guard = guardDbTarget({ scriptName: 'apply-planned-actions-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const before = { leads: await leadsFingerprint(db), actions: await actionsFingerprint(db) };
  const missingColumns: string[] = [];
  for (const c of PLANNED_ACTIONS_COLUMNS) if (!(await hasColumn(db, c.table, c.column))) missingColumns.push(`${c.table}.${c.column}`);
  const missingTables = [];
  for (const t of ['planned_actions', 'planned_action_people']) if (!(await hasTable(db, t))) missingTables.push(t);
  const reprise = await planReprise(db);
  console.log(`\nLeads : ${before.leads.count} (empreinte ${before.leads.sha256.slice(0, 12)}…) · historique : ${before.actions.count} (${before.actions.sha256.slice(0, 12)}…)`);
  console.log(`Colonnes à ajouter : ${missingColumns.join(', ') || 'aucune'}`);
  console.log(`Tables à créer     : ${missingTables.join(', ') || 'aucune'}`);
  console.log(`Prochaines actions à reprendre : ${reprise.length}`);
  for (const p of reprise) console.log(`  - ${p.id} · ${p.type} le ${p.date}${p.time ? ` à ${p.time}` : ''} · responsable ${p.people[0]?.commercialId}`);

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD) après la sauvegarde.'); db.close(); return; }

  const tWrite = Date.now();
  const schema = await applyPlannedActionsSchema(db);
  const inserted = await applyReprise(db, reprise, new Date().toISOString());
  const writeMs = Date.now() - tWrite;
  console.log(`\nSchéma : colonnes ajoutées ${schema.addedColumns.length}, tables créées ${schema.createdTables.length} · reprise : ${inserted} insérée(s)`);
  const checks = await proveMigration(db, before, reprise);
  db.close();
  console.log(`Durée : écriture (schéma + reprise) ${writeMs} ms · total avec lectures et preuve ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base (la sauvegarde permet la restauration).'); process.exit(1); }
  console.log('\n✅ Migration additive appliquée et prouvée.');
}

// Exécution directe uniquement (le harnais importe les fonctions sans lancer main).
if (process.argv[1]?.includes('apply-planned-actions-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
