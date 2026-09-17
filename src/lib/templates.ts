import type { MessageTemplate } from '../data/types';

// Ordre d'affichage des modeles de message — coeur PUR, teste par
// scripts/harness-templates.ts.

// L'ORDRE des modeles vit dans lib/templateLayout (lot 3 : categories + ordre
// manuel ; a defaut de rangement, « plus recent d'abord » comme avant).

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
