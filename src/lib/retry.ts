/**
 * Réessaie une opération asynchrone avec des délais croissants (backoff). Relance
 * la DERNIÈRE erreur si tous les essais échouent. Nombre total de tentatives =
 * `delaysMs.length + 1` (1 essai initial + N reprises, chacune précédée de son délai).
 *
 * `sleep` est INJECTABLE (défaut : setTimeout) pour un test déterministe au harnais.
 * Usage type (hydratation auto-réparante) : `retryWithBackoff(hydrate, [1000, 3000, 6000])`.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  delaysMs: number[],
  sleep: (ms: number) => Promise<void> = ms => new Promise(res => setTimeout(res, ms)),
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= delaysMs.length; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < delaysMs.length) await sleep(delaysMs[i]);
    }
  }
  throw lastError;
}
