/**
 * Harnais lot 5 — réseaux sociaux sur base SQLite JETABLE (jamais Turso) :
 * migration (script Turso), lecture d'une base pas encore migrée (sauvegarde),
 * API (store : upsert des réseaux et des stats, noms uniques, pas de DELETE),
 * restauration d'avant / d'après le lot 5.
 *
 * Exécution : npx tsx scripts/harness-social-db.ts
 */
import { createClient, type Client } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';
import { applyPlannedActionsSchema } from './apply-planned-actions-turso';
import { applyTemplateLayoutSchema } from './apply-template-layout-turso';
import { applyWeeklyObjectivesSchema } from './apply-weekly-objectives-turso';
import { applySocialSchema, socialTodo, socialBefore, proveSocial, DEFAULT_NETWORK_IDS } from './apply-social-turso';
import { getState, detectSchema, saveSocialNetworks, saveSocialStats, restoreBackup } from '../api/_lib/store';
import { parseRestorePayload } from '../api/_lib/validate';
import { HttpError, toHttpError } from '../api/_lib/http';
import type { AppState, SocialNetwork, SocialStat } from '../src/data/types';

const DB_FILE = path.resolve('.harness-social-db.db');
const PRISMA_DB_FILE = path.resolve('.harness-social-prisma.db');

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
  const idx = (await db.execute(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='${table}' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`)).rows.map(r => ({ ...r }));
  const fks = (await db.execute(`SELECT "table", "from", "to", on_delete, on_update FROM pragma_foreign_key_list('${table}') ORDER BY "from"`)).rows.map(r => ({ ...r }));
  return JSON.stringify({ cols, idx: idx.map(i => ({ name: i.name, sql: String(i.sql).replace(/\s+IF NOT EXISTS/i, '') })), fks });
}
/** Refus HTTP, avec le mapping d'erreurs réel de l'API (P2002 -> 409…). */
async function refusal(p: Promise<unknown>): Promise<HttpError | null> {
  try { await p; return null; } catch (e) { return toHttpError(e); }
}

const FB = 'reseau-facebook';
const IG = 'reseau-instagram';
const LI = 'reseau-linkedin';
const stat = (id: string, networkId: string, year: number, month: number, followers: number, over: Partial<SocialStat> = {}): SocialStat =>
  ({ id, networkId, year, month, followers, posts: null, reach: null, comment: '', ...over });

async function main() {
  rmSync(DB_FILE, { force: true });
  rmSync(PRISMA_DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  section('Mise en condition : base au lot 4 (état de la prod après les scripts 1 à 4)');
  await db.executeMultiple(migrationSql('_init_crm_schema'));
  await db.executeMultiple(migrationSql('_add_login_attempts'));
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);
  await applyPlannedActionsSchema(db);
  await applyTemplateLayoutSchema(db);
  await applyWeeklyObjectivesSchema(db);
  await db.execute(`INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES ('tom', 'Tom', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  for (let i = 0; i < 3; i++) {
    await db.execute({ sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition, boatInterest, brand, status, contactDate, currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate, lastActionDate, lossReason, signedAt, lostAt, reportedAt) VALUES (?, '2026-08-01', '2026-09-16T08:00:00Z', 'LBC', 'tom', 'P', 'T', '', '', '', '', '', '', 'contacte', '', '', '', '', 'neutre', 'normale', '', '', '', '', '', '', '')`, args: [`lead-${i}`] });
  }
  // Stats de l'ACQUISITION (MonthlyStat) : doivent rester strictement intactes.
  await db.execute(`INSERT INTO monthly_stats (id, createdAt, updatedAt, year, month, source, budget, leads) VALUES ('ms-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2026, 8, 'Facebook', 350, 12), ('ms-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 2026, 8, 'Le Bon Coin', NULL, 20)`);

  section('Base PAS ENCORE migrée au lot 5 : la sauvegarde sait la lire');
  let oldBackup: AppState;
  {
    const p = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
    const f = await detectSchema(p);
    check('schéma détecté : lots 2 à 4 oui, lot 5 non', f.lot2 && f.templateLayout && f.weeklyObjectives && !f.social, JSON.stringify(f));
    let full: unknown = null;
    try { await getState(p); } catch (e) { full = e; }
    check('lecture complète impossible (tables du lot 5 absentes) -> 503 « SCHEMA_NON_MIGRE »', full !== null && toHttpError(full).status === 503 && toHttpError(full).message.startsWith('SCHEMA_NON_MIGRE'));
    oldBackup = await getState(p, { features: f });
    check('lecture adaptée : 3 leads, 2 stats mensuelles, aucun champ réseaux inventé', oldBackup.leads.length === 3 && oldBackup.monthlyStats.length === 2 && !('socialNetworks' in oldBackup) && !('socialStats' in oldBackup));
    let restorable = true;
    try { parseRestorePayload({ format: 'bob-crm-backup', version: 1, data: oldBackup }); } catch { restorable = false; }
    check('ce fichier passe le validateur de restauration', restorable);
    await p.$disconnect();
  }

  section('Script Turso : à blanc, application, rejeu, preuve');
  const before = await socialBefore(db);
  const todo = await socialTodo(db);
  check('à blanc : 2 tables et 3 réseaux par défaut à créer', todo.tables.join() === 'social_networks,social_stats' && todo.defaultNetworks.join() === DEFAULT_NETWORK_IDS.join());
  check('à blanc : rien écrit', (await socialTodo(db)).tables.length === 2);
  const s1 = await applySocialSchema(db);
  check('application : 2 tables, 3 réseaux', s1.createdTables.length === 2 && s1.insertedNetworks.length === 3);
  for (const c of await proveSocial(db, before, true)) check(`preuve : ${c.label}`, c.ok, c.detail);
  // Un réseau renommé / archivé avant un rejeu ne doit JAMAIS être réécrit.
  await db.execute(`UPDATE social_networks SET name = 'Facebook BOB', archived = true WHERE id = '${FB}'`);
  const s2 = await applySocialSchema(db);
  check('rejeu : rien à faire, sans erreur', s2.createdTables.length === 0 && s2.insertedNetworks.length === 0);
  const fb = (await db.execute(`SELECT name, archived FROM social_networks WHERE id = '${FB}'`)).rows[0];
  check('rejeu : réseau renommé et archivé conservé tel quel (INSERT OR IGNORE)', fb.name === 'Facebook BOB' && Number(fb.archived) === 1);
  for (const c of await proveSocial(db, before, false)) check(`preuve après rejeu : ${c.label}`, c.ok, c.detail);
  await db.execute(`UPDATE social_networks SET name = 'Facebook', archived = false WHERE id = '${FB}'`);

  section('Migration Prisma (dev) et script Turso : MÊME schéma');
  {
    const pdb = createClient({ url: `file:${PRISMA_DB_FILE}` });
    await pdb.executeMultiple(migrationSql('_init_crm_schema'));
    await pdb.executeMultiple(migrationSql('_lot5_social'));
    check('schéma identique : social_networks', (await schemaOf(db, 'social_networks')) === (await schemaOf(pdb, 'social_networks')));
    check('schéma identique : social_stats (colonnes, index unique, clé étrangère)', (await schemaOf(db, 'social_stats')) === (await schemaOf(pdb, 'social_stats')));
    const ids = (await pdb.execute('SELECT id FROM social_networks ORDER BY position')).rows.map(r => r.id);
    check('migration Prisma : mêmes 3 réseaux par défaut', ids.join() === DEFAULT_NETWORK_IDS.join());
    pdb.close();
  }
  db.close();

  section('API (store) : réseaux');
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
  let st = await getState(prisma);
  check('getState : 3 réseaux par défaut, aucune stat', st.socialNetworks?.map(n => n.name).join() === 'Facebook,Instagram,LinkedIn' && st.socialStats?.length === 0);
  const nets: SocialNetwork[] = [...(st.socialNetworks ?? []), { id: 'yt', name: 'YouTube', position: 4, archived: false }];
  const saved = await saveSocialNetworks(prisma, nets);
  check('ajout d\'un réseau', saved.length === 4 && saved[3].name === 'YouTube');
  check('rejeu identique : idempotent', (await saveSocialNetworks(prisma, nets)).length === 4);
  await saveSocialNetworks(prisma, nets.map(n => (n.id === 'yt' ? { ...n, name: 'YouTube Shorts' } : n.id === LI ? { ...n, archived: true } : n)));
  st = await getState(prisma);
  check('renommage et archivage', st.socialNetworks?.find(n => n.id === 'yt')?.name === 'YouTube Shorts' && st.socialNetworks.find(n => n.id === LI)?.archived === true);
  const partial = await saveSocialNetworks(prisma, [{ id: 'tt', name: 'TikTok', position: 5, archived: false }]);
  check('liste partielle : aucun réseau retiré (upsert sans suppression)', partial.length === 5);
  const dup = await refusal(saveSocialNetworks(prisma, [{ id: 'fb2', name: ' facebook ', position: 6, archived: false }]));
  check('nom déjà pris (casse / espaces) : 409', dup?.status === 409, dup?.message);
  check('… rien écrit (transaction annulée)', (await prisma.socialNetwork.count()) === 5);
  const empty = await refusal(saveSocialNetworks(prisma, [{ id: 'x', name: '  ', position: 7, archived: false }]));
  check('nom vide : 400', empty?.status === 400);
  const notArray = await refusal(saveSocialNetworks(prisma, { id: 'x', name: 'X', position: 1, archived: false }));
  check('corps qui n\'est pas une liste : 400', notArray?.status === 400);

  section('API (store) : stats');
  const r1 = await saveSocialStats(prisma, [stat('s1', FB, 2026, 8, 1000, { posts: 6, reach: 5400, comment: 'Salon' }), stat('s2', IG, 2026, 8, 480)]);
  check('2 mois enregistrés', r1.length === 2 && (await prisma.socialStat.count()) === 2);
  const r2 = await saveSocialStats(prisma, [stat('autre-poste', FB, 2026, 8, 1020, { posts: 7, reach: null, comment: '' })]);
  const fbAug = await prisma.socialStat.findMany({ where: { networkId: FB, year: 2026, month: 8 } });
  check('même (réseau, mois) avec un AUTRE id : mise à jour, id existant gardé, aucun doublon', fbAug.length === 1 && fbAug[0].id === 's1' && r2[0].id === 's1' && fbAug[0].followers === 1020 && fbAug[0].reach === null && fbAug[0].comment === '');
  await saveSocialStats(prisma, [stat('s3', LI, 2026, 8, 90)]);
  check('réseau archivé : ses stats s\'enregistrent encore (historique)', (await prisma.socialStat.count()) === 3);
  const unknown = await refusal(saveSocialStats(prisma, [stat('s4', 'fantome', 2026, 9, 1)]));
  check('réseau inconnu : 400', unknown?.status === 400, unknown?.message);
  const noFollowers = await refusal(saveSocialStats(prisma, [{ ...stat('s4', FB, 2026, 9, 1), followers: null as unknown as number }]));
  check('abonnés absents : 400', noFollowers?.status === 400);
  const decimal = await refusal(saveSocialStats(prisma, [stat('s4', FB, 2026, 9, 10.5)]));
  check('abonnés décimaux : 400', decimal?.status === 400);
  const twice = await refusal(saveSocialStats(prisma, [stat('s4', FB, 2026, 9, 1), stat('s5', FB, 2026, 9, 2)]));
  check('deux lignes pour la même clé dans un envoi : 400', twice?.status === 400);
  const month13 = await refusal(saveSocialStats(prisma, [stat('s4', FB, 2026, 13, 1)]));
  check('mois 13 : 400', month13?.status === 400);
  check('refus : rien écrit', (await prisma.socialStat.count()) === 3);
  const idTaken = await refusal(saveSocialStats(prisma, [stat('s2', FB, 2026, 10, 1)]));
  check('id déjà utilisé par une autre clé : 409, rien écrit', idTaken?.status === 409 && (await prisma.socialStat.count()) === 3, idTaken?.message);
  const ms = await prisma.monthlyStat.findMany({ orderBy: { id: 'asc' } });
  check('stats mensuelles de l\'acquisition intactes', ms.length === 2 && ms[0].budget === 350 && ms[0].leads === 12 && ms[1].leads === 20);

  section('Aucune suppression');
  const src = readFileSync(path.resolve('api/[...slug].ts'), 'utf-8');
  for (const route of ['social-networks', 'social-stats']) {
    const start = src.indexOf(`case '${route}':`);
    const block = src.slice(start, src.indexOf('break;', start));
    check(`route ${route} : PUT seulement, aucun DELETE`, start !== -1 && /m === 'PUT'/.test(block) && !/m === '(DELETE|POST|PATCH)'/.test(block));
  }
  const store = readFileSync(path.resolve('api/_lib/store.ts'), 'utf-8');
  check('store : aucune suppression de réseau / stat hors restauration', (store.match(/social(Network|Stat)\.delete/g) ?? []).length === 2);

  section('Restauration');
  const roundtrip = await getState(prisma);
  const norm = (s: AppState) => JSON.stringify({
    n: [...(s.socialNetworks ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    s: [...(s.socialStats ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  });
  const rep = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: roundtrip });
  const after = await getState(prisma);
  check('sauvegarde d\'après le lot 5 : réseaux (renommés, archivés, ajoutés) et stats identiques', norm(after) === norm(roundtrip) && rep.socialNetworks === 5 && rep.socialStats === 3, `${rep.socialNetworks}/${rep.socialStats}`);
  const orphan = await refusal(restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: { ...roundtrip, socialStats: [...(roundtrip.socialStats ?? []), stat('orph', 'disparu', 2026, 1, 1)] } }));
  check('sauvegarde avec une stat d\'un réseau absent : 400, base intacte', orphan?.status === 400 && norm(await getState(prisma)) === norm(roundtrip));
  const dupNames = await refusal(restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: { ...roundtrip, socialNetworks: [...(roundtrip.socialNetworks ?? []), { id: 'bis', name: 'Instagram', position: 9, archived: false }] } }));
  check('sauvegarde avec deux réseaux du même nom : 400, base intacte', dupNames?.status === 400 && norm(await getState(prisma)) === norm(roundtrip));
  const rep2 = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: oldBackup });
  const afterOld = await getState(prisma);
  check('sauvegarde d\'AVANT le lot 5 : 3 leads, 3 réseaux par défaut, aucune stat', rep2.leads === 3 && afterOld.socialNetworks?.map(n => n.id).join() === DEFAULT_NETWORK_IDS.join() && afterOld.socialNetworks.every(n => !n.archived) && afterOld.socialStats?.length === 0 && rep2.socialStats === 0);
  check('… stats mensuelles de l\'acquisition restaurées à l\'identique', afterOld.monthlyStats.length === 2);

  await prisma.$disconnect();
  for (const f of [DB_FILE, PRISMA_DB_FILE]) { try { rmSync(f, { force: true }); } catch { /* verrou Windows */ } }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais réseaux sociaux (base) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
