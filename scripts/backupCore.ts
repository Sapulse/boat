/**
 * Cœur PUR de la sauvegarde (`npm run backup`) — AUCUN effet de bord : pas de
 * dotenv, pas d'accès disque, pas de client base. Importable par le harnais sans
 * charger le moindre secret (la prod reste inaccessible par ABSENCE
 * d'identifiants, cf. scripts/dev-local-test.ts).
 *
 * Testé par scripts/harness-backup.ts. Le programme est dans backup-turso.ts.
 */
import type { AppState } from '../src/data/types';
import { BACKUP_FORMAT, BACKUP_VERSION } from '../src/lib/backup';

/** Au-delà, un dump est supprimé (durée de conservation RGPD, cf. inbound_emails). */
export const RETENTION_DAYS = 90;
/** Filet : on garde TOUJOURS les N plus récents, même hors délai. Sans ça, 3 mois
 *  sans lancer le script et la purge effacerait la DERNIÈRE copie existante. */
export const KEEP_MIN = 4;

export const FILE_RE = /^bob-crm-sauvegarde-(\d{4})-(\d{2})-(\d{2})-\d{2}h\d{2}\.json\.gz$/;

/** Nom horodaté : plusieurs dumps par jour (avant ET après un import) coexistent. */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `bob-crm-sauvegarde-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    + `-${p(now.getHours())}h${p(now.getMinutes())}.json.gz`;
}

/**
 * Enveloppe au format de l'app (`bob-crm-backup` v1) + la file d'import email.
 *
 * `inboundEmails` est HORS `AppState` : l'app ne l'exporte ni ne la restaure. On
 * la conserve quand même (les cartes à traiter sont du travail réel) pour une
 * reprise manuelle. `parseRestorePayload` strippe les clés inconnues, donc sa
 * présence ne gêne PAS la restauration — c'est ce que prouve le harnais.
 */
export function buildEnvelope(
  data: AppState, inboundEmails: unknown[], appVersion: string, exportedAt: string,
): Record<string, unknown> {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion, exportedAt, data, inboundEmails };
}

/**
 * Dumps à supprimer : plus vieux que `retentionDays`, en gardant les `keepMin`
 * plus récents quoi qu'il arrive. L'âge vient du NOM du fichier, pas du mtime —
 * une synchro OneDrive réécrit les dates de modification. Tout fichier au nom
 * non conforme est IGNORÉ (jamais supprimé) : le dossier peut contenir autre chose.
 */
export function selectPurgeable(
  names: string[], now: Date, retentionDays = RETENTION_DAYS, keepMin = KEEP_MIN,
): string[] {
  const dated = names
    .map(name => {
      const m = FILE_RE.exec(name);
      return m ? { name, day: `${m[1]}-${m[2]}-${m[3]}` } : null;
    })
    .filter((x): x is { name: string; day: string } => x !== null)
    .sort((a, b) => b.day.localeCompare(a.day) || b.name.localeCompare(a.name)); // récents d'abord

  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10);
  return dated.slice(keepMin).filter(f => f.day < cutoff).map(f => f.name);
}
