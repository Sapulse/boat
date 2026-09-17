/**
 * Harnais lot 2 — MIGRATION + REPRISE + API sur base SQLite JETABLE (jamais Turso).
 *
 * Exécution : npx tsx scripts/harness-planned-actions-db.ts
 *
 * Reproduit la prod du 2026-09-16 (schéma init + login_attempts + inbound_emails,
 * AUCUNE table du lot 2) avec des données de la même forme : 437 leads dont 11
 * avec une prochaine action (9 échues, heures absentes sauf cas de test), 98
 * lignes d'historique, un commercial « Non attribué ». Puis exerce EXACTEMENT
 * le code du script Turso (scripts/apply-planned-actions-turso.ts) :
 *  - schéma : colonnes ajoutées par ALTER, tables créées, rejouable ;
 *  - AUCUNE ligne métier modifiée (empreintes colonnes d'origine) ;
 *  - reprise : 11 actions, idempotente, champs identiques, responsable = commercial ;
 *  - preuve du script : tous les contrôles verts ;
 *  - migration Prisma (dev) et script Turso produisent le MÊME schéma ;
 *  - API (store) sur la base migrée : getState, upsert idempotent avec
 *    personnes (retrait = active false, aucun DELETE), refus 400, restauration
 *    d'une sauvegarde d'AVANT le lot 2 (reprise appliquée) et d'APRÈS (round-trip).
 */
import { createClient, type Client } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';
import { applyTemplateLayoutSchema } from './apply-template-layout-turso';
import { applyWeeklyObjectivesSchema } from './apply-weekly-objectives-turso';
import {
  applyPlannedActionsSchema, planReprise, applyReprise, proveMigration, leadsFingerprint, actionsFingerprint,
} from './apply-planned-actions-turso';
import { getState, upsertPlannedAction, restoreBackup, hasLot2Schema, updateLead } from '../api/_lib/store';
import { parseRestorePayload } from '../api/_lib/validate';
import { HttpError, toHttpError, SCHEMA_NOT_MIGRATED } from '../api/_lib/http';
import type { AppState, PlannedAction } from '../src/data/types';

const DB_FILE = path.resolve('.harness-planned-actions-db.db');
const PRISMA_DB_FILE = path.resolve('.harness-planned-actions-prisma.db');

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

async function prodLikeSchema(db: Client) {
  await db.executeMultiple(migrationSql('_init_crm_schema'));
  await db.executeMultiple(migrationSql('_add_login_attempts'));
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);
}

async function schemaOf(db: Client, table: string): Promise<string> {
  const cols = (await db.execute(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY name`)).rows.map(r => ({ ...r }));
  const idx = (await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='${table}' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`)).rows.map(r => r.name);
  const fks = (await db.execute(`SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('${table}') ORDER BY "from"`)).rows.map(r => ({ ...r }));
  return JSON.stringify({ cols, idx, fks });
}

async function expectStatus(label: string, status: number, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, 'aucune erreur'); }
  catch (e) { check(label, e instanceof HttpError && e.status === status, `${(e as HttpError).status} ${(e as Error).message}`); }
}

async function main() {
  rmSync(DB_FILE, { force: true });
  rmSync(PRISMA_DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  section('Mise en condition « prod du 16/09 » : 437 leads, 11 prochaines actions, 98 lignes d\'historique');
  await prodLikeSchema(db);
  for (const [id, name] of [['tom', 'Tom'], ['fred', 'Fred'], ['oceane', 'Océane'], ['nicolas', 'Nicolas'], ['na', 'Non attribué']]) {
    await db.execute({ sql: `INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, args: [id, name] });
  }
  const owners = ['tom', 'fred', 'oceane', 'nicolas', 'na'];
  const nextTypes = ['appel', 'devis', 'relance', 'sms', 'whatsapp'];
  for (let i = 0; i < 437; i++) {
    const withNext = i < 11;
    const date = withNext ? (i < 9 ? `2026-09-0${1 + i}` : `2026-09-${20 + i}`) : '';
    await db.execute({
      sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition,
              boatInterest, brand, budget, status, contactDate, quoteAmount, probability, currentBoat, comments, deliveryDate,
              temperature, priority, nextActionType, nextActionDate, nextActionTime, nextActionEndTime, lastActionDate, lossReason, signedAt, lostAt, reportedAt)
            VALUES (?, '2026-08-01', '2026-09-16T08:10:26.562+00:00', 'LBC', ?, ?, 'Test', '', ?, '', '', 'Zodiac', '', NULL, ?, '', NULL, NULL, '', '', '',
              'neutre', 'normale', ?, ?, ?, ?, '2026-09-01', '', '', '', '')`,
      args: [`lead-${String(i).padStart(3, '0')}`, owners[i % 5], `P${i}`, `p${i}@t.fr`, i % 7 === 0 ? 'perdu' : 'contacte',
        withNext ? nextTypes[i % 5] : '', date, i === 10 ? '14:30' : null, i === 10 ? '15:00' : null],
    });
  }
  for (let i = 0; i < 98; i++) {
    await db.execute({
      sql: `INSERT INTO lead_actions (id, createdAt, updatedAt, leadId, authorId, type, date, result, notes, newStatus, nextActionType, nextActionDate)
            VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, 'email', '2026-09-01', 'Email envoyé', '', NULL, NULL, NULL)`,
      args: [`act-${i}`, `lead-${String(i % 437).padStart(3, '0')}`, owners[i % 4]],
    });
  }
  const before = { leads: await leadsFingerprint(db), actions: await actionsFingerprint(db) };
  check('437 leads et 98 lignes d\'historique en place', before.leads.count === 437 && before.actions.count === 98);

  section('Sauvegarde AVANT migration, avec le code du lot 2 (procédure imposée)');
  {
    const legacyPrisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
    check('schéma détecté : pas encore migré', !(await hasLot2Schema(legacyPrisma)));
    let full: unknown = null;
    try { await getState(legacyPrisma); } catch (e) { full = e; }
    check('la lecture COMPLÈTE échoue bien sur l\'ancien schéma (d\'où le mode dédié)', full !== null);
    const mapped = toHttpError(full);
    check('garde-fou déploiement prématuré : erreur réelle -> 503 « SCHEMA_NON_MIGRE » (pas un 500 anonyme)',
      mapped.status === 503 && mapped.message.startsWith(SCHEMA_NOT_MIGRATED), `${mapped.status} ${mapped.message}`);
    const old = await getState(legacyPrisma, { schema: 'avant-lot2' });
    check('lecture « avant-lot2 » : 437 leads, 98 lignes, sans plannedActions', old.leads.length === 437 && old.actions.length === 98 && !('plannedActions' in old));
    check('lecture « avant-lot2 » : aucune colonne du lot 2 inventée', old.leads.every(l => !('noNextActionReason' in l)) && old.actions.every(a => !('kind' in a)));
    let restorable = true;
    try { parseRestorePayload({ format: 'bob-crm-backup', version: 1, data: old }); } catch { restorable = false; }
    check('le fichier produit passe le validateur de restauration', restorable);
    await legacyPrisma.$disconnect();
    check('la sauvegarde n\'a rien écrit (leads identiques)', (await leadsFingerprint(db)).sha256 === before.leads.sha256);
  }

  section('À blanc : rien n\'est écrit');
  const plan = await planReprise(db);
  check('11 prochaines actions à reprendre détectées', plan.length === 11, String(plan.length));
  check('lecture à blanc : aucune table du lot 2 créée', (await db.execute(`SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('planned_actions','planned_action_people')`)).rows[0].n === 0);
  check('lecture à blanc : leads intacts', (await leadsFingerprint(db)).sha256 === before.leads.sha256);

  section('Schéma : ajouts seulement, rejouable');
  const s1 = await applyPlannedActionsSchema(db);
  check('4 colonnes ajoutées', s1.addedColumns.length === 4, s1.addedColumns.join(','));
  check('2 tables créées', s1.createdTables.length === 2);
  const s2 = await applyPlannedActionsSchema(db);
  check('rejouer : 0 colonne, 0 table (idempotent, sans erreur)', s2.addedColumns.length === 0 && s2.createdTables.length === 0);
  check('aucune table recréée : colonnes d\'origine des leads identiques ligne à ligne', (await leadsFingerprint(db)).sha256 === before.leads.sha256);
  check('historique identique ligne à ligne', (await actionsFingerprint(db)).sha256 === before.actions.sha256);

  section('Reprise : 11 actions, une seule fois');
  const inserted = await applyReprise(db, plan, '2026-09-16T20:00:00.000Z');
  check('11 insérées', inserted === 11);
  const again = await applyReprise(db, await planReprise(db), '2026-09-16T20:05:00.000Z');
  check('rejouer (nouveau calcul) : 0 insérée', again === 0);
  const replay = await applyReprise(db, plan, '2026-09-16T20:06:00.000Z');
  check('rejouer (même plan, INSERT OR IGNORE) : 0 insérée', replay === 0);
  check('11 lignes en base, 11 responsables', Number((await db.execute(`SELECT COUNT(*) n FROM planned_actions`)).rows[0].n) === 11
    && Number((await db.execute(`SELECT COUNT(*) n FROM planned_action_people WHERE role='responsable' AND active=1`)).rows[0].n) === 11);
  const checks = await proveMigration(db, before, plan);
  for (const c of checks) check(`preuve du script : ${c.label}`, c.ok, c.detail);

  section('Migration Prisma (dev) et script Turso : MÊME schéma');
  const pdb = createClient({ url: `file:${PRISMA_DB_FILE}` });
  await prodLikeSchema(pdb);
  await pdb.executeMultiple(migrationSql('_lot2_planned_actions'));
  for (const t of ['leads', 'lead_actions', 'planned_actions', 'planned_action_people']) {
    check(`schéma identique : ${t}`, (await schemaOf(db, t)) === (await schemaOf(pdb, t)));
  }
  pdb.close();

  section('API (store) sur la base migrée');
  // Fenêtre de maintenance : le lot 3 (rangement des modèles) passe juste après le
  // lot 2 ; le code courant lit ses colonnes. Idem lot 4 (objectifs de la semaine).
  await applyTemplateLayoutSchema(db);
  await applyWeeklyObjectivesSchema(db);
  db.close();
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${DB_FILE}` }) });
  const st = await getState(prisma);
  check('getState : 11 actions programmées, personnes incluses', st.plannedActions.length === 11 && st.plannedActions.every(p => p.people.length === 1));
  const reprise10 = st.plannedActions.find(p => p.leadId === 'lead-010')!;
  check('reprise avec heures : 14:30 – 15:00 conservées', reprise10.time === '14:30' && reprise10.endTime === '15:00');
  check('getState : leads avec motif vide, historique en « realisee »', st.leads.every(l => l.noNextActionReason === '') && st.actions.every(a => a.kind === 'realisee'));
  check('getState : résumé du lead = action reprise', st.leads.find(l => l.id === 'lead-010')!.nextActionDate === reprise10.date);

  const newPa: PlannedAction = {
    id: 'pa-new', leadId: 'lead-100', type: 'rdv', customLabel: '', date: '2026-09-30', time: '10:00', endTime: undefined,
    originalDate: '2026-09-30', note: 'Essai', status: 'a_faire',
    people: [{ commercialId: 'tom', role: 'responsable' }, { commercialId: 'fred', role: 'participant' }],
  };
  const created = await upsertPlannedAction(prisma, 'pa-new', newPa);
  check('PUT création : 2 personnes', created.people.length === 2 && created.people[0].role === 'responsable');
  const same = await upsertPlannedAction(prisma, 'pa-new', newPa);
  check('PUT rejoué à l\'identique : même résultat (idempotent)', JSON.stringify(same) === JSON.stringify(created));
  const withoutFred = await upsertPlannedAction(prisma, 'pa-new', { ...newPa, date: '2026-10-02', people: [{ commercialId: 'tom', role: 'responsable' }, { commercialId: 'nicolas', role: 'participant' }] });
  check('PUT : Fred retiré, Nicolas ajouté', withoutFred.people.map(p => p.commercialId).sort().join() === 'nicolas,tom');
  const rows = await prisma.plannedActionPerson.findMany({ where: { plannedActionId: 'pa-new' } });
  check('retrait = active false (ligne CONSERVÉE, aucun DELETE)', rows.length === 3 && rows.some(r => r.commercialId === 'fred' && r.active === false));
  const refred = await upsertPlannedAction(prisma, 'pa-new', newPa);
  check('Fred réintégré : réactivé (pas de doublon)', refred.people.some(p => p.commercialId === 'fred') && (await prisma.plannedActionPerson.count({ where: { plannedActionId: 'pa-new' } })) === 3);
  const done = await upsertPlannedAction(prisma, 'pa-new', { ...newPa, status: 'faite', doneAt: '2026-09-30T10:30:00Z', doneActionId: 'act-1' });
  check('PUT status faite + lien historique', done.status === 'faite' && done.doneActionId === 'act-1');

  // Arrêt 4 : le serveur fait foi pour le résumé nextAction* (onglet resté ouvert).
  const leadOf = async (id: string) => (await getState(prisma)).leads.find(l => l.id === id)!;
  await upsertPlannedAction(prisma, 'pa-sum', { ...newPa, id: 'pa-sum', date: '2026-10-05', time: '09:00', status: 'a_faire', doneAt: undefined, doneActionId: undefined });
  const l1 = await leadOf('lead-100');
  check('résumé : PUT action à faire -> résumé du lead recalculé par le serveur', l1.nextActionDate === '2026-10-05' && l1.nextActionType === 'rdv' && l1.nextActionTime === '09:00', `${l1.nextActionType} ${l1.nextActionDate} ${l1.nextActionTime}`);
  const stale = await updateLead(prisma, 'lead-100', { ...l1, phone: '0611223344', nextActionDate: '2026-09-21', nextActionType: 'relance', nextActionTime: undefined });
  check('résumé : PATCH lead avec une ANCIENNE date (onglet en retard) -> date de l\'action conservée', stale.nextActionDate === '2026-10-05' && stale.nextActionType === 'rdv' && stale.phone === '0611223344', `${stale.nextActionDate} ${stale.phone}`);
  const withReason = await updateLead(prisma, 'lead-100', { noNextActionReason: 'A acheté ailleurs', noNextActionAt: '2026-09-16T10:00:00Z' });
  check('résumé : le serveur ne touche jamais au motif « Aucune » (ordre des écritures)', withReason.noNextActionReason === 'A acheté ailleurs' && withReason.nextActionDate === '2026-10-05');
  await upsertPlannedAction(prisma, 'pa-sum', { ...newPa, id: 'pa-sum', date: '2026-10-05', time: '09:00', status: 'annulee', doneAt: undefined, doneActionId: undefined });
  const l2 = await leadOf('lead-100');
  check('résumé : action annulée -> résumé vidé, motif conservé', l2.nextActionDate === '' && l2.nextActionType === '' && l2.nextActionTime === undefined && l2.noNextActionReason === 'A acheté ailleurs', `${l2.nextActionDate}|${l2.nextActionTime}|${l2.noNextActionReason}`);
  const free = st.leads.find(l => !st.plannedActions.some(p => p.leadId === l.id) && l.id !== 'lead-100')!;
  const kept = await updateLead(prisma, free.id, { nextActionDate: '2026-11-01', nextActionType: 'appel' });
  check('résumé : lead SANS aucune action programmée -> champs laissés tels quels (import, ancien)', kept.nextActionDate === '2026-11-01' && kept.nextActionType === 'appel');
  await expectStatus('id du corps ≠ id du chemin -> 400', 400, () => upsertPlannedAction(prisma, 'autre-id', newPa));
  await expectStatus('sans responsable -> 400', 400, () => upsertPlannedAction(prisma, 'pa-x', { ...newPa, id: 'pa-x', people: [{ commercialId: 'tom', role: 'participant' }] }));
  await expectStatus('personne en double -> 400', 400, () => upsertPlannedAction(prisma, 'pa-x', { ...newPa, id: 'pa-x', people: [{ commercialId: 'tom', role: 'responsable' }, { commercialId: 'tom', role: 'participant' }] }));
  await expectStatus('statut inconnu -> 400', 400, () => upsertPlannedAction(prisma, 'pa-x', { ...newPa, id: 'pa-x', status: 'supprimee' as PlannedAction['status'] }));
  await expectStatus('changer le lead d\'une action existante -> 400', 400, () => upsertPlannedAction(prisma, 'pa-new', { ...newPa, leadId: 'lead-200' }));
  let fkRefused = false;
  try { await upsertPlannedAction(prisma, 'pa-x', { ...newPa, id: 'pa-x', leadId: 'lead-inexistant' }); } catch { fkRefused = true; }
  check('lead inexistant -> refus (clé étrangère), rien écrit', fkRefused && (await prisma.plannedAction.count({ where: { id: 'pa-x' } })) === 0);

  section('Restauration : sauvegarde d\'AVANT le lot 2, puis d\'APRÈS');
  const full = await getState(prisma);
  const oldBackup = { ...full } as Partial<AppState>;
  delete oldBackup.plannedActions;
  const oldData = {
    ...oldBackup,
    leads: full.leads.map(l => { const c = { ...l }; delete c.noNextActionReason; delete c.noNextActionAt; return c; }),
    actions: full.actions.map(a => { const c = { ...a }; delete c.kind; delete c.plannedActionId; return c; }),
  };
  const repOld = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: oldData as unknown as AppState });
  const afterOld = await getState(prisma);
  check('sauvegarde d\'avant le lot 2 acceptée', repOld.leads === 437 && afterOld.leads.length === 437);
  check('ses prochaines actions sont REPRISES (11 + celle posée sur le résumé du lead-100)', afterOld.plannedActions.length === repOld.plannedActions
    && afterOld.plannedActions.every(p => p.id.startsWith('pa-reprise-')), `${afterOld.plannedActions.length}`);
  const roundtrip = await getState(prisma);
  await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: roundtrip });
  const after = await getState(prisma);
  const norm = (s: AppState) => JSON.stringify([...s.plannedActions].sort((a, b) => a.id.localeCompare(b.id)));
  check('sauvegarde d\'après le lot 2 : actions programmées identiques (round-trip)', norm(after) === norm(roundtrip) && after.plannedActions.length > 0);

  await prisma.$disconnect();
  for (const f of [DB_FILE, PRISMA_DB_FILE]) { try { rmSync(f, { force: true }); } catch { /* verrou Windows */ } }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
