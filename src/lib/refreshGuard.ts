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

/**
 * Décide si une re-hydratation doit se déclencher MAINTENANT — partagé par le
 * polling (timer 5 s) ET les événements (focus/online). PURE (tout injecté) ->
 * testable au harnais. Ne couvre PAS les gardes outbox (écriture en attente/en
 * vol), qui vivent dans `repository.sync.refresh` (double-garde autour du fetch).
 *
 * Déclenche seulement si : onglet visible, aucune saisie active, et un espacement
 * minimal écoulé depuis le dernier refresh (déduplique un focus/online qui tombe
 * juste après un poll — pas de double déclenchement).
 */
export function shouldRefreshNow(g: {
  visible: boolean;
  editing: boolean;
  now: number;
  lastRun: number;
  minSpacingMs: number;
}): boolean {
  if (!g.visible) return false;
  if (g.editing) return false;
  if (g.now - g.lastRun < g.minSpacingMs) return false;
  return true;
}
