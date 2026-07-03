import type { SyncInfo } from './repository';

// Libellés de l'indicateur de synchro (correctif audit #3, brique 3) — logique
// PURE, séparée du composant (react-refresh : un fichier ne mélange pas composant
// et exports non-composants) et testable au harnais (scripts/harness-sync-ui.ts).

export type SyncTone = 'ok' | 'busy' | 'warn' | 'error';

/**
 * Traduit l'état de synchro en libellé + ton + « prominent » (= alerte
 * NON-RATABLE) :
 *  - idle    : « À jour » (vert, discret)
 *  - sending : « Enregistrement… » (neutre, calme)
 *  - waiting : « N non enregistrée(s) » (orange, visible-calme)
 *  - offline : « Hors ligne — N en attente » (orange, ALERTE)
 *  - failed  : « Modification refusée » (rouge, ALERTE + panneau)
 */
export function describeSync(info: SyncInfo): { label: string; tone: SyncTone; prominent: boolean } {
  const n = info.pending;
  const s = n > 1 ? 's' : '';
  switch (info.status) {
    case 'idle': return { label: 'À jour', tone: 'ok', prominent: false };
    case 'sending': return { label: `Enregistrement…${n ? ` (${n})` : ''}`, tone: 'busy', prominent: false };
    case 'waiting': return { label: `${n} modification${s} non enregistrée${s}`, tone: 'warn', prominent: false };
    case 'offline': return { label: `Hors ligne — ${n} en attente`, tone: 'warn', prominent: true };
    case 'failed': return { label: 'Modification refusée', tone: 'error', prominent: true };
  }
}
