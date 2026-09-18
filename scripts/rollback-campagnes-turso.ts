/**
 * LOT SALONS — RETOUR ARRIÈRE de la migration « campagnes ».
 *
 * Écrit AVANT la migration, testé AVANT la migration : deux minutes ce soir,
 * une heure de panique évitée si besoin.
 *
 * Exécution (cible TOUJOURS explicite, même verrou que les migrations) :
 *   à blanc, prod  : npx tsx scripts/rollback-campagnes-turso.ts --target=prod
 *   écriture, prod : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/rollback-campagnes-turso.ts --target=prod --apply
 *   base locale    : npx tsx scripts/rollback-campagnes-turso.ts --target=local --db=<fichier> --apply
 *
 * CE QU'IL FAIT : supprime les DEUX tables du lot, dans l'ordre des clés
 * étrangères (participations d'abord, campagnes ensuite). Rien d'autre. Les
 * tables du CRM — leads en tête — ne sont jamais touchées : la suppression
 * d'une table enfant ne peut pas atteindre son parent.
 *
 * GARDE-FOU : s'il existe des participations, le script REFUSE et n'écrit rien.
 * Une participation, c'est du travail commercial (des appels passés, des RDV
 * pris) ; on ne le détruit pas par accident. Pour passer outre, il faut le
 * vouloir : `--force`, qui affiche d'abord ce qui sera perdu.
 *
 * Rejeu : sans effet (DROP … IF EXISTS), comme les migrations.
 *
 * ⚠️ Ce script ne s'utilise QUE si le lot est abandonné avant sa mise en
 * service. Une fois l'équipe au travail dans les campagnes, le retour arrière
 * n'est plus une suppression de tables mais une restauration de sauvegarde.
 */
import { createClient, type Client } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';

/** Ordre des clés étrangères : l'enfant d'abord. */
export const ROLLBACK_CAMPAGNES_SQL: string[] = [
  `DROP TABLE IF EXISTS "campagne_leads"`,
  `DROP TABLE IF EXISTS "campagnes"`,
];

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}
const hasTable = async (db: Client, table: string) =>
  (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).length === 1;

export interface RollbackEtat {
  tables: string[];
  campagnes: number;
  participations: number;
}

/** Ce qui existe (lecture seule). */
export async function rollbackEtat(db: Client): Promise<RollbackEtat> {
  const tables: string[] = [];
  for (const t of ['campagne_leads', 'campagnes']) if (await hasTable(db, t)) tables.push(t);
  const compter = async (t: string) => (tables.includes(t) ? Number((await rows(db, `SELECT COUNT(*) n FROM "${t}"`))[0].n) : 0);
  return { tables, campagnes: await compter('campagnes'), participations: await compter('campagne_leads') };
}

/** Supprime les deux tables (idempotent). N'appelle JAMAIS ceci sans avoir vérifié l'état. */
export async function applyRollback(db: Client): Promise<string[]> {
  const avant = await rollbackEtat(db);
  for (const sql of ROLLBACK_CAMPAGNES_SQL) await db.execute(sql);
  return avant.tables;
}

/** Preuve : les tables du lot ont disparu, celles du CRM sont intactes. */
export async function proveRollback(db: Client, leadsAvant: number, actionsAvant: number): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  checks.push({ label: 'table campagne_leads supprimée', ok: !(await hasTable(db, 'campagne_leads')) });
  checks.push({ label: 'table campagnes supprimée', ok: !(await hasTable(db, 'campagnes')) });
  const leads = Number((await rows(db, 'SELECT COUNT(*) n FROM leads'))[0].n);
  const actions = Number((await rows(db, 'SELECT COUNT(*) n FROM lead_actions'))[0].n);
  checks.push({ label: `leads intacts (${leadsAvant})`, ok: leads === leadsAvant, detail: String(leads) });
  checks.push({ label: `historique intact (${actionsAvant})`, ok: actions === actionsAvant, detail: String(actions) });
  const planned = await hasTable(db, 'planned_actions');
  checks.push({ label: 'actions programmées (lot 2) toujours là', ok: planned });
  return checks;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'rollback-campagnes-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const force = process.argv.includes('--force');
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const etat = await rollbackEtat(db);
  const leads = Number((await rows(db, 'SELECT COUNT(*) n FROM leads'))[0].n);
  const actions = Number((await rows(db, 'SELECT COUNT(*) n FROM lead_actions'))[0].n);
  console.log(`\nTables du lot présentes : ${etat.tables.join(', ') || 'aucune (rien à annuler)'}`);
  console.log(`Campagnes : ${etat.campagnes} · participations : ${etat.participations}`);
  console.log(`CRM : ${leads} lead(s), ${actions} action(s) d'historique — jamais touchés par ce script.`);

  // GARDE-FOU : du travail commercial en base -> refus, sauf --force explicite.
  if (etat.participations > 0 && !force) {
    console.error(`\n❌ REFUS : ${etat.participations} participation(s) en base.`);
    console.error("   Ce sont des appels passés et des RDV pris : on ne les supprime pas par accident.");
    console.error('   Si c\'est vraiment ce que vous voulez : relancer avec --force (et prendre une sauvegarde AVANT).');
    db.close();
    process.exit(1);
  }
  if (etat.participations > 0 && force) {
    console.log(`\n⚠️  --force : les ${etat.participations} participation(s) seront PERDUES.`);
  }

  if (!apply) {
    console.log('\nÀ blanc : rien n\'a été supprimé. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD).');
    db.close();
    return;
  }

  const t0 = Date.now();
  const supprimees = await applyRollback(db);
  console.log(`\nTables supprimées : ${supprimees.length ? supprimees.join(', ') : 'aucune (déjà absentes)'} · ${Date.now() - t0} ms`);
  const checks = await proveRollback(db, leads, actions);
  db.close();
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail && !c.ok ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base.'); process.exit(1); }
  console.log('\n✅ Retour arrière effectué et prouvé. Le CRM est revenu à son schéma d\'avant le lot salons.');
}

if (process.argv[1]?.includes('rollback-campagnes-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
