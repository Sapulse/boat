/**
 * Harnais BASE JETABLE de la migration inbound_emails (Étape B).
 *
 * Exécution : npx tsx scripts/harness-inbound-db.ts
 *
 * Simule la PROD avant d'y toucher : monte une SQLite locale jetable avec le
 * schéma actuel (migrations init + login_attempts, comme Turso aujourd'hui),
 * la peuple de 296 leads + actions, puis applique EXACTEMENT le DDL du script
 * apply-inbound-emails-turso.ts et prouve :
 *  - les 296 leads (et leurs champs) sont INTACTS, les actions aussi ;
 *  - la table + ses 3 index existent ;
 *  - l'application est IDEMPOTENTE (rejouable sans erreur ni effet) ;
 *  - l'UNIQUE sur internetMessageId tient (ON CONFLICT DO NOTHING -> 1 ligne).
 * Aucun réseau, aucun Turso : fichier local .harness-inbound.db (gitignoré *.db).
 */
import { createClient, type Client } from '@libsql/client';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';

const DB_FILE = path.resolve('.harness-inbound.db');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

/** SQL d'une migration existante (préfixe du dossier). */
function migrationSql(suffix: string): string {
  const dir = path.resolve('prisma/migrations');
  const sub = readdirSync(dir).find(d => d.endsWith(suffix));
  if (!sub) throw new Error(`migration ${suffix} introuvable`);
  return readFileSync(path.join(dir, sub, 'migration.sql'), 'utf-8');
}

/** Exécute un fichier de migration instruction par instruction. */
async function applySqlFile(db: Client, sql: string): Promise<void> {
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
    await db.execute(stmt);
  }
}

async function main() {
  rmSync(DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  section('Mise en condition « prod » : schéma actuel + 296 leads');
  await applySqlFile(db, migrationSql('_init_crm_schema'));
  await applySqlFile(db, migrationSql('_add_login_attempts'));

  await db.execute("INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES ('fred', 'Fred', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
  for (let i = 0; i < 296; i++) {
    await db.execute({
      sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email,
              boatType, boatCondition, boatInterest, brand, budget, status, contactDate, quoteAmount, probability,
              currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate,
              lastActionDate, lossReason, signedAt, lostAt, reportedAt)
            VALUES (?, ?, CURRENT_TIMESTAMP, 'Tel', 'fred', ?, ?, ?, ?, 'Moteur', 'BO', 'Antares 8', 'Beneteau',
              20000, 'nouveau', '', NULL, NULL, '', '', '', 'tiede', 'normale', '', '', '', '', '', '', '')`,
      args: [`jetable-${i}`, '2026-01-01', `Prenom${i}`, `Nom${i}`, `06${String(10000000 + i)}`, `p${i}@exemple.fr`],
    });
  }
  await db.execute("INSERT INTO lead_actions (id, createdAt, updatedAt, leadId, authorId, type, date, result, notes) VALUES ('act-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'jetable-42', 'fred', 'appel', '2026-01-02', 'OK', 'note')");

  const leadsBefore = Number((await db.execute('SELECT COUNT(*) AS n FROM leads')).rows[0].n);
  const sampleBefore = JSON.stringify((await db.execute("SELECT firstName, lastName, phone, email, budget FROM leads WHERE id='jetable-42'")).rows[0]);
  check('296 leads en place avant migration', leadsBefore === 296);

  section('Application du DDL (celui, exactement, du script Turso)');
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);

  const tbl = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_emails'");
  const idx = await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'inbound_emails_%'");
  check('table inbound_emails créée', tbl.rows.length === 1);
  check('3 index créés (unique + status + receivedAt)', idx.rows.length === 3, `${idx.rows.length}`);

  section('Intégrité des données métier');
  const leadsAfter = Number((await db.execute('SELECT COUNT(*) AS n FROM leads')).rows[0].n);
  const sampleAfter = JSON.stringify((await db.execute("SELECT firstName, lastName, phone, email, budget FROM leads WHERE id='jetable-42'")).rows[0]);
  check('les 296 leads sont intacts (compte)', leadsAfter === 296, `${leadsAfter}`);
  check('champs d\'un lead inchangés à l\'octet', sampleAfter === sampleBefore);
  check('actions intactes', Number((await db.execute('SELECT COUNT(*) AS n FROM lead_actions')).rows[0].n) === 1);
  check('login_attempts intacte (table sœur)', (await db.execute("SELECT name FROM sqlite_master WHERE name='login_attempts'")).rows.length === 1);

  section('Idempotence : DDL rejoué à l\'identique');
  let rerunOk = true;
  try { for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl); } catch { rerunOk = false; }
  check('rejouable sans erreur (IF NOT EXISTS)', rerunOk);
  check('leads toujours 296 après rejeu', Number((await db.execute('SELECT COUNT(*) AS n FROM leads')).rows[0].n) === 296);

  section('Verrou d\'idempotence de la collecte (UNIQUE internetMessageId)');
  const ins = `INSERT INTO inbound_emails (id, graphId, internetMessageId, receivedAt, fromAddress, source, score, updatedAt)
               VALUES (?, 'g1', '<msg-1@mail>', '2026-07-28T10:00:00Z', 'a@b.c', 'site', 50, CURRENT_TIMESTAMP)
               ON CONFLICT(internetMessageId) DO NOTHING`;
  await db.execute({ sql: ins, args: ['row-1'] });
  await db.execute({ sql: ins, args: ['row-2'] }); // même internetMessageId -> ignoré
  const n = Number((await db.execute('SELECT COUNT(*) AS n FROM inbound_emails')).rows[0].n);
  check('2 insertions même email -> 1 seule ligne', n === 1, `${n}`);
  const keptId = (await db.execute('SELECT id FROM inbound_emails')).rows[0].id;
  check('la première insertion est conservée', keptId === 'row-1');

  await db.close();
  // Best-effort : sous Windows, libsql peut garder un verrou quelques instants
  // après close(). Le fichier est gitignoré (*.db) et re-purgé au prochain run.
  try { rmSync(DB_FILE, { force: true }); } catch { /* verrou Windows, sans gravité */ }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
