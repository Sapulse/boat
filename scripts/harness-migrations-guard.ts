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
import { TEMPLATE_LAYOUT_COLUMNS, TEMPLATE_LAYOUT_TABLES_DDL, TEMPLATE_LAYOUT_INDEX_DDL } from './apply-template-layout-turso';
import { WEEKLY_OBJECTIVES_TABLES_DDL, WEEKLY_OBJECTIVES_INDEX_DDL } from './apply-weekly-objectives-turso';
import { SOCIAL_TABLES_DDL, SOCIAL_INDEX_DDL, SOCIAL_DEFAULTS_SQL } from './apply-social-turso';
import { REALIGN_SQL } from './realign-planned-actions-turso';
import { CAMPAGNES_TABLES_DDL, CAMPAGNES_INDEX_DDL, CAMPAGNES_SEED_SQL } from './apply-campagnes-turso';
import { ROLLBACK_CAMPAGNES_SQL } from './rollback-campagnes-turso';

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
  const lot3Dir = subs.find(s => s.endsWith('_lot3_template_layout'));
  check('lot 3 : migration « template_layout » présente', !!lot3Dir);
  if (lot3Dir) {
    const lot3 = readFileSync(path.join(dir, lot3Dir, 'migration.sql'), 'utf-8');
    const clean3 = stripSqlComments(lot3).replace(/\s+/g, ' ');
    check('lot 3 : la migration porte la note « écrite à la main »', /écrite à la main/i.test(lot3));
    check('lot 3 : colonnes ajoutées par ALTER TABLE … ADD COLUMN (2)', (clean3.match(/ALTER\s+TABLE\s+"\w+"\s+ADD\s+COLUMN/gi) ?? []).length === 2);
    for (const c of TEMPLATE_LAYOUT_COLUMNS) {
      check(`lot 3 : même ALTER dans la migration et dans le script Turso (${c.table}.${c.column})`, clean3.includes(c.ddl.replace(/\s+/g, ' ')));
    }
  }
  const lot4Dir = subs.find(s => s.endsWith('_lot4_weekly_objectives'));
  check('lot 4 : migration « weekly_objectives » présente', !!lot4Dir);
  if (lot4Dir) {
    const lot4 = readFileSync(path.join(dir, lot4Dir, 'migration.sql'), 'utf-8');
    const clean4 = stripSqlComments(lot4).replace(/\s+/g, ' ');
    check('lot 4 : la migration porte la note « écrite à la main »', /écrite à la main/i.test(lot4));
    check('lot 4 : aucune table existante modifiée (pas d\'ALTER TABLE)', !/ALTER\s+TABLE/i.test(clean4));
    check('lot 4 : une seule table créée, weekly_objectives', (clean4.match(/CREATE\s+TABLE/gi) ?? []).length === 1 && /CREATE TABLE "weekly_objectives"/.test(clean4));
    // Même DDL que le script, au « IF NOT EXISTS » près.
    const noIfNotExists = (d: string) => d.replace(/\s+IF NOT EXISTS/i, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const norm4 = clean4.replace(/\( /g, '(').replace(/ \)/g, ')');
    for (const d of [...WEEKLY_OBJECTIVES_TABLES_DDL, ...WEEKLY_OBJECTIVES_INDEX_DDL]) {
      check(`lot 4 : même DDL dans la migration et dans le script Turso (${d.match(/"(\w+)"/)?.[1]})`, norm4.includes(noIfNotExists(d)));
    }
  }
  const lot5Dir = subs.find(s => s.endsWith('_lot5_social'));
  check('lot 5 : migration « social » présente', !!lot5Dir);
  if (lot5Dir) {
    const lot5 = readFileSync(path.join(dir, lot5Dir, 'migration.sql'), 'utf-8');
    const clean5 = stripSqlComments(lot5).replace(/\s+/g, ' ');
    check('lot 5 : la migration porte la note « écrite à la main »', /écrite à la main/i.test(lot5));
    check('lot 5 : aucune table existante modifiée (pas d\'ALTER TABLE)', !/ALTER\s+TABLE/i.test(clean5));
    check('lot 5 : deux tables créées, social_networks et social_stats', (clean5.match(/CREATE\s+TABLE/gi) ?? []).length === 2 && /CREATE TABLE "social_networks"/.test(clean5) && /CREATE TABLE "social_stats"/.test(clean5));
    check('lot 5 : monthly_stats jamais citée (MonthlyStat non réutilisé)', !/monthly_stats/i.test(clean5));
    check('lot 5 : seules écritures de données = 3 INSERT OR IGNORE dans social_networks', (clean5.match(/\bINSERT\b/gi) ?? []).length === 3 && (clean5.match(/INSERT OR IGNORE INTO "social_networks"/g) ?? []).length === 3);
    const noIfNotExists = (d: string) => d.replace(/\s+IF NOT EXISTS/i, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const norm5 = clean5.replace(/\( /g, '(').replace(/ \)/g, ')');
    for (const d of [...SOCIAL_TABLES_DDL, ...SOCIAL_INDEX_DDL, ...SOCIAL_DEFAULTS_SQL]) {
      check(`lot 5 : même SQL dans la migration et dans le script Turso (${d.match(/'(reseau-\w+)'/)?.[1] ?? d.match(/"(\w+)"/)?.[1]})`, norm5.includes(noIfNotExists(d)));
    }
  }
}

section('Lot salons : campagnes et participations, sans toucher aux leads');
{
  const dir = path.resolve('prisma/migrations');
  const subs = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  const salonsDir = subs.find(s => s.endsWith('_lot_salons_campagnes'));
  check('lot salons : migration « campagnes » présente', !!salonsDir);
  if (salonsDir) {
    const sql = readFileSync(path.join(dir, salonsDir, 'migration.sql'), 'utf-8');
    const clean = stripSqlComments(sql).replace(/\s+/g, ' ');
    check('lot salons : la migration porte la note « écrite à la main »', /écrite à la main/i.test(sql));
    check("lot salons : aucune table existante modifiée (pas d'ALTER TABLE)", !/ALTER\s+TABLE/i.test(clean));
    check('lot salons : deux tables créées, campagnes et campagne_leads',
      (clean.match(/CREATE\s+TABLE/gi) ?? []).length === 2 && /CREATE TABLE "campagnes"/.test(clean) && /CREATE TABLE "campagne_leads"/.test(clean));
    // LA règle du lot : la source d'un lead dit d'où il vient la PREMIÈRE fois, elle est immuable.
    check("lot salons : la table leads n'est JAMAIS écrite (aucun INSERT/UPDATE/DELETE dessus)",
      !/(UPDATE|INSERT\s+(OR\s+\w+\s+)?INTO|DELETE\s+FROM)\s+"?leads"?/i.test(clean));
    check("lot salons : le mot « source » n'apparaît dans aucune écriture", !/\bsource\b/i.test(clean));
    check('lot salons : unicité (campagne, lead) — un lead jamais dupliqué',
      /CREATE UNIQUE INDEX "campagne_leads_campagneId_leadId_key" ON "campagne_leads"\("campagneId", "leadId"\)/.test(clean));
    check("lot salons : les DEUX paires de dates existent (activité et salon)",
      /"dateDebut"/.test(clean) && /"dateFin"/.test(clean) && /"dateSalonDebut"/.test(clean) && /"dateSalonFin"/.test(clean));
    check('lot salons : aucune date ni heure de RDV stockée (le RDV est une action programmée)',
      !/"dateRdv"|"heureRdv"|"rdvPrevu"/i.test(clean));
    check('lot salons : aucun compteur dénormalisé (appels et emails restent dérivés)',
      !/"nbAppels"|"nbEmails"|"dernierAppel"|"dernierEmail"/i.test(clean));
    check('lot salons : seule écriture de données = 1 INSERT OR IGNORE dans campagnes',
      (clean.match(/\bINSERT\b/gi) ?? []).length === 1 && (clean.match(/INSERT OR IGNORE INTO "campagnes"/g) ?? []).length === 1);
    const noIfNotExists = (d: string) => d.replace(/\s+IF NOT EXISTS/i, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    const norm = clean.replace(/\( /g, '(').replace(/ \)/g, ')');
    for (const d of [...CAMPAGNES_TABLES_DDL, ...CAMPAGNES_INDEX_DDL, ...CAMPAGNES_SEED_SQL]) {
      check(`lot salons : même SQL dans la migration et dans le script Turso (${d.match(/"(\w+)"/)?.[1]})`, norm.includes(noIfNotExists(d)));
    }
  }
  const src = readFileSync(path.resolve('scripts/apply-campagnes-turso.ts'), 'utf-8');
  check('lot salons : verrou de cible en écriture (guardDbTarget, write: true)',
    /guardDbTarget\(\{\s*scriptName: 'apply-campagnes-turso', write: true \}\)/.test(src));
  check('lot salons : lecture seule sans --apply (retour avant toute écriture)',
    /if \(!apply\) \{[\s\S]*?return;\s*\}[\s\S]*applyCampagnesSchema\(db/.test(src));
  check("lot salons : le script n'écrit jamais dans leads",
    !/(UPDATE|INSERT\s+(OR\s+\w+\s+)?INTO|DELETE\s+FROM)\s+"?leads"?/i.test(src));
  check("lot salons : la preuve compare l'empreinte des SOURCES avant / après", /leadSources/.test(src));
}

section('Lot salons : le retour arrière ne détruit que ses propres tables');
{
  const src = readFileSync(path.resolve('scripts/rollback-campagnes-turso.ts'), 'utf-8');
  check('retour arrière : verrou de cible en écriture (guardDbTarget, write: true)',
    /guardDbTarget\(\{\s*scriptName: 'rollback-campagnes-turso', write: true \}\)/.test(src));
  check('retour arrière : lecture seule sans --apply (retour avant toute écriture)',
    /if \(!apply\) \{[\s\S]*?return;\s*\}[\s\S]*applyRollback\(db/.test(src));
  // Les DROP sont ICI légitimes (c'est le but du script) mais STRICTEMENT bornés
  // aux deux tables du lot, et dans l'ordre des clés étrangères.
  check('retour arrière : exactement deux DROP, enfant puis parent',
    ROLLBACK_CAMPAGNES_SQL.length === 2
    && /DROP TABLE IF EXISTS "campagne_leads"/.test(ROLLBACK_CAMPAGNES_SQL[0])
    && /DROP TABLE IF EXISTS "campagnes"/.test(ROLLBACK_CAMPAGNES_SQL[1]));
  check('retour arrière : rejouable (IF EXISTS)', ROLLBACK_CAMPAGNES_SQL.every(d => /IF EXISTS/i.test(d)));
  check('retour arrière : aucune table du CRM citée dans le SQL',
    ROLLBACK_CAMPAGNES_SQL.every(d => !/"(leads|lead_actions|planned_actions|commercials|message_templates|monthly_stats)"/.test(d)));
  check('retour arrière : garde-fou — refus si des participations existent, sauf --force',
    /etat\.participations > 0 && !force/.test(src) && /--force/.test(src));
  check('retour arrière : la preuve vérifie que leads et historique sont intacts',
    /leads intacts/.test(src) && /historique intact/.test(src));
}

section('DDL des scripts Turso : ajouts uniquement');
{
  const all = [...PLANNED_ACTIONS_COLUMNS.map(c => c.ddl), ...PLANNED_ACTIONS_TABLES_DDL, ...INBOUND_EMAILS_DDL,
    ...TEMPLATE_LAYOUT_COLUMNS.map(c => c.ddl), ...TEMPLATE_LAYOUT_TABLES_DDL, ...TEMPLATE_LAYOUT_INDEX_DDL,
    ...WEEKLY_OBJECTIVES_TABLES_DDL, ...WEEKLY_OBJECTIVES_INDEX_DDL, ...SOCIAL_TABLES_DDL, ...SOCIAL_INDEX_DDL, ...SOCIAL_DEFAULTS_SQL,
    ...CAMPAGNES_TABLES_DDL, ...CAMPAGNES_INDEX_DDL, ...CAMPAGNES_SEED_SQL];
  const bad = all.filter(d => forbiddenIn(d).length > 0);
  check('scripts Turso (lots 2 à 5, boîte de réception) : aucun motif interdit', bad.length === 0, bad.join('\n'));
  check('créations idempotentes (IF NOT EXISTS)', [...PLANNED_ACTIONS_TABLES_DDL, ...INBOUND_EMAILS_DDL, ...TEMPLATE_LAYOUT_TABLES_DDL, ...TEMPLATE_LAYOUT_INDEX_DDL, ...WEEKLY_OBJECTIVES_TABLES_DDL, ...WEEKLY_OBJECTIVES_INDEX_DDL, ...SOCIAL_TABLES_DDL, ...SOCIAL_INDEX_DDL, ...CAMPAGNES_TABLES_DDL, ...CAMPAGNES_INDEX_DDL].every(d => /IF NOT EXISTS/i.test(d)));
  check('réseaux par défaut rejouables (INSERT OR IGNORE)', SOCIAL_DEFAULTS_SQL.every(d => /^INSERT OR IGNORE INTO/i.test(d)));
  check('campagne de seed rejouable (INSERT OR IGNORE)', CAMPAGNES_SEED_SQL.every(d => /^INSERT OR IGNORE INTO/i.test(d)));
}

section('Script de réalignement : données seulement, au verrou');
{
  const src = readFileSync(path.resolve('scripts/realign-planned-actions-turso.ts'), 'utf-8');
  check('réalignement : verrou de cible en écriture (guardDbTarget, write: true)', /guardDbTarget\(\{\s*scriptName: 'realign-planned-actions-turso', write: true \}\)/.test(src));
  check('réalignement : lecture seule sans --apply (retour avant toute écriture)', /if \(!apply\) \{[\s\S]*?return;\s*\}[\s\S]*applyRealignment\(db/.test(src));
  const sql = Object.values(REALIGN_SQL);
  // Script de DONNÉES : UPDATE / INSERT autorisés (contrairement aux migrations), jamais de DDL ni de suppression.
  check('réalignement : aucun DDL ni DELETE dans le SQL d\'écriture', sql.every(s => !/\b(CREATE|ALTER|DROP|DELETE|RENAME|PRAGMA)\b/i.test(s)), sql.join('\n'));
  check('réalignement : la table leads n\'est jamais écrite', sql.every(s => !/(UPDATE|INTO)\s+"?leads"?\s/i.test(s)));
  check('réalignement : aucune écriture SQL hors REALIGN_SQL', !/execute\(\s*[`'"]\s*(INSERT|UPDATE|DELETE)/i.test(src));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais garde-fou migrations : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
