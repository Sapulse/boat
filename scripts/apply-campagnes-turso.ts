/**
 * LOT SALONS (S1) — migration ADDITIVE « campagnes », sur la base Turso.
 * Même patron que apply-social-turso.ts : À BLANC par défaut, verrou de cible
 * (scripts/lib/dbTarget).
 *
 * Exécution (cible TOUJOURS explicite) :
 *   à blanc, prod    : npx tsx scripts/apply-campagnes-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/apply-campagnes-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/apply-campagnes-turso.ts --target=local --db=<fichier> --apply
 * AVANT --apply en prod : `npm run backup:prod`.
 *
 * MIGRATION DE RÉFÉRENCE = CE SQL ÉCRIT À LA MAIN (identique à
 * prisma/migrations/20260918190000_lot_salons_campagnes, en IF NOT EXISTS /
 * OR IGNORE). Deux tables NEUVES, quatre index, UNE ligne de seed.
 *
 * CE QUE CE SCRIPT NE FAIT JAMAIS : écrire dans `leads`. La source d'un lead dit
 * d'où il vient la PREMIÈRE fois ; elle est immuable. La preuve ci-dessous
 * compare l'empreinte des leads AVANT / APRÈS, `source` comprise.
 *
 * --apply : 1. empreintes (commerciaux, leads dont la source, actions) ;
 * 2. tables (IF NOT EXISTS) ; 3. index ; 4. seed (INSERT OR IGNORE : une
 * campagne déjà renseignée n'est jamais réécrite) ; 5. preuve.
 * Le SQL et les fonctions sont EXPORTÉS pour les harnais.
 */
import { createClient, type Client } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';

export const CAMPAGNES_TABLES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "campagnes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lieu" TEXT NOT NULL DEFAULT '',
    "dateDebut" TEXT NOT NULL DEFAULT '',
    "dateFin" TEXT NOT NULL DEFAULT '',
    "dateSalonDebut" TEXT NOT NULL DEFAULT '',
    "dateSalonFin" TEXT NOT NULL DEFAULT '',
    "objectifRdv" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true
)`,
  `CREATE TABLE IF NOT EXISTS "campagne_leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "campagneId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "responsableId" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT '',
    "priorite" TEXT NOT NULL DEFAULT 'Moyenne',
    "statutCampagne" TEXT NOT NULL DEFAULT 'À contacter',
    "bateauxAVoir" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "campagne_leads_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "campagnes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campagne_leads_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campagne_leads_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)`,
];

export const CAMPAGNES_INDEX_DDL: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "campagne_leads_campagneId_leadId_key" ON "campagne_leads"("campagneId", "leadId")`,
  `CREATE INDEX IF NOT EXISTS "campagne_leads_campagneId_idx" ON "campagne_leads"("campagneId")`,
  `CREATE INDEX IF NOT EXISTS "campagne_leads_leadId_idx" ON "campagne_leads"("leadId")`,
  `CREATE INDEX IF NOT EXISTS "campagne_leads_responsableId_idx" ON "campagne_leads"("responsableId")`,
];

/** Campagne du salon, identifiant FIXE. Dates de fin / de salon : TODO assumé (voir migration.sql). */
export const CAMPAGNE_SEED_ID = 'campagne-grand-pavois-2026';
export const CAMPAGNE_SEED_DATE_DEBUT = '2026-09-18';
export const CAMPAGNES_SEED_SQL: string[] = [
  `INSERT OR IGNORE INTO "campagnes" ("id", "updatedAt", "nom", "type", "lieu", "dateDebut", "dateFin", "dateSalonDebut", "dateSalonFin", "objectifRdv", "active") VALUES ('${CAMPAGNE_SEED_ID}', CURRENT_TIMESTAMP, 'Grand Pavois 2026', 'salon', 'La Rochelle', '${CAMPAGNE_SEED_DATE_DEBUT}', '', '', '', NULL, true)`,
];

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}
const hasTable = async (db: Client, table: string) =>
  (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).length === 1;

type Fp = { count: number; sha256: string };
export interface CampagnesBefore { commercials: Fp; leads: Fp; leadSources: Fp; actions: Fp }

/**
 * Empreintes des tables voisines (lecture seule). `leadSources` est l'empreinte
 * des SOURCES seules : c'est la garantie chiffrée que ce lot n'y touche pas.
 */
export async function campagnesBefore(db: Client): Promise<CampagnesBefore> {
  return {
    commercials: await fingerprint(db, 'commercials', ['id', 'name', 'active', 'updatedAt']),
    leads: await fingerprint(db, 'leads', ['id', 'commercialId', 'status', 'source', 'updatedAt']),
    leadSources: await fingerprint(db, 'leads', ['id', 'source']),
    actions: await fingerprint(db, 'lead_actions', ['id', 'leadId', 'type', 'date', 'kind']),
  };
}

/** Ce qui manque (lecture seule). */
export async function campagnesTodo(db: Client): Promise<{ tables: string[]; seed: string[] }> {
  const tables: string[] = [];
  for (const t of ['campagnes', 'campagne_leads']) if (!(await hasTable(db, t))) tables.push(t);
  let present: unknown[] = [];
  if (!tables.includes('campagnes')) present = (await rows(db, `SELECT id FROM campagnes`)).map(r => r.id);
  return { tables, seed: present.includes(CAMPAGNE_SEED_ID) ? [] : [CAMPAGNE_SEED_ID] };
}

/** Applique le schéma et le seed (idempotent). */
export async function applyCampagnesSchema(db: Client): Promise<{ createdTables: string[]; insertedCampagnes: string[] }> {
  const todo = await campagnesTodo(db);
  for (const ddl of CAMPAGNES_TABLES_DDL) await db.execute(ddl);
  for (const ddl of CAMPAGNES_INDEX_DDL) await db.execute(ddl);
  for (const sql of CAMPAGNES_SEED_SQL) await db.execute(sql);
  return { createdTables: todo.tables, insertedCampagnes: todo.seed };
}

/** Preuve : voisines identiques (sources comprises), tables / index / colonnes, seed présent, participations vides si tables neuves. */
export async function proveCampagnes(db: Client, before: CampagnesBefore, freshTables: boolean): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const after = await campagnesBefore(db);
  const same = (a: Fp, b: Fp) => a.count === b.count && a.sha256 === b.sha256;
  checks.push({ label: `commerciaux : intacts (${before.commercials.count})`, ok: same(after.commercials, before.commercials) });
  checks.push({ label: `leads : intacts (${before.leads.count})`, ok: same(after.leads, before.leads) });
  checks.push({ label: `leads : AUCUNE source modifiée (empreinte des sources identique)`, ok: same(after.leadSources, before.leadSources) });
  checks.push({ label: `historique des actions : intact (${before.actions.count})`, ok: same(after.actions, before.actions) });
  checks.push({ label: 'tables campagnes et campagne_leads présentes', ok: (await hasTable(db, 'campagnes')) && (await hasTable(db, 'campagne_leads')) });

  const idx = await rows(db, `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='campagne_leads'`);
  checks.push({
    label: 'index unique (campagne, lead) présent — un lead jamais dupliqué dans une campagne',
    ok: idx.some(r => r.name === 'campagne_leads_campagneId_leadId_key' && /UNIQUE/i.test(String(r.sql))),
  });
  for (const name of ['campagne_leads_campagneId_idx', 'campagne_leads_leadId_idx', 'campagne_leads_responsableId_idx']) {
    checks.push({ label: `index ${name} présent`, ok: idx.some(r => r.name === name) });
  }

  const colsOf = async (t: string) => (await rows(db, `SELECT name FROM pragma_table_info('${t}')`)).map(r => String(r.name));
  const campCols = await colsOf('campagnes');
  const expCamp = ['id', 'createdAt', 'updatedAt', 'nom', 'type', 'lieu', 'dateDebut', 'dateFin', 'dateSalonDebut', 'dateSalonFin', 'objectifRdv', 'active'];
  checks.push({ label: 'colonnes campagnes (12, dont les DEUX paires de dates)', ok: expCamp.every(c => campCols.includes(c)) && campCols.length === expCamp.length, detail: campCols.join(',') });
  const partCols = await colsOf('campagne_leads');
  const expPart = ['id', 'createdAt', 'updatedAt', 'campagneId', 'leadId', 'responsableId', 'segment', 'priorite', 'statutCampagne', 'bateauxAVoir', 'notes'];
  checks.push({ label: 'colonnes campagne_leads (11)', ok: expPart.every(c => partCols.includes(c)) && partCols.length === expPart.length, detail: partCols.join(',') });

  const seed = await rows(db, `SELECT id, nom, type, lieu, dateDebut, dateFin, dateSalonDebut, dateSalonFin, active FROM campagnes WHERE id='${CAMPAGNE_SEED_ID}'`);
  checks.push({ label: 'campagne « Grand Pavois 2026 » présente (salon, La Rochelle, active)', ok: seed.length === 1 && seed[0].type === 'salon' && seed[0].lieu === 'La Rochelle' && !!seed[0].active });
  if (seed.length === 1) {
    const s = seed[0];
    const todoDates = !String(s.dateFin) || !String(s.dateSalonDebut) || !String(s.dateSalonFin);
    checks.push({ label: `fenêtre d'activité ouverte au ${String(s.dateDebut)}`, ok: !!String(s.dateDebut) });
    if (todoDates) console.log('\n⚠️  TODO assumé : dateFin / dateSalonDebut / dateSalonFin restent à renseigner (UPDATE d\'une ligne, voir migration.sql).');
  }
  if (freshTables) {
    const n = await rows(db, 'SELECT COUNT(*) n FROM campagne_leads');
    checks.push({ label: 'tables neuves : 1 campagne, aucune participation', ok: Number(n[0].n) === 0 });
  }
  return checks;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'apply-campagnes-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const before = await campagnesBefore(db);
  const todo = await campagnesTodo(db);
  console.log(`\nCommerciaux : ${before.commercials.count} · leads : ${before.leads.count} · actions : ${before.actions.count}`);
  console.log(`Tables à créer : ${todo.tables.join(', ') || 'aucune (déjà migrée)'}`);
  console.log(`Campagne à créer : ${todo.seed.join(', ') || 'aucune'}`);
  console.log('Leads : AUCUNE écriture (la source d\'un lead est immuable).');

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD) après la sauvegarde.'); db.close(); return; }

  const tWrite = Date.now();
  const done = await applyCampagnesSchema(db);
  const writeMs = Date.now() - tWrite;
  console.log(`\nSchéma : tables créées ${done.createdTables.length} · campagnes créées ${done.insertedCampagnes.length}`);
  const checks = await proveCampagnes(db, before, done.createdTables.length === 2);
  db.close();
  console.log(`Durée : écriture ${writeMs} ms · total avec lectures et preuve ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail && !c.ok ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base (la sauvegarde permet la restauration).'); process.exit(1); }
  console.log('\n✅ Migration additive appliquée et prouvée.');
}

if (process.argv[1]?.includes('apply-campagnes-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
