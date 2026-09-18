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
  /**
   * LOT SALONS : participations à une campagne présentes aujourd'hui et ABSENTES
   * du fichier. Une sauvegarde d'AVANT le lot n'en porte aucune : sans ce
   * compte, la campagne du salon disparaîtrait sans un mot.
   */
  participationsPerdues: number;
  /** Nom de la campagne la plus touchée (pour l'écrire en clair). */
  campagneTouchee: string;
  /** Vrai dès qu'au moins un lead OU une participation disparaît. */
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
    // Lot 5 : sauvegarde d'avant le lot 5 -> aucune stat de réseau social.
    { label: 'Stats réseaux sociaux', before: current.socialStats?.length ?? 0, after: incoming.socialStats?.length ?? 0 },
    // Lot salons : idem, une sauvegarde d'avant le lot n'en porte aucune.
    { label: 'Participations aux campagnes', before: current.campagneLeads?.length ?? 0, after: incoming.campagneLeads?.length ?? 0 },
  ];

  // Participations réellement perdues : celles d'aujourd'hui absentes du fichier.
  const participationsFichier = new Set((incoming.campagneLeads ?? []).map(p => p.id));
  const perdues = (current.campagneLeads ?? []).filter(p => !participationsFichier.has(p.id));
  const participationsPerdues = perdues.length;
  // Campagne la plus touchée, nommée en clair dans l'avertissement.
  const parCampagne = new Map<string, number>();
  for (const p of perdues) parCampagne.set(p.campagneId, (parCampagne.get(p.campagneId) ?? 0) + 1);
  const pire = [...parCampagne.entries()].sort((a, b) => b[1] - a[1])[0];
  const campagneTouchee = pire ? ((current.campagnes ?? []).find(c => c.id === pire[0])?.nom ?? pire[0]) : '';

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

  // Destructif = des leads OU des participations disparaissent. Le second cas
  // est celui de la sauvegarde antérieure au lot salons : les leads sont tous
  // là, et pourtant le travail du salon part.
  const destructive = leadsRemoved > 0 || participationsPerdues > 0;
  return {
    rows,
    leadsRemoved,
    leadsAdded,
    leadsKept,
    participationsPerdues,
    campagneTouchee,
    destructive,
    // Escalade : quand des leads disparaissent, on fait TAPER LEUR NOMBRE. Le mot
    // fixe se tape de mémoire sans lire ; un nombre oblige à regarder l'ampleur
    // exacte des dégâts. C'est le seul but de cette friction.
    // On fait TAPER LE NOMBRE de ce qui disparaît : un mot fixe se tape de
    // mémoire sans lire, un nombre oblige à regarder l'ampleur exacte.
    confirmWord: leadsRemoved > 0 ? String(leadsRemoved)
      : participationsPerdues > 0 ? String(participationsPerdues)
        : CONFIRM_WORD_SAFE,
    confirmHint: leadsRemoved > 0
      ? `le nombre de leads qui seront supprimés (${leadsRemoved})`
      : participationsPerdues > 0
        ? `le nombre de participations à la campagne qui seront supprimées (${participationsPerdues})`
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
