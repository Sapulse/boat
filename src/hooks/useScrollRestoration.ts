import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { createScrollMemory } from '../lib/scrollMemory';

/**
 * Restauration de scroll du conteneur interne (correctif A2). Le scroll de
 * l'app vit dans <main class="overflow-y-auto"> (PAS window) : le
 * ScrollRestoration de react-router ne s'applique pas ici. À chaque changement
 * de route : page jamais visitée -> EN HAUT (fini la fiche ouverte "au milieu") ;
 * page déjà visitée -> position restaurée (le retour à la liste retombe là où
 * on était — comportement navigateur).
 *
 * Mécanique : la position se capture EN CONTINU (écouteur scroll passif), pas au
 * départ de la page — au moment où React a commité le nouveau DOM, le navigateur
 * a déjà pu clamper scrollTop (contenu plus court), il serait trop tard.
 * L'attribution au bon pathname passe par une ref mise à jour APRÈS la
 * restauration : les événements de clamp/restauration (asynchrones) sont donc
 * crédités à la NOUVELLE page (écriture neutre), jamais à l'ancienne.
 */
export function useScrollRestoration<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const { pathname } = useLocation();
  const memory = useRef(createScrollMemory());
  const currentPath = useRef(pathname);

  // Capture continue de la position, créditée à la page COURANTE (ref).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => memory.current.save(currentPath.current, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Changement de route : restaure (ou 0), PUIS bascule l'attribution.
  // useLayoutEffect : avant le paint, pas de flash de l'ancienne position.
  // Les enfants (la page) sont déjà montés -> la hauteur est là pour restaurer.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = memory.current.restore(pathname);
    currentPath.current = pathname;
  }, [pathname]);

  return ref;
}
