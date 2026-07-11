// Cœur PUR de la restauration de scroll (lot frictions UX, A2) — testé par
// scripts/harness-scroll-memory.ts. Mémorise la position de défilement par clé
// (pathname), borné : au-delà de la limite, la clé la plus ANCIENNEMENT
// sauvegardée sort (une re-sauvegarde rajeunit sa clé).

export interface ScrollMemory {
  save(key: string, top: number): void;
  restore(key: string): number;
  size(): number;
}

export function createScrollMemory(limit = 50): ScrollMemory {
  const positions = new Map<string, number>();
  return {
    save(key, top) {
      // delete + set : la ré-insertion place la clé en fin d'itération Map ->
      // l'éviction (première clé) sort toujours la moins récemment sauvegardée.
      positions.delete(key);
      positions.set(key, top);
      if (positions.size > limit) {
        positions.delete(positions.keys().next().value as string);
      }
    },
    restore(key) {
      // Clé inconnue -> 0 : une page jamais visitée s'ouvre EN HAUT.
      return positions.get(key) ?? 0;
    },
    size() {
      return positions.size;
    },
  };
}
