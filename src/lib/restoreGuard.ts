import type { AppState } from '../data/types';

// Garde-fou de la RESTAURATION (cœur PUR, testé par scripts/harness-restore-guard.ts).
//
// `POST /api/restore` remplace TOTALEMENT la base, et les 4 utilisateurs partagent
// un seul mot de passe : une mauvaise manip efface le travail de tous. On ne bloque
// pas l'action, on la rend impossible à déclencher DISTRAITEMENT.
//
// Décision structurante : on compare les leads PAR ID, pas par nombre. Deux bases
// de 323 leads peuvent n'avoir aucun lead en commun — un simple « 323 → 323 »
// laisserait croire qu'il n'y a rien à perdre. Ce que l'utilisateur doit lire,
// c'est combien de leads DISPARAISSENT réellement.

/** Au-delà, la sauvegarde est signalée comme ancienne. */
export const STALE_DAYS = 7;
/** Mot à taper quand la restauration ne supprime aucun lead. */
export const CONFIRM_WORD_SAFE = 'REMPLACER';

export interface EntityDelta {
  label: string;
  before: number;
  after: number;
}

export interface RestorePreview {
  /** Comptes avant/après par entité, pour le tableau récapitulatif. */
  rows: EntityDelta[];
  /** Leads présents aujourd'hui et ABSENTS du fichier : réellement perdus. */
  leadsRemoved: number;
  /** Leads du fichier inconnus de la base actuelle. */
  leadsAdded: number;
  /** Leads communs aux deux (conservés, mais écrasés par la version du fichier). */
  leadsKept: number;
  /** Vrai dès qu'au moins un lead disparaît. */
  destructive: boolean;
  /** Ce que l'utilisateur doit taper : escalade si des leads disparaissent. */
  confirmWord: string;
  /** Libellé humain de ce qu'il faut taper (pour l'étiquette du champ). */
  confirmHint: string;
  /** Âge du fichier en jours pleins ; null si le fichier ne porte pas de date. */
  ageDays: number | null;
  /** Fichier ancien (> STALE_DAYS) ou sans date : à signaler. */
  stale: boolean;
}

/**
 * Compare l'état courant au contenu du fichier et dérive tout ce que la
 * confirmation doit afficher.
 *
 * `exportedAt` est la date d'export portée par l'enveloppe (optionnelle : les
 * fichiers anciens n'en ont pas — on la traite alors comme « âge inconnu », donc
 * suspecte plutôt que rassurante).
 */
export function restorePreview(
  current: AppState, incoming: AppState, exportedAt: string | undefined, now: Date,
): RestorePreview {
  const currentIds = new Set(current.leads.map(l => l.id));
  const incomingIds = new Set(incoming.leads.map(l => l.id));

  let leadsRemoved = 0;
  for (const id of currentIds) if (!incomingIds.has(id)) leadsRemoved++;
  let leadsAdded = 0;
  for (const id of incomingIds) if (!currentIds.has(id)) leadsAdded++;
  const leadsKept = currentIds.size - leadsRemoved;

  const rows: EntityDelta[] = [
    { label: 'Leads', before: current.leads.length, after: incoming.leads.length },
    { label: 'Commerciaux', before: current.commercials.length, after: incoming.commercials.length },
    { label: 'Actions', before: current.actions.length, after: incoming.actions.length },
    { label: 'Modèles', before: current.templates.length, after: incoming.templates.length },
    { label: 'Événements', before: current.calendarEvents.length, after: incoming.calendarEvents.length },
    { label: 'Objectifs', before: current.goals.length, after: incoming.goals.length },
    { label: 'Stats mensuelles', before: current.monthlyStats.length, after: incoming.monthlyStats.length },
  ];

  // Âge en jours PLEINS écoulés. Une date illisible ou future -> âge inconnu
  // (une date future signale une horloge fausse : on ne prétend pas savoir).
  let ageDays: number | null = null;
  if (exportedAt) {
    const t = Date.parse(exportedAt);
    if (!Number.isNaN(t)) {
      const diff = now.getTime() - t;
      if (diff >= 0) ageDays = Math.floor(diff / 86_400_000);
    }
  }

  const destructive = leadsRemoved > 0;
  return {
    rows,
    leadsRemoved,
    leadsAdded,
    leadsKept,
    destructive,
    // Escalade : quand des leads disparaissent, on fait TAPER LEUR NOMBRE. Le mot
    // fixe se tape de mémoire sans lire ; un nombre oblige à regarder l'ampleur
    // exacte des dégâts. C'est le seul but de cette friction.
    confirmWord: destructive ? String(leadsRemoved) : CONFIRM_WORD_SAFE,
    confirmHint: destructive
      ? `le nombre de leads qui seront supprimés (${leadsRemoved})`
      : CONFIRM_WORD_SAFE,
    ageDays,
    stale: ageDays === null || ageDays > STALE_DAYS,
  };
}

/** Âge en clair : « aujourd'hui », « il y a 3 jours », « date inconnue ». */
export function formatAge(ageDays: number | null): string {
  if (ageDays === null) return 'date inconnue';
  if (ageDays === 0) return "aujourd'hui";
  if (ageDays === 1) return 'il y a 1 jour';
  return `il y a ${ageDays} jours`;
}
