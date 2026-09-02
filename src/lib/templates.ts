import type { MessageTemplate } from '../data/types';

// Ordre d'affichage des modeles de message — coeur PUR, teste par
// scripts/harness-templates.ts.

/**
 * Modeles du DERNIER CREE au plus ancien (retour terrain BOB : l'equipe creait
 * un modele et devait aller le chercher en BAS de la page, `ADD_TEMPLATE`
 * ajoutant en fin de tableau).
 *
 * `createdAt` est la colonne d'audit de la base, exposee par ce lot (aucune
 * migration : la colonne existait deja avec @default(now()), donc les modeles
 * deja en production portent leur VRAIE date de creation). Elle peut malgre
 * tout manquer : modeles par defaut (DEFAULT_TEMPLATES) en mode localStorage,
 * ou state hydrate d'avant ce lot. Dans les deux cas ce sont les PLUS ANCIENS
 * -> ils ferment la liste, jamais l'inverse.
 *
 * Departage a date egale OU absente : l'ordre d'insertion INVERSE (le tableau
 * `templates` est append-only, cf. ADD_TEMPLATE : plus loin = plus recent).
 * Ordre TOTAL et deterministe — un meme state ne donne jamais deux rendus
 * differents. Ne mute pas l'entree.
 *
 * A APPELER SUR LE STATE, jamais sur sa propre sortie : le departage lit
 * l'ordre d'INSERTION, qui n'existe plus dans une liste deja triee (deux
 * modeles de meme date se re-inverseraient a chaque passe). La page appelle
 * donc `sortTemplatesByNewest(state.templates)` et rien d'autre.
 */
export function sortTemplatesByNewest(templates: MessageTemplate[]): MessageTemplate[] {
  return templates
    .map((template, index) => ({ template, index }))
    .sort((a, b) => {
      // Chaines ISO (toISOString des deux cotes) : comparaison lexicographique
      // = chronologique. '' (date absente) est plus petit que toute date, donc
      // relegue en fin de liste par le tri decroissant.
      const da = a.template.createdAt ?? '';
      const db = b.template.createdAt ?? '';
      if (da !== db) return da < db ? 1 : -1;
      return b.index - a.index;
    })
    .map(({ template }) => template);
}
