/**
 * Harnais du VERROU PROD (scripts/lib/dbTarget.ts) — 2026-09-16.
 *
 * Exécution : npx tsx scripts/harness-db-target.ts
 *
 * Prouve :
 *  - résolution de cible : sans --target -> refus ; prod / local ; écriture en
 *    prod = --apply ET --target=prod ET BOB_CONFIRM_PROD exact ;
 *  - un refus n'appelle JAMAIS la lecture d'identifiants inutiles, et le script
 *    s'arrête AVANT toute connexion ;
 *  - VRAIS scripts lancés en sous-processus avec un .env FACTICE (BOB_ENV_FILE,
 *    jamais les vrais identifiants) pointant vers un hôte qui refuse la
 *    connexion : chaque refus sort en code 1, sans aucune trace réseau ;
 *  - plus aucun script ne charge .env de lui-même (dotenv) ni ne lit TURSO_* en direct ;
 *  - build, déploiement Vercel, CI, lanceur local : aucune migration / db push
 *    contre Turso ; prisma.config.ts refuse toute URL non « file: ».
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveDbTarget, guardDbTarget, tursoDbName, describeTarget, parseEnvFile, loadEnvWithoutDatabase,
  readProdCredentialsFromEnvFile, applyTargetToProcessEnv, type DbTarget,
} from './lib/dbTarget';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const PROD_URL = 'libsql://bob-brestoceanboat.aws-eu-west-1.turso.io';
const creds = () => ({ TURSO_DATABASE_URL: PROD_URL, TURSO_AUTH_TOKEN: 'jeton-factice' });
const tmp = mkdtempSync(path.join(os.tmpdir(), 'bob-verrou-'));
const localDb = path.join(tmp, 'locale.db');
writeFileSync(localDb, '');

section('Résolution de cible');
{
  let reads = 0;
  const spyCreds = () => { reads++; return creds(); };
  const r = (argv: string[], env: Record<string, string> = {}, write = true) => resolveDbTarget({ argv, env, write, readProdCredentials: spyCreds });

  const none = r([]);
  check('sans --target -> refus', !none.ok && none.reason.includes('cible non précisée'));
  check('sans --target -> identifiants prod JAMAIS lus', reads === 0);
  check('--apply seul -> refus (pas de cible par défaut)', !r(['--apply']).ok && reads === 0);
  check('--target vide -> refus', !r(['--target=']).ok);
  check('--target inconnue -> refus', !r(['--target=staging']).ok);

  const dry = r(['--target=prod']);
  check('--target=prod à blanc -> accepté, pas d\'écriture', dry.ok && !dry.apply && dry.target.kind === 'prod');
  check('nom de base déduit de l\'hôte', dry.ok && dry.target.dbName === 'bob-brestoceanboat' && tursoDbName('x-y.region.turso.io') === 'x-y');

  const noConfirm = r(['--target=prod', '--apply']);
  check('prod + --apply SANS BOB_CONFIRM_PROD -> refus', !noConfirm.ok && noConfirm.reason.includes('BOB_CONFIRM_PROD=bob-brestoceanboat'));
  check('le refus porte la cible (affichable)', !noConfirm.ok && noConfirm.target?.kind === 'prod');
  const wrong = r(['--target=prod', '--apply'], { BOB_CONFIRM_PROD: 'bob' });
  check('prod + --apply + BOB_CONFIRM_PROD FAUX -> refus', !wrong.ok && wrong.reason.includes('ne correspond pas'));
  const casing = r(['--target=prod', '--apply'], { BOB_CONFIRM_PROD: 'BOB-BRESTOCEANBOAT' });
  check('confirmation sensible à la casse (exacte)', !casing.ok);
  const okWrite = r(['--target=prod', '--apply'], { BOB_CONFIRM_PROD: 'bob-brestoceanboat' });
  check('les 3 conditions -> écriture autorisée', okWrite.ok && okWrite.apply);
  check('script de LECTURE en prod : pas de confirmation exigée', r(['--target=prod', '--apply'], {}, false).ok);
  check('identifiants prod absents -> refus', !resolveDbTarget({ argv: ['--target=prod'], env: {}, write: false, readProdCredentials: () => null }).ok);

  reads = 0;
  check('local sans --db -> refus', !r(['--target=local', '--apply']).ok);
  check('local avec URL distante -> refus', !r(['--target=local', `--db=${PROD_URL}`, '--apply']).ok);
  check('local fichier inexistant -> refus', !r(['--target=local', `--db=${path.join(tmp, 'absent.db')}`]).ok);
  const loc = r(['--target=local', `--db=${localDb}`, '--apply']);
  check('local fichier existant + --apply -> accepté sans confirmation', loc.ok && loc.apply && loc.target.kind === 'local');
  check('cible locale : identifiants prod JAMAIS lus', reads === 0);
}

section('guardDbTarget : affichage de la base, refus avant connexion');
{
  const logs: string[] = [];
  const errs: string[] = [];
  const g = guardDbTarget({ scriptName: 't', write: true, argv: ['--target=prod', '--apply'], env: {}, readProdCredentials: creds, log: s => logs.push(s), error: s => errs.push(s) });
  check('refus -> null (le script s\'arrête)', g === null);
  check('la base visée est affichée AVANT le refus (hôte + nom)', logs.some(l => l.includes('bob-brestoceanboat.aws-eu-west-1.turso.io') && l.includes('base bob-brestoceanboat')));
  check('le jeton n\'est jamais affiché', ![...logs, ...errs].some(l => l.includes('jeton-factice')));
  const logs2: string[] = [];
  const dry = guardDbTarget({ scriptName: 't', write: true, argv: ['--target=prod'], env: {}, readProdCredentials: creds, log: s => logs2.push(s), error: () => {} });
  check('à blanc : base affichée + mode « à blanc »', !!dry && logs2.some(l => l.includes('PROD Turso')) && logs2.some(l => l.includes('à blanc')));
  check('description locale', describeTarget({ kind: 'local', url: 'file:x', path: '/x/y.db', host: 'local', dbName: 'y.db' }).includes('LOCALE'));
}

section('Environnement : .env lu sans les variables de base');
{
  const envFile = path.join(tmp, '.env.test');
  writeFileSync(envFile, `# commentaire\nTURSO_DATABASE_URL=${PROD_URL}\nTURSO_AUTH_TOKEN="secret"\nDATABASE_URL=file:./x.db\nBOB_CONFIRM_PROD=bob-brestoceanboat\nAZURE_TENANT_ID=tenant # note\nAZURE_CLIENT_ID='client'\n`);
  const parsed = parseEnvFile(envFile)!;
  check('parse .env : guillemets, commentaires', parsed.TURSO_AUTH_TOKEN === 'secret' && parsed.AZURE_TENANT_ID === 'tenant' && parsed.AZURE_CLIENT_ID === 'client');
  const env: Record<string, string | undefined> = { BOB_ENV_FILE: envFile };
  const loaded = loadEnvWithoutDatabase(env);
  check('loadEnvWithoutDatabase : AZURE_* chargées', env.AZURE_TENANT_ID === 'tenant' && loaded.includes('AZURE_CLIENT_ID'));
  check('loadEnvWithoutDatabase : TURSO_*, DATABASE_URL, BOB_CONFIRM_PROD JAMAIS chargées',
    env.TURSO_DATABASE_URL === undefined && env.TURSO_AUTH_TOKEN === undefined && env.DATABASE_URL === undefined && env.BOB_CONFIRM_PROD === undefined);
  check('identifiants prod : SEULEMENT les deux clés Turso', JSON.stringify(Object.keys(readProdCredentialsFromEnvFile({ BOB_ENV_FILE: envFile })!).sort()) === '["TURSO_AUTH_TOKEN","TURSO_DATABASE_URL"]');
  const target: DbTarget = { kind: 'local', url: `file:${localDb}`, path: localDb, host: 'local', dbName: 'locale.db' };
  const penv: Record<string, string | undefined> = { TURSO_DATABASE_URL: PROD_URL, TURSO_AUTH_TOKEN: 'x' };
  applyTargetToProcessEnv(target, penv);
  check('cible locale posée : TURSO_* RETIRÉES de l\'environnement', penv.TURSO_DATABASE_URL === undefined && penv.DATABASE_URL === `file:${localDb}`);
}

section('Vrais scripts, .env FACTICE, hôte injoignable : refus en code 1, aucune connexion');
{
  const fakeEnv = path.join(tmp, '.env.factice');
  // Port 1 en local : toute tentative de connexion échouerait bruyamment (ECONNREFUSED / fetch failed).
  writeFileSync(fakeEnv, 'TURSO_DATABASE_URL=libsql://127.0.0.1:1\nTURSO_AUTH_TOKEN=jeton-factice\n');
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(TURSO_|BOB_CONFIRM_PROD$|DATABASE_URL$)/.test(k)) base[k] = v;
  const run = (script: string, args: string[], extra: Record<string, string> = {}) => {
    const t0 = Date.now();
    const res = spawnSync('npx', ['tsx', `scripts/${script}`, ...args], { env: { ...base, BOB_ENV_FILE: fakeEnv, ...extra }, encoding: 'utf8', shell: true, timeout: 60_000 });
    return { code: res.status, out: `${res.stdout}\n${res.stderr}`, ms: Date.now() - t0 };
  };
  const NETWORK = /ECONNREFUSED|fetch failed|getaddrinfo|ENOTFOUND|SQLITE_|LibsqlError|Leads en base|Leads : \d/;
  const writers = ['apply-planned-actions-turso.ts', 'apply-weekly-objectives-turso.ts', 'apply-social-turso.ts', 'realign-planned-actions-turso.ts', 'apply-inbound-emails-turso.ts', 'apply-login-attempts-turso.ts', 'push-schema-turso.ts', 'purge-inbound.ts'];
  for (const s of writers) {
    const a = run(s, []);
    check(`${s} sans argument -> refus, code 1, aucune connexion`, a.code === 1 && a.out.includes('cible non précisée') && !NETWORK.test(a.out), a.out.slice(-300));
    const b = run(s, ['--target=prod', '--apply']);
    check(`${s} --target=prod --apply sans BOB_CONFIRM_PROD -> refus, base affichée, aucune connexion`,
      b.code === 1 && b.out.includes('Cible  : PROD Turso — hôte 127.0.0.1:1') && b.out.includes('BOB_CONFIRM_PROD') && !NETWORK.test(b.out), b.out.slice(-300));
  }
  const c = run('apply-planned-actions-turso.ts', ['--target=prod', '--apply'], { BOB_CONFIRM_PROD: 'bob-brestoceanboat' });
  check('BOB_CONFIRM_PROD ne correspondant pas à la base visée -> refus, aucune connexion', c.code === 1 && c.out.includes('ne correspond pas') && !NETWORK.test(c.out), c.out.slice(-300));
  const d = run('apply-planned-actions-turso.ts', ['--apply']);
  check('--apply sans --target (ancien usage) -> refus, aucune connexion', d.code === 1 && d.out.includes('cible non précisée') && !NETWORK.test(d.out));
  const e = run('backup-turso.ts', []);
  check('backup sans --target -> refus (plus de sauvegarde implicite)', e.code === 1 && e.out.includes('cible non précisée') && !NETWORK.test(e.out));
  const f = run('backup-turso.ts', ['--local']);
  check('backup --local (ancien usage) -> refus', f.code === 1 && f.out.includes('cible non précisée'));
}

section('Plus aucun chargement automatique de .env ni lecture directe de TURSO_*');
{
  const files = readdirSync('scripts').filter(f => f.endsWith('.ts')).map(f => `scripts/${f}`);
  const withDotenv = files.filter(f => /from ['"]dotenv|import ['"]dotenv|require\(['"]dotenv/.test(readFileSync(f, 'utf-8')));
  check('aucun script n\'importe dotenv', withDotenv.length === 0, withDotenv.join(', '));
  // Lecture DIRECTE de process.env.TURSO_* : autorisée seulement pour les RETIRER
  // (lanceur local, lanceur des harnais) ou pour refuser de tourner (harnais).
  // harness-campagnes : RETIRE TURSO_* avant d'importer le handler du tag de prod
  // (test « ancien code sur base migrée ») — ce handler construirait sinon son
  // client Prisma sur la prod. Retrait, jamais lecture.
  const allowed = new Set([
    'scripts/dev-local-test.ts', 'scripts/run-harnesses.ts', 'scripts/harness-backup.ts',
    'scripts/harness-db-target.ts', 'scripts/harness-campagnes.ts',
  ]);
  const direct = files.filter(f => !allowed.has(f) && /process\.env(\.|\[['"])TURSO_/.test(readFileSync(f, 'utf-8')));
  check('aucun script ne lit TURSO_* en direct (hors retrait)', direct.length === 0, direct.join(', '));
  const devLocal = readFileSync('scripts/dev-local-test.ts', 'utf-8');
  check('lanceur local : .env chargé SANS les variables de base', devLocal.includes('loadEnvWithoutDatabase()'));
}

section('Build, Vercel, CI, lanceur local : aucune migration contre Turso');
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { scripts: Record<string, string> };
  const MIGRATE = /prisma\s+(migrate|db\s+push)|push-schema|apply-.*-turso/;
  for (const k of ['build', 'vercel-build', 'test', 'typecheck', 'lint', 'dev', 'preview']) {
    check(`package.json « ${k} » : aucune migration / db push`, !MIGRATE.test(pkg.scripts[k] ?? ''), pkg.scripts[k]);
  }
  check('aucun postinstall / prebuild / predeploy', !pkg.scripts.postinstall && !pkg.scripts.prebuild && !pkg.scripts.predeploy && !pkg.scripts['pre-vercel-build']);
  const vercel = readFileSync('vercel.json', 'utf-8');
  check('vercel.json : pas de commande de build / install personnalisée', !/buildCommand|installCommand|migrate/.test(vercel));
  for (const wf of readdirSync('.github/workflows')) {
    // Commentaires YAML retirés : la CI EXPLIQUE qu'elle retire TURSO_*, elle ne les utilise pas.
    const y = readFileSync(`.github/workflows/${wf}`, 'utf-8').split(/\r?\n/).map(l => l.replace(/(^|\s)#.*$/, '')).join('\n');
    check(`CI ${wf} : aucune migration, aucun secret Turso`, !MIGRATE.test(y) && !/TURSO_/.test(y));
  }
  const dev = readFileSync('scripts/dev-local-test.ts', 'utf-8');
  check('lanceur local : `prisma migrate deploy` seulement avec DATABASE_URL = fichier de test', dev.includes("process.env.DATABASE_URL = `file:${TEST_DB}`") && dev.includes('delete process.env.TURSO_DATABASE_URL'));
  const v = spawnSync('npx', ['prisma', 'validate'], { env: { ...process.env, DATABASE_URL: 'libsql://bob-brestoceanboat.aws-eu-west-1.turso.io' }, encoding: 'utf8', shell: true, timeout: 90_000 });
  check('prisma.config.ts : CLI Prisma REFUSE une URL Turso', v.status !== 0 && `${v.stdout}${v.stderr}`.includes('ne vise jamais Turso'), `${v.status}`);
}

try { rmSync(tmp, { recursive: true, force: true }); } catch { /* verrou Windows */ }
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais verrou prod : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
