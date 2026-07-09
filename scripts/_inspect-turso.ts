/**
 * JETABLE — inspection READ-ONLY de la base Turso (test bascule flag on).
 * Exécution : npx tsx scripts/_inspect-turso.ts
 * Requiert TURSO_DATABASE_URL + TURSO_AUTH_TOKEN dans .env (déjà présents).
 *
 * Ne fait AUCUNE écriture : compte + liste les leads (et un récap des autres
 * tables) directement dans la base, pour prouver — sans passer par l'app — que
 * l'écriture a bien atterri dans Turso. À supprimer après le test.
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL et TURSO_AUTH_TOKEN requis (.env).');
  process.exit(1);
}

async function main() {
  const client = createClient({ url: url!, authToken: authToken! });
  console.log(`Base : ${url}\n`);

  const leads = await client.execute(
    'SELECT id, firstName, lastName, phone, email, status, commercialId, createdAt, updatedAt FROM leads ORDER BY updatedAt DESC',
  );
  console.log(`=== Table leads : ${leads.rows.length} ligne(s) ===`);
  for (const r of leads.rows) console.log(JSON.stringify(r));

  // Récap des autres tables (comptes seulement).
  const tables = ['lead_actions', 'commercials', 'message_templates', 'calendar_events'];
  console.log('\n=== Comptes autres tables ===');
  for (const t of tables) {
    try {
      const c = await client.execute(`SELECT COUNT(*) AS n FROM "${t}"`);
      console.log(`${t}: ${c.rows[0]?.n}`);
    } catch (e) {
      console.log(`${t}: (erreur) ${(e as Error).message}`);
    }
  }

  await client.close();
}

main().catch(e => { console.error('Échec inspection :', e); process.exit(1); });
