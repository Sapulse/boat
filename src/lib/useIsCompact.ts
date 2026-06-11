import { useSyncExternalStore } from 'react';

/**
 * true sous 640px (breakpoint `sm`). Pour les rares reglages NON pilotables en
 * CSS : les props des graphes Recharts (largeur du YAxis des barres
 * horizontales, taille de police des ticks). Tout le reste du responsive passe
 * par Tailwind. useSyncExternalStore : reactif au resize/rotation, et conforme
 * a la regle react-hooks/purity (pas de lecture de media query pendant le
 * render).
 */
const QUERY = '(max-width: 639px)';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Tronque un libelle d'axe en mode compact ("Annonces du b…"). Le Tooltip
 * Recharts affiche toujours le nom complet au tap/survol. */
export function shortLabel(value: string, max = 11): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
