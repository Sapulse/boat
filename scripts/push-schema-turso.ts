/**
 * Pousse le schéma Prisma (TOUTES les migrations) vers une base Turso VIERGE.
 *
 * Exécution (cible explicite, voir scripts/lib/dbTarget) :
 *   à blanc  : npx tsx scripts/push-schema-turso.ts --target=prod
 *   écriture : BOB_CONFIRM_PROD=<base> npx tsx scripts/push-schema-turso.ts --target=prod --apply
 * Plus de lecture automatique de .env : sans --target, refus.
 *
 * À utiliser UNE FOIS, sur une base neuve (étape web 4.4-4.5 du Lot 4). Refus
 * si la base contient déjà la moindre table : ce script n'est PAS un outil de
 * migration d'une base en service (utiliser les scripts apply-*-turso.ts).
 *
 * Même esprit que SAForm (save saforme/scripts/push-schema-turso.ts).
 */
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { guardDbTarget } from './lib/dbTarget';

function migrationDirs(): string[] {
  const dir = path.resolve('prisma/migrations');
  const subs = readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort(); // les dossiers sont préfixés d'un timestamp -> ordre chronologique
  if (subs.length === 0) throw new Error('Aucune migration trouvée sous prisma/migrations.');
  return subs;
}

function allMigrationsSql(subs: string[]): string {
  const dir = path.resolve('prisma/migrations');
  return subs
    .map(s => `-- migration ${s}\n${readFileSync(path.join(dir, s, 'migration.sql'), 'utf-8')}`)
    .join('\n\n');
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'push-schema-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const subs = migrationDirs();
  const client = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });
  const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map(r => String(r.name));
  console.log(`Migrations : ${subs.join(', ')}`);
  if (tables.length > 0) {
    console.error(`❌ Refus : la base n'est pas vierge (${tables.length} table(s) : ${tables.slice(0, 5).join(', ')}…). Ce script ne migre pas une base en service.`);
    client.close();
    process.exit(1);
  }
  if (!apply) { console.log('À blanc : base vierge, schéma applicable. Rien n\'a été écrit.'); client.close(); return; }
  console.log('Application du schéma (migrations Prisma)…\n');
  await client.executeMultiple(allMigrationsSql(subs));
  client.close();
  console.log('✅ Schéma poussé (base vierge prête).');
}

main().catch(e => { console.error('Échec du push Turso :', e); process.exit(1); });
