// ===========================================================================
// Lot 3 — ouverture d'une fiche lead (module PUR, prouvé par
// scripts/harness-open-lead.ts).
//
//  - ORDINATEUR (≥ 640 px) : la fiche s'ouvre dans un NOUVEL ONGLET, partout
//    (les filtres de la liste d'origine restent en place : rien à sauvegarder).
//  - MOBILE (< 640 px) : même onglet.
//  - Ctrl / Cmd + clic, clic molette : nouvel onglet, sur les deux.
//
// L'adresse est construite depuis la page COURANTE (origine + chemin + #/leads/…) :
// juste avec la base Vite `/boat/` comme `/`, et avec le HashRouter. La session
// (cookie HttpOnly du même site) est partagée par tous les onglets.
// ===========================================================================

/** Hash de la fiche, relatif au document courant (href d'un lien <a>). */
export function leadHash(leadId: string): string {
  return `#/leads/${encodeURIComponent(leadId)}`;
}

/** URL absolue de la fiche pour `window.open`, depuis l'adresse courante (hash d'origine retiré). */
export function leadUrl(leadId: string, loc: Pick<Location, 'origin' | 'pathname' | 'search'>): string {
  return `${loc.origin}${loc.pathname}${loc.search}${leadHash(leadId)}`;
}

export interface OpenGesture {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** 0 = gauche, 1 = molette. */
  button?: number;
}

/** Nouvel onglet ? Ordinateur : toujours. Mobile : seulement Ctrl / Cmd / Maj + clic ou molette. */
export function opensInNewTab(isCompact: boolean, gesture?: OpenGesture): boolean {
  if (gesture && (gesture.ctrlKey || gesture.metaKey || gesture.shiftKey || gesture.button === 1)) return true;
  return !isCompact;
}

/**
 * Bouton « Retour » de la fiche : dans un onglet ouvert par l'app il n'y a pas
 * d'historique (history.length === 1) -> retour à la liste des leads au lieu
 * d'un « précédent » qui ne mène nulle part.
 */
export function backTarget(historyLength: number): 'history' | 'leads' {
  return historyLength > 1 ? 'history' : 'leads';
}
