import type { KeyboardEvent } from 'react';

/**
 * Rend un element cliquable activable au clavier : Entree ou Espace declenchent
 * l'action (preventDefault sur Espace pour ne pas faire defiler la page).
 * A utiliser avec tabIndex={0} (et role="button" sur les elements non natifs
 * hors tableau — sur tr/td on garde la semantique de table).
 */
export function activateOnKey(action: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };
}
