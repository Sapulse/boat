import { useCallback, useState } from 'react';
import { createSubmitGuard } from '../lib/submitGuard';

// Fenêtre (ms) pendant laquelle un bouton de soumission SYNCHRONE reste verrouillé
// après un clic : couvre un double-clic (2 events macro distincts), puis se libère
// tout seul (self-heal). Le seuil natif du double-clic est ~500 ms.
const DOUBLE_CLICK_MS = 500;

/**
 * Verrou anti-double-soumission (correctif audit #2). Empêche qu'un double-clic
 * sur un bouton de création/enregistrement ne déclenche DEUX écritures — donc
 * deux entités pour une création (aucune contrainte d'unicité en base).
 *
 * `guard(fn)` exécute `fn` puis IGNORE tout ré-appel jusqu'au relâchement ;
 * `locked` désactive le bouton (`disabled={locked}`). Marche pour un `fn`
 * synchrone (dispatch optimiste) comme asynchrone. Pur UI : identique flag on/off.
 */
export function useSubmitLock() {
  const [locked, setLocked] = useState(false);
  // Instance stable du cœur pur (lazy init via useState). setLocked est stable et
  // tolère un appel après démontage (React 18+ : aucun avertissement, sans effet).
  const [guard] = useState(() => createSubmitGuard(setLocked));

  const submit = useCallback((fn: () => void | Promise<void>) => {
    guard.run(fn, open => { setTimeout(open, DOUBLE_CLICK_MS); });
  }, [guard]);

  return { locked, guard: submit };
}
