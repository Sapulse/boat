/**
 * Garde de re-hydratation (correctif audit #3, v2). Fonction PURE (le DOM est
 * injecté) -> testable au harnais sans navigateur.
 *
 * Objectif : ne JAMAIS réaligner l'écran sur le serveur pendant une SAISIE
 * active, pour ne pas faire disparaître ce que l'utilisateur est en train de
 * taper. Deux cas de saisie :
 *  - une modale ouverte (`role="dialog"`) : tous les formulaires d'édition y
 *    vivent -> contexte de saisie même sans champ focalisé ;
 *  - un champ éditable focalisé (input / textarea / select / contentEditable).
 */
export function isEditing(
  active: { tagName?: string; isContentEditable?: boolean } | null | undefined,
  hasOpenDialog: boolean,
): boolean {
  if (hasOpenDialog) return true;
  if (!active) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable === true;
}
