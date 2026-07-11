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

export function loginErrorMessage(err: unknown): string {
  if (err instanceof LoginError) {
    // 401 : le seul champ vraiment saisi est le mot de passe (identifiant
    // pré-rempli) — on nomme la cause probable, sans jargon HTTP.
    if (err.status === 401) return 'Mot de passe incorrect.';
    return 'Le serveur ne répond pas correctement — réessayez dans un instant.';
  }
  // fetch a rejeté (TypeError "Failed to fetch", AbortError…) : pas de réponse
  // HTTP du tout -> problème de réseau côté utilisateur.
  return 'Connexion impossible — vérifiez votre connexion internet.';
}
