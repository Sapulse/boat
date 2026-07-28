/**
 * Validation LOCALE de la connexion Microsoft 365 (chantier import email,
 * Étape B, jalon 1) — alternative au endpoint /api/graph-check pour tester
 * SANS déployer : poser les 4 variables AZURE_* dans .env (gitignoré) puis
 *
 *   npx tsx scripts/check-graph.ts
 *
 * Ne lit aucun contenu d'email : jeton + accès boîte + comptages uniquement.
 */
import 'dotenv/config';
import { readGraphEnv, checkGraphConnection, GRAPH_ENV_VARS } from '../api/_lib/graph';

const mask = (v?: string) => (v ? `${v.slice(0, 4)}… (len ${v.length})` : '(absent)');

async function main() {
  console.log('Variables lues :');
  for (const v of GRAPH_ENV_VARS) {
    console.log(`  ${v} = ${v === 'AZURE_TARGET_MAILBOX' ? (process.env[v] ?? '(absent)') : mask(process.env[v])}`);
  }

  let env;
  try {
    env = readGraphEnv(process.env);
  } catch (e) {
    console.error(`\n✘ ${(e as Error).message}`);
    process.exit(1);
  }

  console.log('\nConnexion à Microsoft Graph…');
  const r = await checkGraphConnection(env);

  console.log(`\nJeton obtenu        : ${r.tokenAcquired ? '✔ oui' : '✘ NON'}`);
  console.log(`Boîte accessible    : ${r.ok ? `✔ ${r.mailbox}` : '✘ NON'}`);
  if (r.inboxTotal !== null) console.log(`Boîte de réception  : ${r.inboxTotal} email(s) au total`);
  if (r.bySource.length) {
    console.log('Emails détectés par famille de source :');
    for (const s of r.bySource) {
      console.log(`  ${s.label.padEnd(24)} ${s.count !== null ? s.count : `— ${s.note ?? 'indisponible'}`}`);
    }
  }
  if (r.hint) console.error(`\nAide : ${r.hint}`);
  process.exit(r.ok ? 0 : 1);
}

main();
