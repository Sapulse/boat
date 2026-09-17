/**
 * Harnais — script de cohérence / réalignement « prochaine action du lead » ↔
 * « action programmée à faire » (scripts/realign-planned-actions-turso.ts), sur base
 * SQLite JETABLE (jamais Turso) : les 4 cas, lecture sans écriture, --apply, preuve,
 * rejeu sans effet, refus sans verrou.
 *
 * Exécution : npx tsx scripts/harness-realign-db.ts
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';
import { applyPlannedActionsSchema } from './apply-planned-actions-turso';
import { applyTemplateLayoutSchema } from './apply-template-layout-turso';
import { applyWeeklyObjectivesSchema } from './apply-weekly-objectives-turso';
import { applySocialSchema } from './apply-social-turso';
import {
  detectDivergences, applyRealignment, proveRealignment, leadsRealignFingerprint, printReport, REALIGN_SQL, realignPlannedId,
} from './realign-planned-actions-turso';
import { pendingActionOf, summarizeNextAction } from '../src/lib/plannedActions';
import type { PlannedAction } from '../src/data/types';

const DB_FILE = path.resolve('.harness-realign-db.db');

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
const rows = async (db: Client, sql: string) => (await db.execute(sql)).rows.map(r => ({ ...r }));
/** Empreinte de TOUTES les tables (contenu complet). */
async function dbHash(db: Client): Promise<string> {
  const h = createHash('sha256');
  for (const t of (await rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).map(r => String(r.name))) {
    h.update(t + JSON.stringify(await rows(db, `SELECT * FROM "${t}" ORDER BY rowid`)));
  }
  return h.digest('hex');
}

async function lead(db: Client, id: string, commercialId: string, next: { type?: string; date?: string; time?: string; end?: string } = {}, status = 'contacte') {
  await db.execute({
    sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition, boatInterest, brand, status, contactDate, currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate, nextActionTime, nextActionEndTime, lastActionDate, lossReason, signedAt, lostAt, reportedAt)
          VALUES (?, '2026-08-01', '2026-09-16T08:00:00Z', 'LBC', ?, 'Prénom', ?, '0600000000', 'secret@exemple.fr', '', '', '', '', ?, '', '', '', '', 'neutre', 'normale', ?, ?, ?, ?, '2026-09-10', '', '', '', '')`,
    args: [id, commercialId, `Nom-${id}`, status, next.type ?? '', next.date ?? '', next.time ?? null, next.end ?? null] as InValue[],
  });
}
async function planned(db: Client, id: string, leadId: string, p: { type: string; date: string; time?: string; label?: string; status?: string }, responsable = 'tom') {
  await db.execute({
    sql: `INSERT INTO planned_actions (id, createdAt, updatedAt, leadId, type, customLabel, date, time, endTime, originalDate, note, status) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, NULL, ?, '', ?)`,
    args: [id, leadId, p.type, p.label ?? '', p.date, p.time ?? null, p.date, p.status ?? 'a_faire'] as InValue[],
  });
  await db.execute({ sql: `INSERT INTO planned_action_people (id, createdAt, updatedAt, plannedActionId, commercialId, role, active) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, 'responsable', 1)`, args: [`${id}:${responsable}`, id, responsable] });
}
const ids = (l: { leadId: string }[]) => l.map(d => d.leadId).sort().join();

async function main() {
  rmSync(DB_FILE, { force: true });
  const db = createClient({ url: `file:${DB_FILE}` });

  section('Mise en condition : base v4 (5 migrations) après un passage sur l\'ancien code');
  await db.executeMultiple(migrationSql('_init_crm_schema'));
  await db.executeMultiple(migrationSql('_add_login_attempts'));
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);
  await applyPlannedActionsSchema(db);
  await applyTemplateLayoutSchema(db);
  await applyWeeklyObjectivesSchema(db);
  await applySocialSchema(db);
  for (const [id, name] of [['tom', 'Tom'], ['fred', 'Fred'], ['na', 'Non attribué']]) {
    await db.execute({ sql: `INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, args: [id, name] });
  }
  // Cohérents : aucune divergence
  await lead(db, 'ok1', 'tom', { type: 'appel', date: '2026-09-20', time: '10:00' });
  await planned(db, 'p-ok1', 'ok1', { type: 'appel', date: '2026-09-20', time: '10:00' });
  await lead(db, 'okAutre', 'tom', { type: '', date: '2026-09-21' });
  await planned(db, 'p-okAutre', 'okAutre', { type: 'autre', date: '2026-09-21', label: 'Prochaine action' });
  await lead(db, 'vide', 'tom');
  // A : date reportée sur l'ancien code / heure ajoutée / type changé
  await lead(db, 'a1', 'fred', { type: 'appel', date: '2026-09-22' });
  await planned(db, 'p-a1', 'a1', { type: 'appel', date: '2026-08-14' }, 'fred');
  await lead(db, 'a2', 'tom', { type: 'rdv', date: '2026-09-25', time: '14:00', end: '15:00' });
  await planned(db, 'p-a2', 'a2', { type: 'rdv', date: '2026-09-25' });
  await lead(db, 'a3', 'tom', { type: 'email', date: '2026-09-26' });
  await planned(db, 'p-a3', 'a3', { type: 'autre', date: '2026-09-26', label: 'Prochaine action' });
  // B : action ajoutée sur l'ancien code (aucune action programmée) / seulement une action annulée / Non attribué
  await lead(db, 'b1', 'tom', { type: 'relance', date: '2026-09-20' });
  await lead(db, 'b2', 'fred', { type: 'appel', date: '2026-09-23' });
  await planned(db, 'p-b2-annulee', 'b2', { type: 'appel', date: '2026-09-01', status: 'annulee' }, 'fred');
  await lead(db, 'bNA', 'na', { type: 'appel', date: '2026-09-24' });
  // C : action à faire, résumé vide
  await lead(db, 'c1', 'tom');
  await planned(db, 'p-c1', 'c1', { type: 'appel', date: '2026-09-27' });
  // D : Signé avec action cohérente (info) ; Perdu avec action divergente (info + A)
  await lead(db, 'd1', 'tom', { type: 'rdv', date: '2026-10-01' }, 'signe');
  await planned(db, 'p-d1', 'd1', { type: 'rdv', date: '2026-10-01' });
  await lead(db, 'd2', 'tom', { type: 'appel', date: '2026-10-05' }, 'perdu');
  await planned(db, 'p-d2', 'd2', { type: 'appel', date: '2026-10-02' });

  section('Lecture seule : les 4 cas, rien n\'est écrit');
  const h0 = await dbHash(db);
  const r = await detectDivergences(db);
  check('A : date (a1), heure (a2), type (a3), Perdu divergent (d2)', ids(r.A) === 'a1,a2,a3,d2', ids(r.A));
  check('B : b1, b2 (action annulée seulement), bNA', ids(r.B) === 'b1,b2,bNA', ids(r.B));
  check('B sans commercial : bNA seulement', ids(r.bNonAttribues) === 'bNA');
  check('C : c1', ids(r.C) === 'c1');
  check('D (information) : d1 et d2', ids(r.D) === 'd1,d2');
  check('cohérents non signalés (dont type vide = « Autre »)', ![...r.A, ...r.B, ...r.C].some(d => ['ok1', 'okAutre', 'vide', 'd1'].includes(d.leadId)));
  const a1 = r.A.find(d => d.leadId === 'a1');
  check('valeurs des deux côtés : lead 22/09, action 14/08, commercial Fred', a1?.lead.date === '2026-09-22' && a1?.action?.date === '2026-08-14' && a1?.commercial === 'Fred');
  const out: string[] = [];
  printReport(r, s => out.push(s));
  const text = out.join('\n');
  check('sortie : compteurs par cas', text.includes('A : 4 · B : 3 (dont 1 sans commercial) · C : 1 · D : 2 (info)'), out[0]);
  check('sortie : nom et commercial, jamais d\'email ni de téléphone', text.includes('Prénom Nom-a1') && text.includes('Fred') && !text.includes('secret@exemple.fr') && !text.includes('0600000000'));
  check('lecture : base identique (aucune écriture)', (await dbHash(db)) === h0);

  section('--apply : les champs du lead font foi, en une transaction');
  const leadsBefore = await leadsRealignFingerprint(db);
  const actionsBefore = Number((await rows(db, 'SELECT COUNT(*) n FROM lead_actions'))[0].n);
  const done = await applyRealignment(db, r, new Date('2026-09-17T12:00:00Z'));
  check('4 actions à faire mises à jour, 2 traces « report » (a1, d2), 2 créations (b1, b2)', done.updated === 4 && done.reports === 2 && done.created === 2, JSON.stringify(done));
  const pa1 = (await rows(db, `SELECT date, originalDate, customLabel FROM planned_actions WHERE id = 'p-a1'`))[0];
  check('A date : action au 22/09, date d\'origine conservée (14/08)', pa1.date === '2026-09-22' && pa1.originalDate === '2026-08-14');
  const trace = await rows(db, `SELECT kind, plannedActionId, authorId, result, date FROM lead_actions WHERE leadId = 'a1'`);
  check('A date : trace « report » liée, auteur = responsable (Fred), libellé lisible', trace.length === 1 && trace[0].kind === 'report' && trace[0].plannedActionId === 'p-a1' && trace[0].authorId === 'fred' && /reporté au 22\/09/.test(String(trace[0].result)), JSON.stringify(trace));
  const pa2 = (await rows(db, `SELECT time, endTime FROM planned_actions WHERE id = 'p-a2'`))[0];
  check('A heure : 14:00-15:00, sans trace (date inchangée)', pa2.time === '14:00' && pa2.endTime === '15:00' && (await rows(db, `SELECT id FROM lead_actions WHERE leadId = 'a2'`)).length === 0);
  const pa3 = (await rows(db, `SELECT type, customLabel FROM planned_actions WHERE id = 'p-a3'`))[0];
  check('A type : « Autre » devient email, libellé libre vidé', pa3.type === 'email' && pa3.customLabel === '');
  const b1 = await rows(db, `SELECT p.id, p.type, p.date, p.originalDate, p.status, x.commercialId, x.role FROM planned_actions p JOIN planned_action_people x ON x.plannedActionId = p.id WHERE p.leadId = 'b1'`);
  check('B : action créée (relance 20/09, à faire), responsable = commercial du lead', b1.length === 1 && b1[0].id === realignPlannedId('b1', '2026-09-20') && b1[0].type === 'relance' && b1[0].status === 'a_faire' && b1[0].commercialId === 'tom' && b1[0].role === 'responsable');
  check('B : action annulée conservée, nouvelle action à faire pour b2', (await rows(db, `SELECT status FROM planned_actions WHERE leadId = 'b2' ORDER BY status`)).map(x => x.status).join() === 'a_faire,annulee');
  check('B sans commercial : rien créé', (await rows(db, `SELECT id FROM planned_actions WHERE leadId = 'bNA'`)).length === 0);
  check('C : action à faire intacte', (await rows(db, `SELECT date, status FROM planned_actions WHERE id = 'p-c1'`))[0].date === '2026-09-27');
  const proof = await proveRealignment(db, r, leadsBefore);
  for (const c of proof) check(`preuve : ${c.label}`, c.ok, c.detail);
  check('historique : seules les 2 traces ajoutées', Number((await rows(db, 'SELECT COUNT(*) n FROM lead_actions'))[0].n) === actionsBefore + 2);

  section('Cohérence avec les règles de la v4');
  const leads = await rows(db, 'SELECT id, nextActionType, nextActionDate, nextActionTime FROM leads');
  const plannedRows = ((await rows(db, 'SELECT id, leadId, type, customLabel, date, time, endTime, originalDate, note, status FROM planned_actions')) as unknown as PlannedAction[]).map(p => ({ ...p, time: p.time ?? undefined, endTime: p.endTime ?? undefined, people: [] }));
  const drift = leads.filter(l => !['c1', 'bNA'].includes(String(l.id))).filter(l => {
    const s = summarizeNextAction(pendingActionOf(String(l.id), plannedRows));
    return s.nextActionDate !== (l.nextActionDate || '') || (s.nextActionDate && s.nextActionType !== (l.nextActionType || 'autre'));
  });
  check('résumé recalculé par la v4 = champs du lead (hors cas signalés)', drift.length === 0, drift.map(l => l.id).join());

  section('Rejeu : sans effet');
  const h1 = await dbHash(db);
  const r2 = await detectDivergences(db);
  const again = await applyRealignment(db, r2, new Date('2026-09-18T12:00:00Z'));
  check('rejeu : A 0, B = sans commercial, C signalé, aucune écriture', r2.A.length === 0 && ids(r2.B) === 'bNA' && ids(r2.C) === 'c1' && again.updated === 0 && again.reports === 0 && again.created === 0, JSON.stringify(again));
  check('rejeu : base identique octet pour octet (toutes les tables)', (await dbHash(db)) === h1);
  db.close();

  section('Garde-fous');
  check('SQL d\'écriture : ni DDL, ni DELETE, ni écriture de la table leads', Object.values(REALIGN_SQL).every(s => !/\b(CREATE|ALTER|DROP|DELETE)\b/i.test(s) && !/(UPDATE|INTO)\s+"leads"/i.test(s)));
  check('créations : INSERT OR IGNORE seulement', Object.values(REALIGN_SQL).filter(s => /INSERT/i.test(s)).every(s => /^INSERT OR IGNORE/i.test(s)));
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(TURSO_|BOB_CONFIRM_PROD$|DATABASE_URL$)/.test(k)) base[k] = v;
  const noTarget = spawnSync('npx', ['tsx', 'scripts/realign-planned-actions-turso.ts', '--apply'], { env: base, encoding: 'utf8', shell: true, timeout: 60_000 });
  check('sans --target : refus, code 1, aucune connexion', noTarget.status === 1 && `${noTarget.stdout}${noTarget.stderr}`.includes('cible non précisée'), `${noTarget.stdout}${noTarget.stderr}`.slice(-200));

  for (const f of [DB_FILE]) { try { rmSync(f, { force: true }); } catch { /* verrou Windows */ } }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais réalignement (base) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
