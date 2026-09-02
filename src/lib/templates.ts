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

/**
 * Ligne d'apercu d'un modele REPLIE : de quoi le reconnaitre sans le deplier.
 * Le sujet pour un email (c'est ce que le prospect lit en premier), a defaut le
 * debut du corps ; le corps pour un SMS / WhatsApp, qui n'ont pas de sujet.
 *
 * Aplati sur UNE ligne (les modeles sont multi-lignes) — la troncature, elle,
 * est laissee au CSS, qui seul connait la largeur disponible. Chaine vide pour
 * un modele encore vide : la page n'affiche alors rien plutot qu'un blanc.
 */
export function templatePreview(template: MessageTemplate): string {
  const raw = template.type === 'email'
    ? (template.subject.trim() || template.body)
    : template.body;
  return raw.replace(/\s+/g, ' ').trim();
}
