/**
 * COHÉRENCE / RÉALIGNEMENT « prochaine action du lead » ↔ « action programmée à faire ».
 *
 * Sert (1) après la mise en production, en LECTURE SEULE : attendu 0 divergence ;
 * (2) après un RETOUR ARRIÈRE sur le code de prod-2026-09-16, AVANT de revenir à la
 * v4 : l'ancien code écrit la prochaine action sur le lead seulement, les actions
 * programmées ne suivent pas (docs/DEPLOIEMENT.md, « Retour arrière »).
 *
 * Exécution (cible TOUJOURS explicite — scripts/lib/dbTarget) :
 *   lecture, prod    : npx tsx scripts/realign-planned-actions-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/realign-planned-actions-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/realign-planned-actions-turso.ts --target=local --db=<fichier> --apply
 * AVANT --apply en prod : `npm run backup:prod`.
 *
 * Cas (lecture) :
 *  A) résumé du lead ≠ action à faire (type, date ou heure) ;
 *  B) résumé renseigné, aucune action à faire ;
 *  C) action à faire, résumé vide ;
 *  D) Signé / Perdu avec une action à faire (information, pas une erreur).
 * Sortie : nombre par cas + liste (id, nom, commercial, valeurs des deux côtés).
 * Jamais d'email ni de téléphone.
 *
 * --apply : les champs du LEAD font foi (ce sont les plus récents après un retour
 * arrière). En UNE transaction :
 *  A) l'action à faire prend le type / la date / l'heure du lead ; trace « report »
 *     dans l'historique si la date change (comme un report dans l'Agenda) ;
 *  B) création de l'action à faire, responsable = commercial du lead ; lead
 *     « Non attribué » (ou commercial inconnu) : listé à part, RIEN n'est créé ;
 *  C) rien n'est modifié, cas signalé (non attendu).
 * La table leads n'est JAMAIS écrite. Aucun DELETE, aucun DDL. Ids déterministes et
 * INSERT OR IGNORE : rejouable. Preuve : 0 divergence A, B restants = Non attribués
 * listés, C inchangés, leads identiques ligne à ligne.
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';
import { buildReportEntry, isPlanningClosed, isUnassignedCommercial, pendingActionOf } from '../src/lib/plannedActions';
import type { ActionType, LeadStatus, PlannedAction } from '../src/data/types';

// --- SQL d'écriture (exporté : le garde-fou vérifie qu'il n'y a ni DDL ni DELETE) ---
export const REALIGN_SQL = {
  updatePending: `UPDATE "planned_actions" SET "type" = ?, "customLabel" = ?, "date" = ?, "time" = ?, "endTime" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = 'a_faire'`,
  insertReport: `INSERT OR IGNORE INTO "lead_actions" ("id", "createdAt", "updatedAt", "leadId", "authorId", "type", "date", "result", "notes", "kind", "plannedActionId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'report', ?)`,
  insertPlanned: `INSERT OR IGNORE INTO "planned_actions" ("id", "createdAt", "updatedAt", "leadId", "type", "customLabel", "date", "time", "endTime", "originalDate", "note", "status") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'a_faire')`,
  insertPerson: `INSERT OR IGNORE INTO "planned_action_people" ("id", "createdAt", "updatedAt", "plannedActionId", "commercialId", "role", "active") VALUES (?, ?, ?, ?, ?, 'responsable', 1)`,
};

export interface LeadRow {
  id: string; firstName: string; lastName: string; status: LeadStatus; commercialId: string;
  nextActionType: string; nextActionDate: string; nextActionTime: string | null; nextActionEndTime: string | null;
}
export interface Summary { type: string; date: string; time: string; endTime: string }
export interface Divergence {
  cas: 'A' | 'B' | 'C' | 'D';
  leadId: string; nom: string; commercial: string; statut: LeadStatus;
  lead: Summary; action: Summary | null; plannedId?: string;
}
export interface Report {
  A: Divergence[]; B: Divergence[]; C: Divergence[]; D: Divergence[];
  /** Cas B sans commercial réel : jamais de création. */
  bNonAttribues: Divergence[];
}

const rows = async (db: Client, sql: string) => (await db.execute(sql)).rows.map(r => ({ ...r }));

/** Un type vide sur le lead = « Autre » côté action programmée (même règle que la reprise). */
const leadSummary = (l: LeadRow): Summary => ({
  type: l.nextActionDate ? (l.nextActionType || 'autre') : '',
  date: l.nextActionDate || '',
  time: l.nextActionDate ? (l.nextActionTime || '') : '',
  endTime: l.nextActionDate && l.nextActionTime ? (l.nextActionEndTime || '') : '',
});
const actionSummary = (p: PlannedAction): Summary => ({ type: p.type, date: p.date, time: p.time || '', endTime: p.time ? (p.endTime || '') : '' });
const same = (a: Summary, b: Summary) => a.type === b.type && a.date === b.date && a.time === b.time && a.endTime === b.endTime;

/** Lecture complète, SANS écriture. */
export async function detectDivergences(db: Client): Promise<Report> {
  const commercials = (await rows(db, 'SELECT id, name FROM commercials')) as unknown as { id: string; name: string }[];
  const leads = (await rows(db, 'SELECT id, firstName, lastName, status, commercialId, nextActionType, nextActionDate, nextActionTime, nextActionEndTime FROM leads ORDER BY id')) as unknown as LeadRow[];
  const planned = ((await rows(db, `SELECT id, leadId, type, customLabel, date, time, endTime, originalDate, note, status FROM planned_actions`)) as unknown as PlannedAction[])
    .map(p => ({ ...p, time: p.time ?? undefined, endTime: p.endTime ?? undefined, people: [] }));
  const report: Report = { A: [], B: [], C: [], D: [], bNonAttribues: [] };
  for (const l of leads) {
    const pending = pendingActionOf(l.id, planned);
    const c = commercials.find(x => x.id === l.commercialId);
    const base = {
      leadId: l.id, nom: `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim() || 'Sans nom', commercial: c?.name ?? `inconnu (${l.commercialId})`,
      statut: l.status, lead: leadSummary(l), action: pending ? actionSummary(pending) : null, plannedId: pending?.id,
    };
    if (pending && isPlanningClosed(l.status)) report.D.push({ cas: 'D', ...base });
    if (pending && !l.nextActionDate) report.C.push({ cas: 'C', ...base });
    else if (pending && !same(base.lead, base.action!)) report.A.push({ cas: 'A', ...base });
    else if (!pending && l.nextActionDate) {
      const d: Divergence = { cas: 'B', ...base };
      report.B.push(d);
      if (!c || isUnassignedCommercial(c)) report.bNonAttribues.push(d);
    }
  }
  return report;
}

/** Id déterministe d'une action créée par le réalignement (rejouable). */
export const realignPlannedId = (leadId: string, date: string) => `pa-realign-${leadId}-${date}`;
export const realignReportId = (plannedId: string, newDate: string) => `realign-report-${plannedId}-${newDate}`;

/** Écrit A et B (hors Non attribués) en UNE transaction. C et D : rien. */
export async function applyRealignment(db: Client, report: Report, now: Date = new Date()): Promise<{ updated: number; reports: number; created: number }> {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const planned = new Map(((await rows(db, `SELECT id, leadId, type, customLabel, date, time, endTime, originalDate, note, status FROM planned_actions WHERE status = 'a_faire'`)) as unknown as PlannedAction[])
    .map(p => [p.id, { ...p, time: p.time ?? undefined, endTime: p.endTime ?? undefined, people: [] } as PlannedAction]));
  const responsables = new Map(((await rows(db, `SELECT plannedActionId, commercialId FROM planned_action_people WHERE active = 1 AND role = 'responsable' ORDER BY commercialId`)) as unknown as { plannedActionId: string; commercialId: string }[])
    .map(r => [r.plannedActionId, r.commercialId]));
  const existingIds = new Set(((await rows(db, 'SELECT id FROM planned_actions')) as unknown as { id: string }[]).map(r => r.id));
  const leadCommercial = new Map(((await rows(db, 'SELECT id, commercialId FROM leads')) as unknown as { id: string; commercialId: string }[]).map(r => [r.id, r.commercialId]));
  const skipB = new Set(report.bNonAttribues.map(d => d.leadId));
  const tx = await db.transaction('write');
  const out = { updated: 0, reports: 0, created: 0 };
  try {
    for (const d of report.A) {
      const previous = planned.get(d.plannedId!);
      if (!previous) continue;
      const type = d.lead.type as ActionType;
      const customLabel = type === previous.type ? previous.customLabel : (type === 'autre' ? 'Prochaine action' : '');
      const res = await tx.execute({ sql: REALIGN_SQL.updatePending, args: [type, customLabel, d.lead.date, d.lead.time || null, d.lead.time && d.lead.endTime ? d.lead.endTime : null, nowIso, previous.id] as InValue[] });
      out.updated += res.rowsAffected;
      if (previous.date !== d.lead.date) {
        const author = responsables.get(previous.id) ?? leadCommercial.get(d.leadId)!;
        const entry = buildReportEntry({ id: realignReportId(previous.id, d.lead.date), previous, newDate: d.lead.date, newTime: d.lead.time || undefined, authorId: author, today });
        const r = await tx.execute({ sql: REALIGN_SQL.insertReport, args: [entry.id, nowIso, nowIso, entry.leadId, entry.authorId, entry.type, entry.date, entry.result, previous.id] as InValue[] });
        out.reports += r.rowsAffected;
      }
    }
    for (const d of report.B) {
      if (skipB.has(d.leadId)) continue;
      // Id déterministe ; déjà pris (action annulée puis même date redonnée) -> suffixe.
      let id = realignPlannedId(d.leadId, d.lead.date);
      for (let n = 2; existingIds.has(id); n++) id = `${realignPlannedId(d.leadId, d.lead.date)}-${n}`;
      existingIds.add(id);
      const type = d.lead.type as ActionType;
      const r = await tx.execute({ sql: REALIGN_SQL.insertPlanned, args: [id, nowIso, nowIso, d.leadId, type, type === 'autre' ? 'Prochaine action' : '', d.lead.date, d.lead.time || null, d.lead.time && d.lead.endTime ? d.lead.endTime : null, d.lead.date] as InValue[] });
      out.created += r.rowsAffected;
      await tx.execute({ sql: REALIGN_SQL.insertPerson, args: [`${id}:${leadCommercial.get(d.leadId)}`, nowIso, nowIso, id, leadCommercial.get(d.leadId)!] });
    }
    await tx.commit();
    return out;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

/** Preuve après --apply. */
export async function proveRealignment(db: Client, before: Report, leadsBefore: { count: number; sha256: string }): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const after = await detectDivergences(db);
  const ids = (l: Divergence[]) => l.map(d => d.leadId).sort().join();
  const leadsAfter = await leadsRealignFingerprint(db);
  return [
    { label: 'cas A : 0 divergence', ok: after.A.length === 0, detail: ids(after.A) },
    { label: `cas B : seuls restent les leads sans commercial listés (${before.bNonAttribues.length})`, ok: ids(after.B) === ids(before.bNonAttribues), detail: ids(after.B) },
    { label: `cas C : inchangés, signalés (${before.C.length})`, ok: ids(after.C) === ids(before.C) },
    { label: `leads : jamais écrits (${leadsBefore.count}, identiques ligne à ligne)`, ok: leadsAfter.count === leadsBefore.count && leadsAfter.sha256 === leadsBefore.sha256 },
  ];
}

export const leadsRealignFingerprint = (db: Client) =>
  fingerprint(db, 'leads', ['id', 'updatedAt', 'status', 'commercialId', 'nextActionType', 'nextActionDate', 'nextActionTime', 'nextActionEndTime', 'lastActionDate']);

const fmt = (s: Summary | null) => (s && s.date ? `${s.type} ${s.date}${s.time ? ` ${s.time}${s.endTime ? `-${s.endTime}` : ''}` : ''}` : '—');

export function printReport(r: Report, log: (s: string) => void = console.log): void {
  const titles: Record<'A' | 'B' | 'C' | 'D', string> = {
    A: 'A) résumé du lead ≠ action à faire',
    B: 'B) résumé renseigné, aucune action à faire',
    C: 'C) action à faire, résumé vide (non attendu)',
    D: 'D) Signé / Perdu avec une action à faire (information)',
  };
  log(`\nA : ${r.A.length} · B : ${r.B.length} (dont ${r.bNonAttribues.length} sans commercial) · C : ${r.C.length} · D : ${r.D.length} (info)`);
  for (const cas of ['A', 'B', 'C', 'D'] as const) {
    if (!r[cas].length) continue;
    log(`\n${titles[cas]} — ${r[cas].length}`);
    for (const d of r[cas]) {
      const na = cas === 'B' && r.bNonAttribues.includes(d) ? '  [sans commercial : pas de création]' : '';
      log(`  - ${d.leadId} · ${d.nom} · ${d.commercial} · ${d.statut} · lead : ${fmt(d.lead)} · action à faire : ${fmt(d.action)}${na}`);
    }
  }
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'realign-planned-actions-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const report = await detectDivergences(db);
  printReport(report);
  const toFix = report.A.length + report.B.length - report.bNonAttribues.length;
  if (!apply) {
    console.log(`\nLecture seule : rien n'a été écrit. ${toFix ? `${toFix} lead(s) réalignable(s) avec --apply (et, en prod, BOB_CONFIRM_PROD) après la sauvegarde.` : 'Aucune divergence à corriger.'}`);
    db.close();
    return;
  }
  const leadsBefore = await leadsRealignFingerprint(db);
  const done = await applyRealignment(db, report);
  console.log(`\nRéalignement : ${done.updated} action(s) à faire mise(s) à jour · ${done.reports} trace(s) « report » · ${done.created} action(s) créée(s)`);
  const checks = await proveRealignment(db, report, leadsBefore);
  db.close();
  console.log(`Durée : ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail && !c.ok ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : vérifier la base (la sauvegarde permet la restauration).'); process.exit(1); }
  console.log('\n✅ Réalignement appliqué et prouvé.');
}

if (process.argv[1]?.includes('realign-planned-actions-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
