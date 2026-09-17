/**
 * Lot 3 — FUSION DES SOURCES des leads (mise à jour du SEUL champ `leads.source`).
 * À exécuter PENDANT la fenêtre de maintenance, après les migrations. À BLANC par
 * défaut, verrou de cible (scripts/lib/dbTarget).
 *
 * Exécution :
 *   à blanc, prod    : npx tsx scripts/fusion-sources-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/fusion-sources-turso.ts --target=prod --apply
 *   écriture, locale : npx tsx scripts/fusion-sources-turso.ts --target=local --db=<fichier> --apply
 *
 * Table de correspondance EXPLICITE, arbitrée le 17/09 : UNE seule entrée
 * (« http://topbarcos.com/ » -> « Top barcos »). BoatsGroup reste une source à part.
 *
 * --apply :
 *  1. SAUVEGARDE intégrée (scripts/backup-turso.ts, même cible) — arrêt si échec ;
 *  2. empreinte de TOUTES les colonnes des leads sauf `source` ;
 *  3. UPDATE leads SET source = <cible> WHERE source = <valeur exacte>, en UNE transaction ;
 *  4. preuve : même nombre de leads, colonnes hors `source` identiques ligne à ligne,
 *     nouvelle répartition = répartition attendue, plus aucune valeur fusionnée ;
 *  5. rejeu : 0 ligne.
 */
import { createClient, type Client } from '@libsql/client';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';

/** Correspondances EXACTES (valeur en base -> source de référence). */
export const SOURCE_FUSION: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'http://topbarcos.com/', to: 'Top barcos' },
];

export interface SourceCount { source: string; n: number }

/** Plan pur : lignes à modifier et répartition attendue après fusion. */
export function planSourceFusion(before: SourceCount[]): { changes: { from: string; to: string; n: number }[]; after: Map<string, number> } {
  const after = new Map<string, number>();
  for (const b of before) after.set(b.source, (after.get(b.source) ?? 0) + b.n);
  const changes: { from: string; to: string; n: number }[] = [];
  for (const m of SOURCE_FUSION) {
    const n = after.get(m.from) ?? 0;
    if (n === 0) continue;
    changes.push({ from: m.from, to: m.to, n });
    after.delete(m.from);
    after.set(m.to, (after.get(m.to) ?? 0) + n);
  }
  return { changes, after };
}

export async function sourceDistribution(db: Client): Promise<SourceCount[]> {
  return (await db.execute(`SELECT source, COUNT(*) AS n FROM leads GROUP BY source ORDER BY n DESC, source`)).rows
    .map(r => ({ source: String(r.source), n: Number(r.n) }));
}

/** Colonnes des leads SAUF `source` (lues dans la base : vaut avant comme après les migrations). */
export async function leadColumnsExceptSource(db: Client): Promise<string[]> {
  return (await db.execute(`SELECT name FROM pragma_table_info('leads') ORDER BY cid`)).rows.map(r => String(r.name)).filter(c => c !== 'source');
}

/** Applique la fusion en UNE transaction. Renvoie le nombre de lignes modifiées. */
export async function applySourceFusion(db: Client): Promise<number> {
  const tx = await db.transaction('write');
  try {
    let n = 0;
    for (const m of SOURCE_FUSION) n += (await tx.execute({ sql: `UPDATE leads SET source = ? WHERE source = ?`, args: [m.to, m.from] })).rowsAffected;
    await tx.commit();
    return n;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

type Fp = { count: number; sha256: string };
export async function proveSourceFusion(db: Client, before: { others: Fp; columns: string[] }, expected: Map<string, number>): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const others = await fingerprint(db, 'leads', before.columns);
  checks.push({ label: `leads : même nombre (${before.others.count})`, ok: others.count === before.others.count, detail: String(others.count) });
  checks.push({ label: `aucun autre champ modifié (${before.columns.length} colonnes hors source, ligne à ligne)`, ok: others.sha256 === before.others.sha256 });
  const now = await sourceDistribution(db);
  const got = new Map(now.map(r => [r.source, r.n]));
  const same = got.size === expected.size && [...expected].every(([s, n]) => got.get(s) === n);
  checks.push({ label: 'nouvelle répartition = répartition attendue', ok: same, detail: now.map(r => `${r.source} ${r.n}`).join(', ') });
  const left = SOURCE_FUSION.filter(m => got.has(m.from)).map(m => m.from);
  checks.push({ label: 'plus aucune valeur fusionnée en base', ok: left.length === 0, detail: left.join(', ') });
  return checks;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'fusion-sources-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const dist = await sourceDistribution(db);
  const plan = planSourceFusion(dist);
  console.log(`\nLeads : ${dist.reduce((a, r) => a + r.n, 0)} · sources distinctes : ${dist.length}`);
  for (const r of dist) console.log(`  ${String(r.n).padStart(4)}  ${JSON.stringify(r.source)}`);
  console.log(`\nFusion prévue : ${plan.changes.length ? plan.changes.map(c => `${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)} (${c.n} lead${c.n > 1 ? 's' : ''})`).join(' ; ') : 'rien à fusionner'}`);

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit, aucune sauvegarde prise. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD).'); db.close(); return; }
  if (plan.changes.length === 0) { console.log('\nRien à fusionner (rejeu) : aucune écriture.'); db.close(); return; }

  // 1) Sauvegarde intégrée, même cible. En local, dans un dossier à côté de la base (jamais le dossier OneDrive).
  console.log('\n— Sauvegarde avant fusion —');
  const args = ['tsx', 'scripts/backup-turso.ts', `--target=${target.kind}`, ...(target.kind === 'local' ? [`--db=${target.path}`] : [])];
  const env = { ...process.env, ...(target.kind === 'local' && !process.env.BACKUP_DIR ? { BACKUP_DIR: path.join(path.dirname(target.path), 'sauvegardes-locales') } : {}) };
  const backup = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (backup.status !== 0) { console.error('\n❌ Sauvegarde en échec : fusion NON appliquée.'); db.close(); process.exit(1); }

  // 2-4) Empreinte, écriture, preuve.
  const columns = await leadColumnsExceptSource(db);
  const before = { others: await fingerprint(db, 'leads', columns), columns };
  const tWrite = Date.now();
  const n = await applySourceFusion(db);
  const writeMs = Date.now() - tWrite;
  const checks = await proveSourceFusion(db, before, plan.after);
  const replay = await applySourceFusion(db);
  checks.push({ label: 'rejeu : 0 ligne modifiée', ok: replay === 0, detail: String(replay) });
  db.close();
  console.log(`\nFusion : ${n} lead(s) modifié(s) · écriture ${writeMs} ms · total ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : restaurer la sauvegarde prise ci-dessus.'); process.exit(1); }
  console.log('\n✅ Fusion des sources appliquée et prouvée.');
}

if (process.argv[1]?.includes('fusion-sources-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
