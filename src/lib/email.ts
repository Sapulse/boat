import type { Lead, Commercial, EmailTemplate } from '../data/types';

/**
 * Interpole les variables {{cle}} d'un texte a partir d'une table de valeurs.
 * - une variable presente est remplacee par sa valeur ;
 * - une variable manquante OU inconnue est remplacee par une chaine vide
 *   (jamais laissee sous forme "{{cle}}" dans le rendu final).
 * Helper pur, sans effet de bord -> testable au harnais.
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

/**
 * Construit la table de variables d'un email a partir du lead et du commercial
 * qui lui est assigne. Les champs absents (boatInterest vide, commercial sans
 * signature, etc.) retombent proprement sur ''.
 */
export function buildLeadVars(lead: Lead, commercial?: Commercial): Record<string, string> {
  return {
    prenom: lead.firstName ?? '',
    nom: lead.lastName ?? '',
    bateau: lead.boatType ?? '',
    modele: lead.boatInterest ?? '',
    commercial: commercial?.name ?? '',
    signature: commercial?.signature ?? '',
  };
}

/** Rend le sujet et le corps d'un template avec les variables fournies. */
export function renderEmail(
  template: EmailTemplate,
  vars: Record<string, string>,
): { subject: string; body: string } {
  return {
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
  };
}

/**
 * Construit un lien mailto: pre-rempli. Le sujet et le corps sont encodes
 * (encodeURIComponent) pour rester valides (accents, retours a la ligne, &, ;...).
 * L'adresse est encodee elle aussi : une adresse contenant ? & # % ou des
 * espaces ne peut ni casser le lien ni injecter de parametres (cc, bcc...).
 * Le @ est restaure apres encodage : une adresse nominale produit un lien
 * strictement identique a avant (pas de %40 pour les clients mail tatillons).
 */
export function buildMailto(email: string, subject: string, body: string): string {
  const safeEmail = encodeURIComponent(email).replace(/%40/g, '@');
  const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${safeEmail}?${params}`;
}
