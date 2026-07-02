/**
 * Pousse le schéma Prisma (migrations du Lot 1) vers la base Turso (région UE).
 *
 * Exécution : npx tsx scripts/push-schema-turso.ts
 * Requiert : TURSO_DATABASE_URL + TURSO_AUTH_TOKEN dans l'environnement
 *            (via .env — jamais commité). Voir docs/migration + les instructions
 *            du Lot 4 (création de la base Turso `cdg`/Paris).
 *
 * À utiliser UNE FOIS la vraie base Turso créée (étape web 4.4-4.5). Applique
 * toutes les migrations `prisma/migrations/<...>/migration.sql` dans l'ordre.
 * Base VIERGE attendue (D9) : aucune donnée poussée, seulement le schéma.
 *
 * Même esprit que SAForm (save saforme/scripts/push-schema-turso.ts).
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL et TURSO_AUTH_TOKEN sont requis (dans .env).');
  process.exit(1);
}

function allMigrationsSql(): string {
  const dir = path.resolve('prisma/migrations');
  const subs = readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort(); // les dossiers sont préfixés d'un timestamp -> ordre chronologique
  if (subs.length === 0) throw new Error('Aucune migration trouvée sous prisma/migrations.');
  return subs
    .map(s => `-- migration ${s}\n${readFileSync(path.join(dir, s, 'migration.sql'), 'utf-8')}`)
    .join('\n\n');
}

async function main() {
  const sql = allMigrationsSql();
  console.log(`Cible Turso : ${url}`);
  console.log('Application du schéma (migrations Prisma)…\n');
  const client = createClient({ url: url!, authToken: authToken! });
  // executeMultiple applique tous les statements ; FK actives sur Turso.
  await client.executeMultiple(sql);
  await client.close();
  console.log('✅ Schéma poussé sur Turso (base vierge prête).');
}

main().catch(e => { console.error('Échec du push Turso :', e); process.exit(1); });
