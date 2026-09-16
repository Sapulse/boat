/**
 * Garde-fou des MIGRATIONS (2026-09-16) — voir prisma/MIGRATIONS.md.
 *
 * Exécution : npx tsx scripts/harness-migrations-guard.ts
 *
 * Sous SQLite / Turso, `prisma migrate diff` / `migrate dev` ajoutent une colonne
 * en RECRÉANT la table (new_…, copie, DROP TABLE, RENAME). Refusé le 16/09 pour
 * le lot 2. Ce harnais échoue si une migration du dépôt (ou le DDL d'un script
 * Turso) contient ce genre d'opération : la migration écrite à la main reste la
 * référence, même si quelqu'un relance Prisma.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PLANNED_ACTIONS_COLUMNS, PLANNED_ACTIONS_TABLES_DDL } from './apply-planned-actions-turso';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

/** Retire les commentaires SQL (-- … et /* … *\/) : une note qui parle de DROP n'est pas un DROP. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'DROP (table, index, colonne)', re: /\bDROP\b/i },
  { label: 'RENAME', re: /\bRENAME\b/i },
  { label: 'table de copie « new_… »', re: /"?\bnew_[A-Za-z0-9_]+"?/i },
  { label: 'copie INSERT INTO … SELECT', re: /\bINSERT\s+INTO\b[\s\S]*?\bSELECT\b/i },
  { label: 'PRAGMA foreign_keys=OFF / defer_foreign_keys', re: /PRAGMA\s+(foreign_keys\s*=\s*OFF|defer_foreign_keys)/i },
  { label: 'DELETE / UPDATE de données', re: /\b(DELETE\s+FROM|UPDATE\s+"?[A-Za-z_]+"?\s+SET)\b/i },
];

export function forbiddenIn(sql: string): string[] {
  const clean = stripSqlComments(sql);
  return FORBIDDEN.filter(f => f.re.test(clean)).map(f => f.label);
}

section('Le détecteur détecte (auto-test sur la sortie réelle de Prisma du 16/09)');
{
  const prismaStyle = `PRAGMA defer_foreign_keys=ON;\nPRAGMA foreign_keys=OFF;\nCREATE TABLE "new_leads" ("id" TEXT NOT NULL PRIMARY KEY);\nINSERT INTO "new_leads" ("id") SELECT "id" FROM "leads";\nDROP TABLE "leads";\nALTER TABLE "new_leads" RENAME TO "leads";`;
  const found = forbiddenIn(prismaStyle);
  check('recréation de table à la Prisma -> 5 motifs détectés', found.length >= 5, found.join(' | '));
  check('un commentaire qui parle de DROP TABLE n\'est PAS un DROP', forbiddenIn('-- Prisma voulait faire DROP TABLE "leads"\nALTER TABLE "leads" ADD COLUMN "x" TEXT;').length === 0);
  check('ajouts purs -> rien', forbiddenIn('ALTER TABLE "leads" ADD COLUMN "x" TEXT NOT NULL DEFAULT \'\';\nCREATE TABLE "t" ("id" TEXT);\nCREATE INDEX "i" ON "t"("id");').length === 0);
}

section('Migrations du dépôt : ajouts uniquement');
{
  const dir = path.resolve('prisma/migrations');
  const subs = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  check('migrations trouvées', subs.length >= 4, String(subs.length));
  for (const s of subs) {
    const sql = readFileSync(path.join(dir, s, 'migration.sql'), 'utf-8');
    const found = forbiddenIn(sql);
    check(`${s} : aucun DROP / RENAME / copie / désactivation des clés`, found.length === 0, found.join(' | '));
  }
  const lot2 = readFileSync(path.join(dir, subs.find(s => s.endsWith('_lot2_planned_actions'))!, 'migration.sql'), 'utf-8');
  const clean = stripSqlComments(lot2);
  check('lot 2 : colonnes ajoutées par ALTER TABLE … ADD COLUMN (4)', (clean.match(/ALTER\s+TABLE\s+"\w+"\s+ADD\s+COLUMN/gi) ?? []).length === 4);
  check('lot 2 : la migration porte la note « écrite à la main »', /écrite à la main/i.test(lot2));
  for (const c of PLANNED_ACTIONS_COLUMNS) {
    check(`lot 2 : même ALTER dans la migration et dans le script Turso (${c.table}.${c.column})`, clean.replace(/\s+/g, ' ').includes(c.ddl.replace(/\s+/g, ' ')));
  }
}

section('DDL des scripts Turso : ajouts uniquement');
{
  const all = [...PLANNED_ACTIONS_COLUMNS.map(c => c.ddl), ...PLANNED_ACTIONS_TABLES_DDL, ...INBOUND_EMAILS_DDL];
  const bad = all.filter(d => forbiddenIn(d).length > 0);
  check('apply-planned-actions + apply-inbound-emails : aucun motif interdit', bad.length === 0, bad.join('\n'));
  check('créations idempotentes (IF NOT EXISTS)', [...PLANNED_ACTIONS_TABLES_DDL, ...INBOUND_EMAILS_DDL].every(d => /IF NOT EXISTS/i.test(d)));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais garde-fou migrations : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
