// Politique de force du mot de passe partagé (durcissement auth, commit 1).
// Cœur PUR (aucune dépendance, aucune I/O) -> testable au harnais. Le mot de
// passe partagé est la SEULE barrière (compte unique) : cette garde empêche de
// hacher « par accident » un secret faible via scripts/hash-password.ts.
//
// Estimation d'entropie = longueur × log2(taille du jeu de caractères utilisé),
// MAIS pool×longueur seul se fait berner par la répétition (« aaaa…a » a une
// grosse « entropie » calculée alors qu'il est trivial). On ajoute donc deux
// garde-fous anti-répétition : nombre de caractères distincts, et part maximale
// d'un même caractère. Cible : un mot de passe généré (`openssl rand -base64 24`)
// ou une passphrase longue passent large ; un secret humain court/répétitif non.

export interface PasswordVerdict {
  ok: boolean;
  bits: number;      // entropie estimée (arrondie), pour le message
  reason?: string;   // renseigné seulement si ok === false
}

const MIN_LENGTH = 16;
const MIN_DISTINCT = 10;
const MIN_BITS = 80;
const MAX_SINGLE_CHAR_RATIO = 0.4;

/** Taille du jeu de caractères effectivement utilisé (classes présentes). */
export function charPoolSize(pw: string): number {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33; // symboles ASCII imprimables courants
  return pool;
}

/** Entropie estimée en bits : longueur × log2(pool). 0 si pool vide. */
export function estimateEntropyBits(pw: string): number {
  const pool = charPoolSize(pw);
  if (pool === 0 || pw.length === 0) return 0;
  return pw.length * Math.log2(pool);
}

/** Verdict de force. Ne renvoie JAMAIS le mot de passe (juste ok/bits/reason). */
export function checkPasswordStrength(pw: string): PasswordVerdict {
  const bits = Math.round(estimateEntropyBits(pw));

  if (pw.length < MIN_LENGTH) {
    return { ok: false, bits, reason: `Trop court : ${MIN_LENGTH} caractères minimum (viser une passphrase ou un secret généré).` };
  }

  const distinct = new Set(pw).size;
  if (distinct < MIN_DISTINCT) {
    return { ok: false, bits, reason: `Trop répétitif : au moins ${MIN_DISTINCT} caractères distincts requis (${distinct} trouvés).` };
  }

  // Part du caractère le plus fréquent : casse « xxxxxx!Axxxxxxxxx » et cie.
  const counts = new Map<string, number>();
  for (const c of pw) counts.set(c, (counts.get(c) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  if (maxCount / pw.length > MAX_SINGLE_CHAR_RATIO) {
    return { ok: false, bits, reason: `Trop répétitif : un même caractère occupe plus de ${Math.round(MAX_SINGLE_CHAR_RATIO * 100)} % du mot de passe.` };
  }

  if (bits < MIN_BITS) {
    return { ok: false, bits, reason: `Entropie insuffisante (~${bits} bits) : viser ≥ ${MIN_BITS} bits (allonger, ou mélanger majuscules/chiffres/symboles).` };
  }

  return { ok: true, bits };
}
