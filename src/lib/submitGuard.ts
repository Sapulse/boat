/**
 * Cœur PUR du verrou anti-double-soumission (correctif audit #2). Sépare la
 * logique de ré-entrance (testable au harnais) de la couche React (useSubmitLock).
 *
 * Invariant : tant qu'un appel n'est pas « relâché », tout ré-appel est IGNORÉ
 * (retourne false). Le relâchement est piloté par l'appelant :
 *  - fn asynchrone -> relâché au règlement de la promesse ;
 *  - fn synchrone  -> relâché par `scheduleRelease` (dans l'UI : un timer qui
 *    couvre la fenêtre de double-clic ; au harnais : déclenché manuellement).
 */
export function createSubmitGuard(onLockChange?: (locked: boolean) => void) {
  let busy = false;
  return {
    isBusy: () => busy,
    /** Exécute `fn` si non verrouillé, sinon l'ignore. Retourne true si exécuté. */
    run(fn: () => void | Promise<void>, scheduleRelease: (open: () => void) => void): boolean {
      if (busy) return false;                 // ré-entrée (2e clic) BLOQUÉE
      busy = true;
      onLockChange?.(true);
      const open = () => { busy = false; onLockChange?.(false); };
      let result: void | Promise<void>;
      try {
        result = fn();
      } catch (e) {
        open();                               // fn a jeté : on rouvre puis on propage
        throw e;
      }
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(open, open);
      } else {
        scheduleRelease(open);                // synchrone : relâche différé
      }
      return true;
    },
  };
}
