/**
 * RÉPÉTITION de migration : charge une sauvegarde (bob-crm-sauvegarde-*.json.gz)
 * dans une base SQLite LOCALE NEUVE, au schéma de la prod d'AVANT le lot 2
 * (migrations init + login_attempts + inbound_emails). Sert à répéter une
 * migration sur les données réelles SANS toucher la prod.
 *
 * Exécution :
 *   npx tsx scripts/repetition-charger-sauvegarde.ts --backup=<fichier.json.gz> --db=<nouveau fichier .db>
 *
 * Garde-fous : n'accepte qu'un FICHIER local qui n'existe pas encore (jamais
 * d'écrasement, jamais d'URL distante) ; ne lit pas .env ; n'ouvre aucune
 * connexion réseau. Le fichier produit contient des données personnelles :
 * le garder hors du dépôt et le supprimer après usage.
 */
import { createClient, type InValue } from '@libsql/client';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function migrationSql(suffix: string): string {
  const dir = path.resolve('prisma/migrations');
  const sub = readdirSync(dir).find(d => d.endsWith(suffix));
  if (!sub) throw new Error(`migration ${suffix} introuvable`);
  return readFileSync(path.join(dir, sub, 'migration.sql'), 'utf-8');
}

type Row = Record<string, unknown>;
const toSql = (v: unknown): InValue => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as InValue));

async function main() {
  const backup = arg('backup');
  const dbArg = arg('db');
  if (!backup || !dbArg) { console.error('❌ Usage : --backup=<fichier.json.gz> --db=<nouveau fichier .db>'); process.exit(1); }
  if (/^(libsql|https?|wss?):/i.test(dbArg)) { console.error('❌ --db doit être un fichier local.'); process.exit(1); }
  const dbPath = path.resolve(dbArg);
  if (existsSync(dbPath)) { console.error(`❌ ${dbPath} existe déjà : refus (jamais d'écrasement).`); process.exit(1); }
  const env = JSON.parse(gunzipSync(readFileSync(path.resolve(backup))).toString('utf-8')) as { format: string; exportedAt: string; data: Record<string, unknown>; inboundEmails?: Row[] };
  if (env.format !== 'bob-crm-backup') { console.error('❌ Format de sauvegarde inconnu.'); process.exit(1); }
  const at = env.exportedAt;
  console.log(`Sauvegarde : ${path.resolve(backup)} (exportée le ${at})`);
  console.log(`Base créée : LOCALE — fichier ${dbPath}`);

  const db = createClient({ url: `file:${dbPath}` });
  await db.executeMultiple(migrationSql('_init_crm_schema'));
  await db.executeMultiple(migrationSql('_add_login_attempts'));
  for (const ddl of INBOUND_EMAILS_DDL) await db.execute(ddl);

  const insert = async (table: string, row: Row) => {
    const cols = Object.keys(row);
    await db.execute({ sql: `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: cols.map(c => toSql(row[c])) });
  };
  const d = env.data as {
    commercials: Row[]; leads: Row[]; actions: Row[]; templates: Row[]; calendarEvents: Row[]; monthlyStats: Row[];
    goals: Row[]; defaultGoal: Row;
  };
  const counts: Record<string, number> = {};
  const tx = async (label: string, rows: Row[], table: string, map: (r: Row) => Row) => {
    for (const r of rows) await insert(table, map(r));
    counts[label] = rows.length;
  };
  await tx('commercials', d.commercials, 'commercials', r => ({ ...r, createdAt: at, updatedAt: at }));
  await tx('leads', d.leads, 'leads', r => ({ ...r, updatedAt: at }));
  await tx('actions', d.actions, 'lead_actions', r => ({ ...r, createdAt: at, updatedAt: at }));
  await tx('templates', d.templates, 'message_templates', r => ({ ...r, createdAt: r.createdAt ?? at, updatedAt: at }));
  await tx('calendarEvents', d.calendarEvents, 'calendar_events', r => ({ ...r, createdAt: at, updatedAt: at }));
  await tx('monthlyStats', d.monthlyStats, 'monthly_stats', r => ({ ...r, createdAt: at, updatedAt: at }));
  await tx('goals', d.goals, 'commercial_goals', r => {
    const flat: Row = { id: r.id, commercialId: r.commercialId, year: r.year, month: r.month, createdAt: at, updatedAt: at };
    for (const m of ['prospectsCreated', 'coldCalls', 'followups', 'meetings', 'revenue', 'conversionRate']) {
      const g = r[m] as { target: number | null; override: number | null } | undefined;
      flat[`${m}Target`] = g?.target ?? null;
      flat[`${m}Override`] = g?.override ?? null;
    }
    return flat;
  });
  await insert('default_goal', { id: 1, ...d.defaultGoal, createdAt: at, updatedAt: at });
  await tx('inbound_emails', env.inboundEmails ?? [], 'inbound_emails', r => r);
  db.close();
  console.log('Chargé :', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
