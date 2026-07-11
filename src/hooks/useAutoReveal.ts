import { useEffect, useRef } from 'react';

/**
 * Confort de navigation (correctif A1). Quand `active` passe à true, fait défiler
 * l'élément référencé jusqu'au centre du viewport PUIS focalise son 1er champ.
 *
 * ⚠️ `scrollIntoView` cible l'ANCÊTRE SCROLLABLE (ici `<main class="overflow-y-auto">`,
 * PAS `window` — le scroll de l'app est interne). C'est natif : on n'a pas à
 * manipuler `window`. `focus({preventScroll:true})` évite un 2e scroll qui se
 * battrait avec le défilement smooth. Dégradé en 'auto' si prefers-reduced-motion.
 */
export function useAutoReveal<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    el.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
  }, [active]);
  return ref;
}
