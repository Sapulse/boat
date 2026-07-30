// Erreurs de connexion (lot frictions UX, B4) — cœur PUR, testé par
// scripts/harness-login-errors.ts. L'écran de login affichait err.message brut
// ("Failed to fetch", "Connexion refusée (500)") : on mappe ici vers des
// messages humains et rassurants. Le détail technique reste dans l'erreur
// (console) — jamais à l'écran.

// Échec HTTP du login porté avec son statut. Champ déclaré explicitement
// (pas de "parameter property" : interdite par erasableSyntaxOnly du tsconfig).
export class LoginError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LoginError';
    this.status = status;
  }
}

/** Repli si le serveur ne fournit pas de message exploitable sur un 429. */
export const RATE_LIMITED_MESSAGE = 'Trop de tentatives de connexion — réessayez dans quelques minutes.';

// Message que `repository.login` fabrique quand le corps de la réponse n'est pas
// exploitable (`Connexion refusée (429)`) : il porte un code de statut, donc on
// ne le met JAMAIS à l'écran — c'est précisément le jargon qu'on évite ici.
const GENERIC_HTTP_FALLBACK = /^Connexion refusée \(\d+\)$/;

export function loginErrorMessage(err: unknown): string {
  if (err instanceof LoginError) {
    // 401 : le seul champ vraiment saisi est le mot de passe (identifiant
    // pré-rempli) — on nomme la cause probable, sans jargon HTTP.
    if (err.status === 401) return 'Mot de passe incorrect.';
    // 429 : le serveur ne « ne répond pas correctement », il REFUSE sciemment
    // (rate-limit anti-brute-force, 5 tentatives / 15 min). Le message générique
    // laissait croire à une panne et poussait à réessayer immédiatement, ce qui
    // aggravait le blocage. On relaie donc l'explication du serveur.
    if (err.status === 429) {
      const server = err.message.trim();
      return server && !GENERIC_HTTP_FALLBACK.test(server) ? server : RATE_LIMITED_MESSAGE;
    }
    return 'Le serveur ne répond pas correctement — réessayez dans un instant.';
  }
  // fetch a rejeté (TypeError "Failed to fetch", AbortError…) : pas de réponse
  // HTTP du tout -> problème de réseau côté utilisateur.
  return 'Connexion impossible — vérifiez votre connexion internet.';
}
