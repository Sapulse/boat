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

/**
 * Tronque un libelle d'axe en mode compact. Le Tooltip Recharts affiche toujours
 * le nom complet au tap/survol.
 *
 * `max` est passe de 11 a 15 (audit mobile) : a 11, six des vingt sources
 * devenaient illisibles — « Annonces du bateau » sortait en « Annonces d… », et
 * « Boats and outboards » en « Boats and … ». A 15, « Cosas de barcos »,
 * « Recommandation » et « Band of Boats » tiennent en ENTIER, et les libellés
 * encore coupés gardent de quoi être reconnus. La gouttiere des axes passe de 76
 * a 100 px en consequence (cf. GUTTER_COMPACT).
 */
export function shortLabel(value: string, max = 15): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

/**
 * Largeur de la gouttiere des libelles sur les barres HORIZONTALES.
 * Constante partagee par les 3 graphiques concernes (Dashboard + Performance x2)
 * pour qu'elle reste coherente avec `shortLabel` : ~15 caracteres a 10px de
 * fonte demandent ~85 px, 100 laisse la marge des accents et des majuscules.
 */
export const GUTTER_COMPACT = 100;
export const GUTTER_WIDE = 120;
