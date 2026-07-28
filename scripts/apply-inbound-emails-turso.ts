/**
 * Applique la migration ADDITIVE `inbound_emails` (chantier import email,
 * Étape B) sur la base Turso — même patron éprouvé que
 * apply-login-attempts-turso.ts.
 *
 * Exécution : npx tsx scripts/apply-inbound-emails-turso.ts
 * Requiert : TURSO_DATABASE_URL + TURSO_AUTH_TOKEN dans .env
 *
 * Sûr et IDEMPOTENT :
 *  - CREATE TABLE/INDEX IF NOT EXISTS -> rejouable sans risque, ne touche
 *    AUCUNE table métier (purement additif, zéro FK) ;
 *  - vérifie ensuite que les leads sont INTACTS (compte avant/après) et que la
 *    table + ses index existent.
 *  - Aucun DROP/ALTER/DELETE.
 *
 * Le DDL est EXPORTÉ pour que le harnais base-jetable
 * (scripts/harness-inbound-db.ts) teste EXACTEMENT le même SQL avant la prod.
 */
import { createClient } from '@libsql/client';

// DDL identique à la migration Prisma 20260728154112_add_inbound_emails, en
// version IF NOT EXISTS (idempotente pour une base déjà en service).
export const INBOUND_EMAILS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "inbound_emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "graphId" TEXT NOT NULL,
    "internetMessageId" TEXT NOT NULL,
    "receivedAt" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL DEFAULT '',
    "sourceDetail" TEXT,
    "leadSource" TEXT NOT NULL DEFAULT '',
    "extracted" TEXT NOT NULL DEFAULT '{}',
    "score" INTEGER NOT NULL,
    "scoreReasons" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'a_traiter',
    "leadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "inbound_emails_internetMessageId_key" ON "inbound_emails"("internetMessageId")`,
  `CREATE INDEX IF NOT EXISTS "inbound_emails_status_idx" ON "inbound_emails"("status")`,
  `CREATE INDEX IF NOT EXISTS "inbound_emails_receivedAt_idx" ON "inbound_emails"("receivedAt")`,
];

async function main() {
  const { config } = await import('dotenv');
  config();
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('❌ TURSO_DATABASE_URL et TURSO_AUTH_TOKEN sont requis (dans .env).');
    process.exit(1);
  }
  // Masque le host, ne loggue jamais le token.
  const host = (() => { try { return new URL(url).host; } catch { return '(url illisible)'; } })();
  console.log(`Cible Turso : ${host}`);

  const db = createClient({ url, authToken });

  // 1) Compte des leads AVANT (preuve d'intégrité).
  const before = await db.execute('SELECT COUNT(*) AS n FROM leads');
  const leadsBefore = Number(before.rows[0].n);
  console.log(`Leads en base AVANT : ${leadsBefore}`);

  // 2) Création idempotente de la table isolée + index.
  console.log('Application de inbound_emails (CREATE TABLE/INDEX IF NOT EXISTS)…');
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);

  // 3) Vérifications APRÈS.
  const tbl = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_emails'");
  const idx = await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'inbound_emails_%'");
  const after = await db.execute('SELECT COUNT(*) AS n FROM leads');
  const leadsAfter = Number(after.rows[0].n);
  const cnt = await db.execute('SELECT COUNT(*) AS n FROM inbound_emails');
  const rows = Number(cnt.rows[0].n);

  await db.close();

  console.log('\n— Résultat —');
  console.log(`  table inbound_emails présente : ${tbl.rows.length === 1 ? 'oui ✅' : 'NON ❌'}`);
  console.log(`  index présents                : ${idx.rows.length}/3`);
  console.log(`  leads en base APRÈS           : ${leadsAfter}`);
  console.log(`  lignes inbound_emails         : ${rows}`);

  if (tbl.rows.length !== 1 || idx.rows.length < 3) { console.error('\n❌ Table ou index manquants.'); process.exit(1); }
  if (leadsAfter !== leadsBefore) {
    console.error(`\n❌ ANOMALIE : le nombre de leads a changé (${leadsBefore} -> ${leadsAfter}). Vérifie la base.`);
    process.exit(1);
  }
  console.log(`\n✅ Migration additive appliquée. Leads intacts (${leadsAfter}). La file d'import est prête.`);
}

// Exécution directe uniquement (le harnais importe INBOUND_EMAILS_DDL sans lancer main).
if (process.argv[1]?.includes('apply-inbound-emails-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
