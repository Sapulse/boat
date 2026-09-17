/**
 * Harnais lot 4 — objectifs de la semaine sur base SQLite JETABLE (jamais Turso) :
 * migration (script Turso), lecture d'une base pas encore migrée (sauvegarde),
 * API (store : upsert, 5 max, porteur, trace serveur, pas de DELETE),
 * restauration d'avant / d'après le lot 4.
 *
 * Exécution : npx tsx scripts/harness-weekly-objectives-db.ts
 */
import { createClient, type Client } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';
import { applyPlannedActionsSchema } from './apply-planned-actions-turso';
import { applyTemplateLayoutSchema } from './apply-template-layout-turso';
import {
  applyWeeklyObjectivesSchema, weeklyObjectivesTodo, weeklyObjectivesBefore, proveWeeklyObjectives,
} from './apply-weekly-objectives-turso';
import { applySocialSchema } from './apply-social-turso';
import { getState, detectSchema, upsertWeeklyObjective, restoreBackup } from '../api/_lib/store';
import { parseRestorePayload } from '../api/_lib/validate';
import { HttpError } from '../api/_lib/http';
import type { AppState, WeeklyObjective } from '../src/data/types';

const DB_FILE = path.resolve('.harness-weekly-objectives-db.db');
const PRISMA_DB_FILE = path.resolve('.harness-weekly-objectives-prisma.db');

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
  const fks = (await db.execute(`SELECT "table", "from", "to", on_delete, on_update FROM pragma_foreign_key_list('${table}') ORDER BY "from"`)).rows.map(r => ({ ...r }));
  return JSON.stringify({ cols, idx, fks });
}

// Jeudi 17/09/2026 10h à Paris : semaine du lundi 14/09.
const NOW = new Date('2026-09-17T08:00:00Z');
const WEEK = '2026-09-14';
const NEXT = '2026-09-21';
const PREV = '2026-09-07';

function obj(id: string, over: Partial<WeeklyObjective> = {}): WeeklyObjective {
  return {
    id, weekStart: WEEK, position: 1, text: `Objectif ${id}`, ownerId: null, done: false, doneAt: null, active: true,
    copiedFromId: null, modifiedAfterWeekAt: null, createdAt: '', updatedAt: '', ...over,
  };
}
async function refusal(p: Promise<unknown>): Promise<HttpError | null> {
  try { await p; return null; } catch (e) { return e instanceof HttpError ? e : null; }
}

async function main() {
  rmSync(DB_FILE, { force: true });
  rmSync(PRISMA_DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  section('Mise en condition : base au lot 3 (état de la prod après les scripts 1 à 3)');
  await db.executeMultiple(migrationSql('_init_crm_schema'));
  await db.executeMultiple(migrationSql('_add_login_attempts'));
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);
  await applyPlannedActionsSchema(db);
  await applyTemplateLayoutSchema(db);
  for (const [id, name, active] of [['tom', 'Tom', 1], ['fred', 'Fred', 1], ['ancien', 'Ancien', 0], ['na', 'Non attribué', 1]] as const) {
    await db.execute({ sql: `INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, args: [id, name, active] });
  }
  for (let i = 0; i < 4; i++) {
    await db.execute({ sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition, boatInterest, brand, status, contactDate, currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate, lastActionDate, lossReason, signedAt, lostAt, reportedAt) VALUES (?, '2026-08-01', '2026-09-16T08:00:00Z', 'LBC', 'tom', 'P', 'T', '', '', '', '', '', '', 'contacte', '', '', '', '', 'neutre', 'normale', '', '', '', '', '', '', '')`, args: [`lead-${i}`] });
  }

  section('Base PAS ENCORE migrée au lot 4 : la sauvegarde sait la lire');
  let oldBackup: AppState;
  {
    const p = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
    const f = await detectSchema(p);
    check('schéma détecté : lots 2 et 3 oui, lot 4 non', f.lot2 && f.templateLayout && !f.weeklyObjectives, JSON.stringify(f));
    let full: unknown = null;
    try { await getState(p); } catch (e) { full = e; }
    check('lecture complète impossible (table du lot 4 absente)', full !== null);
    oldBackup = await getState(p, { features: f });
    check('lecture adaptée : 4 leads, pas de champ weeklyObjectives inventé', oldBackup.leads.length === 4 && !('weeklyObjectives' in oldBackup));
    let restorable = true;
    try { parseRestorePayload({ format: 'bob-crm-backup', version: 1, data: oldBackup }); } catch { restorable = false; }
    check('ce fichier passe le validateur de restauration', restorable);
    await p.$disconnect();
  }

  section('Script Turso : à blanc, application, rejeu, preuve');
  const before = await weeklyObjectivesBefore(db);
  check('à blanc : 1 table à créer', (await weeklyObjectivesTodo(db)).tables.join() === 'weekly_objectives');
  check('à blanc : rien écrit', (await weeklyObjectivesTodo(db)).tables.length === 1);
  const s1 = await applyWeeklyObjectivesSchema(db);
  check('application : table créée', s1.createdTables.join() === 'weekly_objectives');
  for (const c of await proveWeeklyObjectives(db, before, true)) check(`preuve : ${c.label}`, c.ok, c.detail);
  const s2 = await applyWeeklyObjectivesSchema(db);
  check('rejeu : rien à faire, sans erreur', s2.createdTables.length === 0);
  for (const c of await proveWeeklyObjectives(db, before, false)) check(`preuve après rejeu : ${c.label}`, c.ok, c.detail);

  section('Migration Prisma (dev) et script Turso : MÊME schéma');
  {
    const pdb = createClient({ url: `file:${PRISMA_DB_FILE}` });
    await pdb.executeMultiple(migrationSql('_init_crm_schema'));
    await pdb.executeMultiple(migrationSql('_lot4_weekly_objectives'));
    check('schéma identique : weekly_objectives (colonnes, index, clé étrangère)', (await schemaOf(db, 'weekly_objectives')) === (await schemaOf(pdb, 'weekly_objectives')));
    pdb.close();
  }
  // Le lot 5 passe juste après (script 5) ; le code courant lit ses tables.
  await applySocialSchema(db);
  db.close();

  section('API (store) : upsert, règles, trace serveur');
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
  let st = await getState(prisma);
  check('getState : weeklyObjectives = []', Array.isArray(st.weeklyObjectives) && st.weeklyObjectives.length === 0);

  for (let i = 1; i <= 5; i++) await upsertWeeklyObjective(prisma, `o${i}`, obj(`o${i}`, { position: i, ownerId: i === 1 ? 'tom' : null }), NOW);
  st = await getState(prisma);
  check('5 objectifs créés, porteur Tom sur le 1er', st.weeklyObjectives?.length === 5 && st.weeklyObjectives[0].ownerId === 'tom');
  const r6 = await refusal(upsertWeeklyObjective(prisma, 'o6', obj('o6', { position: 6 }), NOW));
  check('6e objectif actif : 409', r6?.status === 409, r6?.message);
  check('… rien écrit', (await prisma.weeklyObjective.count()) === 5);
  check('6e objectif créé RETIRÉ : accepté (trace de préparation)', !!(await upsertWeeklyObjective(prisma, 'o6', obj('o6', { position: 6, active: false }), NOW)));
  const react = await refusal(upsertWeeklyObjective(prisma, 'o6', obj('o6', { position: 6, active: true }), NOW));
  check('réactiver le 6e dans une semaine pleine : 409', react?.status === 409);
  await upsertWeeklyObjective(prisma, 'o5', obj('o5', { position: 5, active: false }), NOW);
  check('retirer le 5e puis réactiver le 6e : accepté', (await upsertWeeklyObjective(prisma, 'o6', obj('o6', { position: 6, active: true }), NOW)).active);
  check('rejeu à l\'identique d\'un actif (semaine pleine) : accepté, idempotent', (await upsertWeeklyObjective(prisma, 'o6', obj('o6', { position: 6, active: true }), NOW)).active);

  const na = await refusal(upsertWeeklyObjective(prisma, 'n1', obj('n1', { weekStart: NEXT, ownerId: 'na' }), NOW));
  check('porteur « Non attribué » : 400', na?.status === 400, na?.message);
  const unknown = await refusal(upsertWeeklyObjective(prisma, 'n1', obj('n1', { weekStart: NEXT, ownerId: 'fantome' }), NOW));
  check('porteur inconnu : 400', unknown?.status === 400);
  const tuesday = await refusal(upsertWeeklyObjective(prisma, 'n1', obj('n1', { weekStart: '2026-09-22' }), NOW));
  check('semaine qui n\'est pas un lundi : 400', tuesday?.status === 400);
  const long = await refusal(upsertWeeklyObjective(prisma, 'n1', obj('n1', { weekStart: NEXT, text: 'a'.repeat(201) }), NOW));
  check('texte de 201 caractères : 400', long?.status === 400);
  const idMismatch = await refusal(upsertWeeklyObjective(prisma, 'autre', obj('n1', { weekStart: NEXT }), NOW));
  check('id du chemin différent du corps : 400', idMismatch?.status === 400);

  const next = await upsertWeeklyObjective(prisma, 'n1', obj('n1', { weekStart: NEXT, ownerId: 'ancien', copiedFromId: 'o1', modifiedAfterWeekAt: '2020-01-01T00:00:00Z' }), NOW);
  check('préparation semaine suivante : porteur désactivé mais connu accepté ; trace du client ignorée', next.ownerId === 'ancien' && next.modifiedAfterWeekAt === null && next.copiedFromId === 'o1');
  const moved = await upsertWeeklyObjective(prisma, 'n1', { ...next, weekStart: WEEK, copiedFromId: null }, NOW);
  check('la semaine et le lien de reprise ne changent pas', moved.weekStart === NEXT && moved.copiedFromId === 'o1');

  const done = await upsertWeeklyObjective(prisma, 'o1', obj('o1', { position: 1, ownerId: 'tom', done: true, doneAt: null }), NOW);
  check('atteint : doneAt posé par le serveur', done.done && done.doneAt === NOW.toISOString());

  // Semaine passée : créée « à l'époque », puis modifiée après sa fin.
  const thatWeek = new Date('2026-09-09T08:00:00Z');
  const p1 = await upsertWeeklyObjective(prisma, 'p1', obj('p1', { weekStart: PREV }), thatWeek);
  check('semaine passée créée pendant sa semaine : pas de trace', p1.modifiedAfterWeekAt === null);
  const replay = await upsertWeeklyObjective(prisma, 'p1', { ...p1 }, NOW);
  check('rejeu identique après la fin de semaine : pas de trace', replay.modifiedAfterWeekAt === null);
  const lateEdit = await upsertWeeklyObjective(prisma, 'p1', { ...p1, done: true }, NOW);
  check('modifiée après la fin de semaine : trace posée par le serveur', lateEdit.modifiedAfterWeekAt === NOW.toISOString());
  const erase = await upsertWeeklyObjective(prisma, 'p1', { ...lateEdit, modifiedAfterWeekAt: null }, new Date('2026-09-18T08:00:00Z'));
  check('le client ne peut pas effacer la trace', erase.modifiedAfterWeekAt === NOW.toISOString());
  check('dimanche 23h30 UTC = lundi à Paris : semaine finie', (await upsertWeeklyObjective(prisma, 'o2', obj('o2', { position: 2, text: 'Modifié tard' }), new Date('2026-09-20T22:30:00Z'))).modifiedAfterWeekAt === '2026-09-20T22:30:00.000Z');

  section('Aucune suppression');
  const src = readFileSync(path.resolve('api/[...slug].ts'), 'utf-8');
  const block = src.slice(src.indexOf("case 'weekly-objectives':"), src.indexOf("case 'goals':"));
  check('route weekly-objectives : PUT seulement, aucun DELETE', /m === 'PUT'/.test(block) && !/m === '(DELETE|POST|PATCH)'/.test(block));
  check('store : aucune suppression d\'objectif hors restauration', (readFileSync(path.resolve('api/_lib/store.ts'), 'utf-8').match(/weeklyObjective\.delete/g) ?? []).length === 1);

  section('Restauration');
  const roundtrip = await getState(prisma);
  // createdAt / updatedAt : colonnes d'audit remises à l'heure du jour par la restauration.
  const norm = (s: AppState) => JSON.stringify((s.weeklyObjectives ?? []).map(o => ({ ...o, createdAt: '', updatedAt: '' })).sort((a, b) => a.id.localeCompare(b.id)));
  const rep = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: roundtrip });
  const after = await getState(prisma);
  check('sauvegarde d\'après le lot 4 : objectifs identiques (atteints, retirés, traces, porteurs, liens)', norm(after) === norm(roundtrip) && rep.weeklyObjectives === roundtrip.weeklyObjectives?.length, `${rep.weeklyObjectives}`);
  const rep2 = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: oldBackup });
  const afterOld = await getState(prisma);
  check('sauvegarde d\'AVANT le lot 4 : restaurable, 4 leads, aucun objectif', rep2.leads === 4 && rep2.weeklyObjectives === 0 && afterOld.weeklyObjectives?.length === 0);

  await prisma.$disconnect();
  for (const f of [DB_FILE, PRISMA_DB_FILE]) { try { rmSync(f, { force: true }); } catch { /* verrou Windows */ } }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais objectifs de la semaine (base) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
