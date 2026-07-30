/**
 * Harnais de la SAUVEGARDE (`npm run backup`).
 *
 * Exécution : npx tsx scripts/harness-backup.ts
 *
 * La base de prod est VIVANTE (leads réels de BOB) : tout se joue ici sur des
 * bases SQLite jetables, et le harnais REFUSE de démarrer si des variables
 * TURSO_* traînent dans l'environnement (prod inaccessible par ABSENCE
 * d'identifiants, pas par prudence — cf. scripts/dev-local-test.ts).
 *
 * Couvre :
 *  - purge de rétention : ce qui part, ce qui reste, et surtout ce qu'on ne
 *    touche JAMAIS (fichiers étrangers, filet des KEEP_MIN plus récents) ;
 *  - nom de fichier horodaté (deux dumps le même jour ne s'écrasent pas) ;
 *  - LE test qui compte : un dump gzippé, relu depuis le disque, est accepté par
 *    le validateur du serveur PUIS restauré à l'identique dans une base neuve —
 *    y compris avec la clé `inboundEmails` hors AppState, qui doit être ignorée
 *    sans faire échouer la restauration.
 */
import { createClient } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, rmSync, readdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { getState, createLead, createCommercial, restoreBackup } from '../api/_lib/store';
import { parseRestorePayload } from '../api/_lib/validate';
import { buildEnvelope, backupFileName, selectPurgeable, FILE_RE, KEEP_MIN } from './backupCore';
import type { AppState, Lead } from '../src/data/types';

// --- garde-fou : aucun identifiant de prod dans cet environnement ------------
if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error('❌ Variables TURSO_* présentes — arrêt : ce harnais ne doit JAMAIS voir la prod.');
  process.exit(1);
}

const DB_SRC = path.resolve('.harness-backup-src.db');
const DB_DST = path.resolve('.harness-backup-dst.db');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

/** Toutes les migrations, dans l'ordre : la base jetable doit avoir inbound_emails. */
function allMigrations(): string[] {
  const dir = path.resolve('prisma/migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .map(name => readFileSync(path.join(dir, name, 'migration.sql'), 'utf-8'));
}

async function freshDb(file: string): Promise<PrismaClient> {
  try { rmSync(file, { force: true }); } catch { /* ignore */ }
  const setup = createClient({ url: `file:${file}` });
  for (const sql of allMigrations()) await setup.executeMultiple('PRAGMA foreign_keys = ON;\n' + sql);
  await setup.close();
  return new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${file}` }) });
}

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
    firstName: 'Jean', lastName: 'Test', phone: '0600000000', email: 'j@test.fr',
    boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
    budget: 50000, status: 'contacte', contactDate: '2026-06-02', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
    priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '2026-06-05',
    lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
  };
}

/** Comparaison stable d'états (ordre des collections non garanti). */
const norm = (s: AppState) => JSON.stringify(s, (_k, v) =>
  Array.isArray(v) ? [...v].sort((a, b) => String(a?.id).localeCompare(String(b?.id))) : v);

async function main() {
  // ---------------------------------------------------------------- purge ----
  section('Purge de rétention (fonction pure — aucun fichier touché)');
  {
    const now = new Date('2026-07-30T21:00:00Z');
    const old = (d: string) => `bob-crm-sauvegarde-${d}-03h00.json.gz`;
    // 6 dumps : 3 récents, 3 très vieux (> 90 j avant le 2026-07-30).
    const names = [
      old('2026-07-29'), old('2026-07-22'), old('2026-07-15'),
      old('2026-01-10'), old('2026-01-05'), old('2025-12-01'),
    ];
    const purge = selectPurgeable(names, now);
    check('les vieux dumps au-delà du filet sont purgés',
      purge.length === 2 && purge.includes(old('2026-01-05')) && purge.includes(old('2025-12-01')),
      JSON.stringify(purge));
    check(`filet KEEP_MIN=${KEEP_MIN} : les 4 plus récents survivent même hors délai`,
      !purge.includes(old('2026-01-10')));
    check('les dumps récents ne sont jamais purgés',
      !purge.includes(old('2026-07-29')) && !purge.includes(old('2026-07-22')));

    // Le cas qui tue : 3 mois sans lancer le script -> tout est hors délai.
    const abandoned = [old('2026-01-10'), old('2026-01-05'), old('2025-12-01')];
    check('base abandonnée 3 mois : la purge ne laisse JAMAIS zéro sauvegarde',
      selectPurgeable(abandoned, now).length === 0);

    // Fichiers étrangers : jamais candidats.
    const foreign = ['notes.txt', 'bob-crm-sauvegarde-2020-01-01.json', 'photo.jpg', 'dump.sql.gz'];
    check('fichiers au nom non conforme ignorés (jamais supprimés)',
      selectPurgeable([...foreign, ...abandoned], now).length === 0);
    check('un dump du jour reste hors purge',
      selectPurgeable([backupFileName(now)], now).length === 0);
  }

  // ------------------------------------------------------------ nom fichier --
  section('Nom de fichier horodaté');
  {
    const a = backupFileName(new Date(2026, 6, 30, 9, 5));
    check('format attendu', a === 'bob-crm-sauvegarde-2026-07-30-09h05.json.gz', a);
    check('reconnu par la regex de purge', FILE_RE.test(a));
    const b = backupFileName(new Date(2026, 6, 30, 18, 42));
    check('deux dumps le même jour ne portent PAS le même nom (avant/après import)', a !== b);
  }

  // -------------------------------------------------- dump -> restauration ---
  section('Dump gzippé relu du disque -> validé -> restauré à l\'identique');
  const src = await freshDb(DB_SRC);
  const dst = await freshDb(DB_DST);
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bob-backup-'));
  let file = '';
  try {
    // Base source peuplée, y compris la file d'import email (hors AppState).
    await createCommercial(src, { id: 'fred', name: 'Fred', active: true });
    await createLead(src, makeLead());
    await createLead(src, makeLead({ id: 'l2', firstName: 'Marie', email: 'm@test.fr', status: 'signe' }));
    await src.inboundEmail.create({
      data: {
        id: 'ib1', graphId: 'g1', internetMessageId: '<msg-1@test>', receivedAt: '2026-07-28T11:17:00Z',
        fromAddress: 'prospect@test.fr', subject: 'Demande', source: 'site', score: 60,
      },
    });

    const state = await getState(src);
    const inbound = await src.inboundEmail.findMany({ orderBy: { receivedAt: 'asc' } });
    check('la file d\'import est bien lue (hors AppState)', inbound.length === 1);

    // Écriture RÉELLE du fichier gzippé, puis relecture depuis le disque.
    const envelope = buildEnvelope(state, inbound, '3.13.0', new Date().toISOString());
    file = path.join(tmpDir, backupFileName(new Date()));
    writeFileSync(file, gzipSync(JSON.stringify(envelope), { level: 9 }));
    const reread = JSON.parse(gunzipSync(readFileSync(file)).toString('utf-8'));
    check('gzip -> disque -> gunzip : contenu identique', JSON.stringify(reread) === JSON.stringify(envelope));
    check('la file d\'import est conservée dans le fichier', reread.inboundEmails.length === 1);

    // Le validateur du SERVEUR accepte le fichier tel quel.
    let accepted = true;
    let why = '';
    try { parseRestorePayload(reread); } catch (e) { accepted = false; why = (e as Error).message; }
    check('accepté par parseRestorePayload malgré la clé inboundEmails en trop', accepted, why);

    // Et il restaure vraiment : base NEUVE -> état identique à la source.
    const rep = await restoreBackup(dst, reread);
    check('compte-rendu de restauration cohérent', rep.leads === 2 && rep.commercials === 1, JSON.stringify(rep));
    check('base restaurée IDENTIQUE à la source (ids compris)', norm(await getState(dst)) === norm(state));

    // La rétention s'applique à un vrai dossier contenant ce vrai fichier.
    const inDir = readdirSync(tmpDir);
    check('le dump fraîchement écrit n\'est pas candidat à la purge',
      selectPurgeable(inDir, new Date()).length === 0, JSON.stringify(inDir));
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
    if (file) { try { unlinkSync(file); } catch { /* ignore */ } }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(DB_SRC, { force: true }); rmSync(DB_DST, { force: true }); } catch { /* ignore */ }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Harnais sauvegarde : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed) { console.error('Des invariants sont CASSÉS. ❌'); process.exit(1); }
  console.log('Tous les invariants tiennent. ✅');
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
