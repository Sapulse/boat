/**
 * VERROU DE CIBLE des scripts qui touchent une base (2026-09-16).
 *
 * Incident à l'origine : un script chargeait `.env` de lui-même (`dotenv`) —
 * retirer TURSO_* de l'environnement ne l'empêchait donc PAS de viser la prod.
 * En --apply, c'eût été une écriture réelle. Règles désormais :
 *
 *  1. AUCUN script ne charge `.env` pour viser une base. La cible est EXPLICITE :
 *       --target=prod                 identifiants lus dans `.env` À CE MOMENT-LÀ
 *                                     (et seulement les deux clés Turso) ;
 *       --target=local --db=<fichier> base SQLite locale, `.env` jamais lu.
 *     Sans --target : refus immédiat.
 *  2. ÉCRITURE en prod : --apply ET --target=prod ET BOB_CONFIRM_PROD=<nom de la
 *     base> (ex. bob-brestoceanboat). Il manque une seule condition : refus
 *     immédiat, AVANT toute connexion. Pas de repli silencieux en « à blanc ».
 *  3. La base visée (hôte + nom) est affichée AVANT toute action, même à blanc.
 *  4. Les scripts qui ont besoin d'autres variables (Azure / Graph) passent par
 *     loadEnvWithoutDatabase() : TURSO_* et DATABASE_URL n'entrent jamais.
 *
 * Module PUR (hors lecture du fichier, injectable) : prouvé par
 * scripts/harness-db-target.ts, y compris « aucune connexion ouverte » en cas de refus.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export type DbTarget =
  | { kind: 'prod'; url: string; authToken: string; host: string; dbName: string }
  | { kind: 'local'; url: string; path: string; host: 'local'; dbName: string };

export type TargetResolution =
  | { ok: true; target: DbTarget; apply: boolean }
  | { ok: false; reason: string; target?: DbTarget };

export interface ResolveInput {
  argv: string[];
  env: Record<string, string | undefined>;
  /** Le script ÉCRIT-il (en mode --apply) ? Les scripts de lecture passent false. */
  write: boolean;
  /** Lecture des identifiants prod (fichier .env), appelée UNIQUEMENT pour --target=prod. */
  readProdCredentials: () => Record<string, string> | null;
}

const flag = (argv: string[], name: string) => {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
};

/** « bob-brestoceanboat » depuis « bob-brestoceanboat.aws-eu-west-1.turso.io ». */
export function tursoDbName(host: string): string {
  return host.split('.')[0] ?? host;
}

export function resolveDbTarget(input: ResolveInput): TargetResolution {
  const { argv, env, write } = input;
  const apply = argv.includes('--apply');
  const target = flag(argv, 'target');
  if (target === undefined || target === '') {
    return { ok: false, reason: 'cible non précisée : ajoutez --target=prod ou --target=local --db=<fichier>. Aucune cible par défaut.' };
  }

  if (target === 'local') {
    const db = flag(argv, 'db');
    if (!db) return { ok: false, reason: '--target=local exige --db=<chemin du fichier SQLite>.' };
    if (/^(libsql|https?|wss?):/i.test(db) || db.includes('turso.io')) {
      return { ok: false, reason: `--db doit être un FICHIER local, pas une URL distante (« ${db} »).` };
    }
    const abs = path.resolve(db.replace(/^file:/, ''));
    if (!existsSync(abs)) return { ok: false, reason: `base locale introuvable : ${abs}` };
    return { ok: true, apply, target: { kind: 'local', url: `file:${abs}`, path: abs, host: 'local', dbName: path.basename(abs) } };
  }

  if (target !== 'prod') return { ok: false, reason: `--target inconnue « ${target} » (attendu : prod ou local).` };

  const creds = input.readProdCredentials();
  const url = creds?.TURSO_DATABASE_URL;
  const authToken = creds?.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return { ok: false, reason: 'identifiants prod absents (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN dans .env).' };
  let host: string;
  try { host = new URL(url).host; } catch { return { ok: false, reason: 'TURSO_DATABASE_URL illisible.' }; }
  const prod: DbTarget = { kind: 'prod', url, authToken, host, dbName: tursoDbName(host) };

  if (write && apply) {
    const confirm = env.BOB_CONFIRM_PROD;
    if (!confirm) {
      return { ok: false, target: prod, reason: `écriture en PROD refusée : définissez BOB_CONFIRM_PROD=${prod.dbName} (en plus de --apply et --target=prod).` };
    }
    if (confirm !== prod.dbName) {
      return { ok: false, target: prod, reason: `écriture en PROD refusée : BOB_CONFIRM_PROD=« ${confirm} » ne correspond pas à la base visée « ${prod.dbName} ».` };
    }
  }
  return { ok: true, apply, target: prod };
}

/** Ligne affichée AVANT toute action (jamais le jeton). */
export function describeTarget(t: DbTarget): string {
  return t.kind === 'prod'
    ? `PROD Turso — hôte ${t.host} — base ${t.dbName}`
    : `LOCALE — fichier ${t.path}`;
}

/** Lit un fichier .env SANS toucher process.env (dotenv.parse-compatible, sans dépendance). */
export function parseEnvFile(file: string): Record<string, string> | null {
  if (!existsSync(file)) return null;
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** Fichier .env utilisé (surcharge BOB_ENV_FILE réservée aux harnais : jamais les vrais identifiants en test). */
export const envFilePath = (env: Record<string, string | undefined> = process.env) =>
  path.resolve(env.BOB_ENV_FILE ?? '.env');

/** Identifiants prod : UNIQUEMENT les deux clés Turso, lues au moment où --target=prod est demandé. */
export function readProdCredentialsFromEnvFile(env: Record<string, string | undefined> = process.env): Record<string, string> | null {
  const all = parseEnvFile(envFilePath(env));
  if (!all) return null;
  const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = all;
  return TURSO_DATABASE_URL && TURSO_AUTH_TOKEN ? { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } : null;
}

const DATABASE_KEYS = /^(TURSO_|DATABASE_URL$|BOB_CONFIRM_PROD$)/;

/** Charge .env pour les AUTRES besoins (Azure/Graph…) : TURSO_*, DATABASE_URL et BOB_CONFIRM_PROD n'entrent jamais. */
export function loadEnvWithoutDatabase(env: Record<string, string | undefined> = process.env): string[] {
  const all = parseEnvFile(envFilePath(env)) ?? {};
  const loaded: string[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (DATABASE_KEYS.test(k) || env[k] !== undefined) continue;
    env[k] = v;
    loaded.push(k);
  }
  return loaded;
}

/**
 * Point d'entrée des scripts : résout la cible, AFFICHE la base, refuse si une
 * condition manque (code 1) — `connect` n'est appelé qu'une fois tout validé.
 * Renvoie null en cas de refus (le script s'arrête).
 */
export function guardDbTarget(opts: {
  scriptName: string;
  write: boolean;
  argv?: string[];
  env?: Record<string, string | undefined>;
  readProdCredentials?: () => Record<string, string> | null;
  log?: (s: string) => void;
  error?: (s: string) => void;
}): { target: DbTarget; apply: boolean } | null {
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const res = resolveDbTarget({
    argv: opts.argv ?? process.argv.slice(2),
    env,
    write: opts.write,
    readProdCredentials: opts.readProdCredentials ?? (() => readProdCredentialsFromEnvFile(env)),
  });
  if (res.target) log(`Cible  : ${describeTarget(res.target)}`);
  if (!res.ok) {
    error(`❌ ${opts.scriptName} — refus : ${res.reason}`);
    return null;
  }
  const mode = !opts.write ? 'lecture seule'
    : res.apply ? (res.target.kind === 'prod' ? '⚠️  ÉCRITURE EN PROD (--apply, confirmée)' : 'écriture locale (--apply)')
    : 'à blanc (aucune écriture)';
  log(`Mode   : ${mode}`);
  return { target: res.target, apply: res.apply };
}

/** Pour les scripts qui passent par api/_lib/prisma : pose l'environnement de la cible, et seulement elle. */
export function applyTargetToProcessEnv(t: DbTarget, env: Record<string, string | undefined> = process.env): void {
  delete env.TURSO_DATABASE_URL;
  delete env.TURSO_AUTH_TOKEN;
  delete env.DATABASE_URL;
  if (t.kind === 'prod') { env.TURSO_DATABASE_URL = t.url; env.TURSO_AUTH_TOKEN = t.authToken; }
  else env.DATABASE_URL = t.url;
}
