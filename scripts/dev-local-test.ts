/**
 * BANC DE TEST LOCAL du pipeline email — base JETABLE, prod INACCESSIBLE.
 *
 * Exécution : npx tsx scripts/dev-local-test.ts   (Ctrl+C pour tout arrêter)
 *
 * Ce lanceur :
 *  1. construit un environnement VERROUILLÉ : variables TURSO_* SUPPRIMÉES
 *     (sans token, la prod est inaccessible — garantie par absence
 *     d'identifiants, pas par discipline) et DATABASE_URL -> test-inbound.db
 *     (fichier local gitignoré) ;
 *  2. applique les migrations à cette base de test et y seed les 5 commerciaux ;
 *  3. démarre l'API réelle (le handler api/[...slug].ts, celui de la prod) sur
 *     http://127.0.0.1:3311 avec des identifiants de connexion DE TEST générés ;
 *  4. démarre l'app (vite) sur http://localhost:5173/boat/ en mode API, proxy
 *     pointé vers l'API de test (jamais vers la prod).
 *
 * Les seuls identifiants réels utilisés : AZURE_* (lecture SEULE de la boîte
 * mail — Mail.Read ne peut rien modifier dans Outlook).
 */
import { config as dotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createClient } from '@libsql/client';

const TEST_DB = path.resolve('test-inbound.db');
const API_PORT = 3311;

async function main() {
  dotenv(); // charge .env (AZURE_* + TURSO_*) dans CE process…

  // …puis VERROUILLAGE : la prod devient inaccessible à tout ce qui suit.
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.DATABASE_URL = `file:${TEST_DB}`;
  process.env.DEV_API_PROXY_TARGET = `http://127.0.0.1:${API_PORT}`;
  process.env.VITE_USE_API = 'true';
  process.env.NODE_ENV = 'development';

  // Auto-contrôle : refus de démarrer si un identifiant Turso subsiste.
  if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
    console.error('❌ Variables TURSO_* encore présentes — arrêt par sécurité.');
    process.exit(1);
  }
  const missing = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TARGET_MAILBOX'].filter(v => !process.env[v]?.trim());
  if (missing.length) {
    console.error(`❌ Variables manquantes dans .env : ${missing.join(', ')} (nécessaires à la lecture de la boîte).`);
    process.exit(1);
  }

  // Identifiants de connexion DE TEST (affichés ci-dessous, valables pour cette
  // session seulement). --password <mdp> pour un mot de passe imposé (tests).
  const pwdArg = process.argv.indexOf('--password');
  const password = pwdArg !== -1 ? process.argv[pwdArg + 1] : `test-${randomBytes(4).toString('hex')}`;
  const { hashPassword } = await import('../api/_lib/auth');
  // Un EMAIL valide : le champ Identifiant du LoginScreen est type="email"
  // (un identifiant nu y serait bloqué par la validation navigateur).
  process.env.APP_USERNAME = 'test@local.test';
  process.env.APP_PASSWORD_HASH = hashPassword(password);
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');

  // 1) Base de test : migrations Prisma (idempotent) + seed des 5 commerciaux.
  console.log(`Base de test : ${TEST_DB}`);
  const mig = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe', shell: true, encoding: 'utf8' });
  if (mig.status !== 0) { console.error('❌ Échec des migrations :\n' + mig.stdout + mig.stderr); process.exit(1); }
  const db = createClient({ url: `file:${TEST_DB}` });
  for (const [id, name] of [['fred', 'Fred'], ['tom', 'Tom'], ['nicolas', 'Nicolas'], ['oceane', 'Océane'], ['camaret', 'Camaret']]) {
    await db.execute({
      sql: `INSERT INTO commercials (id, name, active, createdAt, updatedAt)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO NOTHING`,
      args: [id, name],
    });
  }
  const leads = Number((await db.execute('SELECT COUNT(*) AS n FROM leads')).rows[0].n);
  await db.close();
  console.log(`Migrations OK — base de test prête (${leads} lead(s) au démarrage).`);

  // 2) API réelle sur un port local (adaptateur minimal Vercel -> http natif :
  // le handler n'utilise que status/json/end/setHeader + req.body/headers/url).
  const { default: handler } = await import('../api/[...slug]');
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const vreq = req as unknown as Parameters<typeof handler>[0];
      (vreq as { body?: unknown }).body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
      const vres = res as unknown as Parameters<typeof handler>[1];
      (vres as unknown as { status: (c: number) => unknown }).status = (c: number) => { res.statusCode = c; return vres; };
      (vres as unknown as { json: (o: unknown) => void }).json = (o: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(o));
      };
      void handler(vreq, vres);
    });
  });
  server.listen(API_PORT, '127.0.0.1', () => console.log(`API de test : http://127.0.0.1:${API_PORT}/api/*`));

  // 3) L'app (vite) — hérite de l'environnement verrouillé.
  const vite = spawn('npx', ['vite'], { env: process.env, stdio: 'inherit', shell: true });
  vite.on('exit', code => { server.close(); process.exit(code ?? 0); });

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  BANC DE TEST LOCAL — base jetable, prod inaccessible');
  console.log('  App        : http://localhost:5173/boat/');
  console.log('  Identifiant: test@local.test');
  console.log(`  Mot de passe: ${password}`);
  console.log('  (Ctrl+C pour tout arrêter — la base test-inbound.db persiste');
  console.log('   entre deux sessions ; supprime le fichier pour repartir à zéro.)');
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
