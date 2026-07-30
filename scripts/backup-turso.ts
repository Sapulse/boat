/**
 * Sauvegarde COMPLÈTE de la base — `npm run backup`.
 *
 * Le plan Turso gratuit ne garde que 24 h de restauration automatique (PITR) :
 * ce dump EST la vraie sauvegarde du CRM. À lancer chaque semaine, et
 * SYSTÉMATIQUEMENT avant/après toute opération à risque (import email,
 * restauration — `POST /api/restore` remplace TOUTE la base).
 *
 * STRICTEMENT EN LECTURE : uniquement des `findMany` / `findUnique`, via le MÊME
 * chemin de code que l'export de l'app (`getState`) — donc aucun format maison à
 * maintenir, et le fichier produit est directement réinjectable par l'écran
 * « Restaurer ». Le script le PROUVE à chaque exécution en repassant le contenu
 * RELU DU DISQUE dans `parseRestorePayload` (le validateur du serveur) : une
 * sauvegarde qu'on ne peut pas restaurer ne vaut rien, et on ne veut pas le
 * découvrir le jour du sinistre.
 *
 * Destination : $BACKUP_DIR, sinon <OneDrive>/BOB-backups (dossier synchronisé
 * -> la copie quitte la machine, ce qui couvre la panne de PC). JAMAIS dans le
 * dépôt git : le fichier contient les données personnelles de tous les
 * prospects (RGPD) ; conservation bornée à RETENTION_DAYS.
 *
 * Exécution : npm run backup            (prod Turso, lue depuis .env)
 *             npm run backup -- --local (base locale de dev, pour essayer)
 */
import 'dotenv/config';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { buildEnvelope, backupFileName, selectPurgeable, FILE_RE, RETENTION_DAYS } from './backupCore';

/** Table hors AppState : l'app ne l'exporte pas, on la lit à part. */
async function readInbound(prisma: PrismaClient): Promise<unknown[]> {
  return prisma.inboundEmail.findMany({ orderBy: { receivedAt: 'asc' } });
}

function appVersion(): string {
  try {
    return String(JSON.parse(readFileSync(path.resolve('package.json'), 'utf-8')).version ?? '?');
  } catch { return '?'; }
}

async function main() {
  const local = process.argv.includes('--local');
  const tursoUrl = process.env.TURSO_DATABASE_URL;

  // Garde-fou : sans TURSO_*, le client Prisma retombe SILENCIEUSEMENT sur la
  // base locale de dev -> on produirait un fichier « sauvegarde » quasi vide en
  // croyant avoir sauvé la prod. Refus explicite plutôt que fausse assurance.
  if (!local && !tursoUrl) {
    console.error('❌ TURSO_DATABASE_URL absente : ce serait une sauvegarde de la base LOCALE, pas de la prod.');
    console.error("   Vérifie le .env, ou assume le coup d'essai avec : npm run backup -- --local");
    process.exit(1);
  }
  const host = (() => { try { return new URL(tursoUrl!).host; } catch { return 'base locale de dev'; } })();
  console.log(`Source : ${local && !tursoUrl ? 'base locale de dev (--local)' : host}`);

  const { prisma } = await import('../api/_lib/prisma');
  const { getState } = await import('../api/_lib/store');
  const { parseRestorePayload } = await import('../api/_lib/validate');

  const now = new Date();
  const state = await getState(prisma);
  const inbound = await readInbound(prisma);
  await prisma.$disconnect();

  const envelope = buildEnvelope(state, inbound, appVersion(), now.toISOString());

  console.log('\nTable                     Lignes');
  console.log('---------------------------------');
  const counts: Array<[string, number]> = [
    ['leads', state.leads.length],
    ['actions', state.actions.length],
    ['commercials', state.commercials.length],
    ['templates', state.templates.length],
    ['calendarEvents', state.calendarEvents.length],
    ['goals', state.goals.length],
    ['monthlyStats', state.monthlyStats.length],
    ['inbound_emails *', inbound.length],
  ];
  for (const [label, n] of counts) console.log(`${label.padEnd(24)} ${String(n).padStart(6)}`);
  console.log('---------------------------------');
  console.log(`TOTAL                    ${String(counts.reduce((s, [, n]) => s + n, 0)).padStart(6)}`);
  console.log("  * hors AppState : conservé pour reprise manuelle, non réinjecté par « Restaurer ».");

  const dir = process.env.BACKUP_DIR ?? path.join(process.env.OneDrive ?? os.homedir(), 'BOB-backups');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFileName(now));
  const json = JSON.stringify(envelope);
  const gz = gzipSync(json, { level: 9 });
  writeFileSync(file, gz);
  console.log(`\nÉcrit  : ${file}`);
  console.log(`Taille : ${(gz.length / 1024).toFixed(1)} Ko compressés (${(json.length / 1024).toFixed(1)} Ko brut)`);

  // Preuve de restaurabilité sur le contenu RELU du disque (pas sur l'objet en
  // mémoire) : on valide ce qui est réellement dans le fichier.
  let restorable = true;
  try {
    parseRestorePayload(JSON.parse(gunzipSync(readFileSync(file)).toString('utf-8')));
    console.log('Restaurable par « Restaurer » : oui ✅ (validé par le schéma du serveur)');
  } catch (e) {
    restorable = false;
    console.error('\n⚠️  Le fichier est écrit et contient bien les données, MAIS il est REFUSÉ par le');
    console.error(`    validateur de restauration : ${(e as Error).message}`);
    console.error('    -> une donnée en base ne respecte plus le schéma. À corriger avant de compter');
    console.error("       sur ce fichier pour une restauration par l'app.");
  }

  const purgeable = selectPurgeable(readdirSync(dir), now);
  for (const name of purgeable) unlinkSync(path.join(dir, name));
  console.log(purgeable.length
    ? `\nPurge > ${RETENTION_DAYS} j : ${purgeable.length} supprimé(s) — ${purgeable.join(', ')}`
    : `\nPurge > ${RETENTION_DAYS} j : rien à supprimer`);
  console.log(`Sauvegardes conservées : ${readdirSync(dir).filter(n => FILE_RE.test(n)).length}`);

  if (!restorable) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
