/**
 * Applique la migration ADDITIVE `login_attempts` (durcissement auth, commit 2)
 * sur la base Turso, SANS CLI ni WSL.
 *
 * Exécution (cible explicite, voir scripts/lib/dbTarget) :
 *   à blanc  : npx tsx scripts/apply-login-attempts-turso.ts --target=prod
 *   écriture : BOB_CONFIRM_PROD=<base> npx tsx scripts/apply-login-attempts-turso.ts --target=prod --apply
 * Plus de lecture automatique de .env : sans --target, refus.
 *
 * Sûr et IDEMPOTENT :
 *  - `CREATE TABLE IF NOT EXISTS` -> rejouable sans risque, ne touche AUCUNE
 *    table métier (purement additif) ;
 *  - vérifie ensuite que les leads sont intacts (compte) et que la table existe.
 *
 * Ne fait AUCUN DROP/ALTER/DELETE. À la différence de push-schema-turso.ts (qui
 * rejoue TOUTES les migrations et échouerait sur une base déjà peuplée), ce
 * script n'applique QUE la nouvelle table.
 */
import { createClient } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';

// DDL identique à la migration Prisma 20260711094126_add_login_attempts, en
// version IF NOT EXISTS (idempotente pour une base déjà en service).
const DDL = `CREATE TABLE IF NOT EXISTS "login_attempts" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" INTEGER NOT NULL
);`;

async function main() {
  const guard = guardDbTarget({ scriptName: 'apply-login-attempts-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  // 1) Compte des leads AVANT (preuve d'intégrité).
  const before = await db.execute('SELECT COUNT(*) AS n FROM leads');
  const leadsBefore = Number(before.rows[0].n);
  console.log(`Leads en base AVANT : ${leadsBefore}`);
  if (!apply) {
    const exists = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='login_attempts'")).rows.length === 1;
    console.log(`À blanc : table login_attempts ${exists ? 'déjà présente' : 'absente (serait créée)'}. Rien n'a été écrit.`);
    db.close();
    return;
  }

  // 2) Création idempotente de la table isolée.
  console.log('Application de la table login_attempts (CREATE TABLE IF NOT EXISTS)…');
  await db.execute(DDL);

  // 3) Vérifications APRÈS.
  const tbl = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='login_attempts'");
  const tableOk = tbl.rows.length === 1;
  const after = await db.execute('SELECT COUNT(*) AS n FROM leads');
  const leadsAfter = Number(after.rows[0].n);
  const cnt = await db.execute('SELECT COUNT(*) AS n FROM login_attempts');
  const attempts = Number(cnt.rows[0].n);

  db.close();

  console.log('\n— Résultat —');
  console.log(`  table login_attempts présente : ${tableOk ? 'oui ✅' : 'NON ❌'}`);
  console.log(`  leads en base APRÈS           : ${leadsAfter}`);
  console.log(`  lignes login_attempts         : ${attempts}`);

  if (!tableOk) { console.error('\n❌ La table n\'a pas été créée.'); process.exit(1); }
  if (leadsAfter !== leadsBefore) {
    console.error(`\n❌ ANOMALIE : le nombre de leads a changé (${leadsBefore} -> ${leadsAfter}). Vérifie la base.`);
    process.exit(1);
  }
  console.log(`\n✅ Migration additive appliquée. Leads intacts (${leadsAfter}). Le rate-limit est actif.`);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
