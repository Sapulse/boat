import type { AppState } from '../data/types';
import { downloadJSON } from './csv';
import { toISODate } from './utils';

// Sauvegarde complète (chantier import/export, Étapes 4-5). Enveloppe versionnée
// contenant TOUT l'AppState (ids réels préservés -> restaurable à l'identique).
// Le serveur re-valide strictement à la restauration ; ici on construit l'export
// et on fait une validation LÉGÈRE côté client (aperçu avant restauration).

export const BACKUP_FORMAT = 'bob-crm-backup';
export const BACKUP_VERSION = 1;

export interface BackupEnvelope {
  format: string;
  version: number;
  appVersion?: string;
  exportedAt?: string;
  data: AppState;
}

/** Compte-rendu renvoyé par l'endpoint de restauration. */
export interface RestoreReport {
  commercials: number;
  leads: number;
  actions: number;
  templates: number;
  calendarEvents: number;
  goals: number;
  monthlyStats: number;
}

/** Construit l'enveloppe de sauvegarde à partir de l'état courant. */
export function buildBackup(data: AppState, appVersion: string, exportedAt: string): BackupEnvelope {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion, exportedAt, data };
}

/** Exporte l'état dans un fichier daté (mutualisé export + « exporter d'abord »). */
export function downloadBackup(data: AppState, appVersion: string): void {
  const now = new Date();
  downloadJSON(`bob-crm-sauvegarde-${toISODate(now)}.json`, buildBackup(data, appVersion, now.toISOString()));
}

/**
 * Validation LÉGÈRE d'un fichier de sauvegarde (aperçu client) : format/version
 * reconnus + présence de `data`. La validation STRICTE (chaque entité, zod) fait
 * foi côté serveur — ceci ne fait que cadrer l'aperçu et donner un message clair.
 */
export function parseBackupFile(text: string): BackupEnvelope {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error('Fichier illisible (JSON invalide).'); }
  const e = obj as Partial<BackupEnvelope> | null;
  if (!e || typeof e !== 'object') throw new Error('Fichier vide ou invalide.');
  if (e.format !== BACKUP_FORMAT) throw new Error('Format non reconnu (sauvegarde CRM attendue).');
  if (e.version !== BACKUP_VERSION) throw new Error(`Version « ${String(e.version)} » non supportée (attendu ${BACKUP_VERSION}).`);
  if (!e.data || typeof e.data !== 'object' || !Array.isArray(e.data.leads)) throw new Error('Sauvegarde sans données exploitables.');
  return e as BackupEnvelope;
}
