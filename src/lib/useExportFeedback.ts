import { useEffect, useRef, useState } from 'react';

/**
 * Feedback minimal pour un bouton d'export synchrone : declenche l'action puis
 * passe a l'etat "done" pendant un court instant (le bouton affiche une
 * confirmation et se desactive -> evite le double-clic). Aucune dependance.
 */
export function useExportFeedback(action: () => void, durationMs = 1200) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const trigger = () => {
    action();
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), durationMs);
  };

  return { done, trigger };
}
