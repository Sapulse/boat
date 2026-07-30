import type { Lead } from '../data/types';
import { LEAD_STATUSES, PRIORITIES, TEMPERATURES, ACTION_TYPES } from '../data/constants';

// Détection de CONFLIT MULTI-POSTES sur un lead (cœur PUR, testé par
// scripts/harness-concurrency-guard.ts).
//
// Le problème : un PATCH envoie le lead ENTIER (repository.ts:331), pas les
// champs modifiés. Donc si Océane ouvre la fiche à 10:00, que Tom passe le lead
// en « Signé » à 10:01, et qu'Océane enregistre à 10:03, le statut revient en
// arrière — silencieusement. Et cela vaut pour TOUT champ touché par l'autre,
// même ceux qu'Océane n'a pas ouverts.
//
// La parade retenue (option b′) est CONSULTATIVE, comme le reste de la couche
// d'écriture : au moment d'enregistrer, on relit l'état serveur et on compare au
// lead tel qu'il était À L'OUVERTURE du formulaire. Ce qui diffère a été modifié
// par un autre poste et serait ramené en arrière par l'enregistrement.
//
// On ne peut PAS dire QUI : les 4 utilisateurs partagent un seul compte et aucune
// écriture de lead ne porte d'auteur (seules les `lead_actions` ont un authorId,
// choisi dans une liste, non authentifié). On dit donc « un autre poste » — ce
// qui est exact — plutôt que d'inventer une attribution.

export interface FieldChange {
  field: string;
  label: string;
  /** Valeur telle qu'elle était à l'ouverture du formulaire (ma base de départ). */
  mine: string;
  /** Valeur actuelle côté serveur : la modification de l'autre poste. */
  theirs: string;
}

/**
 * Champs surveillés, dans l'ordre d'affichage : les plus lourds de conséquence
 * d'abord (un statut ou un montant qui recule se voit tout de suite ; un
 * commentaire écrasé se remarque plus tard).
 */
const WATCHED: Array<{ field: keyof Lead; label: string }> = [
  { field: 'status', label: 'Statut' },
  { field: 'commercialId', label: 'Commercial' },
  { field: 'quoteAmount', label: 'Montant du devis' },
  { field: 'budget', label: 'Budget' },
  { field: 'probability', label: 'Probabilité' },
  { field: 'temperature', label: 'Température' },
  { field: 'priority', label: 'Priorité' },
  { field: 'nextActionType', label: 'Prochaine action' },
  { field: 'nextActionDate', label: 'Date de prochaine action' },
  { field: 'nextActionTime', label: 'Heure de prochaine action' },
  { field: 'nextActionEndTime', label: 'Heure de fin' },
  { field: 'lastActionDate', label: 'Dernière action' },
  { field: 'contactDate', label: 'Date de contact' },
  { field: 'comments', label: 'Commentaires' },
  { field: 'lossReason', label: 'Motif de perte' },
  { field: 'signedAt', label: 'Date de signature' },
  { field: 'lostAt', label: 'Date de perte' },
  { field: 'reportedAt', label: 'Date de report' },
  { field: 'deliveryDate', label: 'Date de livraison' },
  { field: 'firstName', label: 'Prénom' },
  { field: 'lastName', label: 'Nom' },
  { field: 'phone', label: 'Téléphone' },
  { field: 'email', label: 'Email' },
  { field: 'source', label: 'Source' },
  { field: 'boatType', label: 'Type de bateau' },
  { field: 'boatCondition', label: 'État' },
  { field: 'boatInterest', label: 'Bateau visé' },
  { field: 'brand', label: 'Marque' },
  { field: 'currentBoat', label: 'Bateau actuel' },
];

const labelFrom = (list: ReadonlyArray<{ value: string; label: string }>, v: string): string =>
  list.find(x => x.value === v)?.label ?? v;

/** Rend une valeur de champ lisible par un humain. `vide` plutôt qu'une case blanche. */
export function formatLeadValue(
  field: keyof Lead, value: unknown, nameOf?: (id: string) => string,
): string {
  if (value === null || value === undefined || value === '') return 'vide';
  if (field === 'commercialId') return nameOf ? nameOf(String(value)) : String(value);
  if (field === 'status') return labelFrom(LEAD_STATUSES, String(value));
  if (field === 'priority') return labelFrom(PRIORITIES, String(value));
  if (field === 'temperature') return labelFrom(TEMPERATURES, String(value));
  if (field === 'nextActionType') return labelFrom(ACTION_TYPES, String(value));
  if (field === 'budget' || field === 'quoteAmount') {
    return `${Number(value).toLocaleString('fr-FR')} €`;
  }
  if (field === 'probability') return `${Number(value)} %`;
  return String(value);
}

/** Deux valeurs de champ sont-elles équivalentes ? `null`, `undefined` et `''`
 *  désignent tous « pas de valeur » dans ce modèle : on ne signale pas un
 *  conflit entre deux façons d'être vide. */
function sameValue(a: unknown, b: unknown): boolean {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return true;
  return a === b;
}

/**
 * Champs modifiés par un autre poste entre l'ouverture du formulaire
 * (`baseline`) et maintenant (`server`).
 *
 * Renvoie une liste VIDE quand il n'y a pas de conflit — l'appelant enregistre
 * alors sans rien demander.
 */
export function diffLeadForConflict(
  baseline: Lead, server: Lead, nameOf?: (id: string) => string,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const { field, label } of WATCHED) {
    const mine = baseline[field];
    const theirs = server[field];
    if (sameValue(mine, theirs)) continue;
    out.push({
      field: String(field),
      label,
      mine: formatLeadValue(field, mine, nameOf),
      theirs: formatLeadValue(field, theirs, nameOf),
    });
  }
  return out;
}

/**
 * Le contrôle est-il exploitable ? Il est SAUTÉ quand des écritures locales
 * n'ont pas encore atteint le serveur : la base de comparaison contiendrait mes
 * propres changements optimistes, absents du serveur, et je me signalerais à
 * moi-même un faux conflit. Même philosophie que la double-garde outbox de
 * `repository.sync.refresh`.
 */
export function canCheckConflict(pendingWrites: number): boolean {
  return pendingWrites === 0;
}
