/**
 * Génère APP_PASSWORD_HASH pour l'auth à compte partagé (Lot 7 allégé).
 *
 * Exécution : npx tsx scripts/hash-password.ts
 *
 * Le mot de passe est saisi au clavier EN MASQUÉ (pas d'argument CLI -> rien dans
 * l'historique shell), n'est jamais écrit sur disque ni affiché. Seule la ligne
 * `scrypt$...` est imprimée : à coller dans Vercel -> variable APP_PASSWORD_HASH
 * (Production). Utilise le MÊME hashPassword que le serveur (format garanti).
 */
import { createInterface, type Interface } from 'node:readline';
import { hashPassword } from '../api/_lib/auth';
import { checkPasswordStrength } from '../api/_lib/passwordPolicy';

// Saisie masquée : on n'écrit sur la sortie que la question, jamais les frappes.
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    (rl as Interface & { _writeToOutput?: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s); // affiche la question, masque les caractères tapés
    };
    rl.question(question, (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const pw = await promptHidden('Mot de passe partagé (saisie masquée) : ');
  const pw2 = await promptHidden('Confirmer : ');
  if (pw !== pw2) { console.error('❌ Les mots de passe ne correspondent pas.'); process.exit(1); }
  // Garde d'entropie (durcissement auth) : le mot de passe partagé est la SEULE
  // barrière → on refuse de hacher un secret faible. Astuce : `openssl rand -base64 24`.
  const verdict = checkPasswordStrength(pw);
  if (!verdict.ok) {
    console.error(`❌ ${verdict.reason}`);
    console.error('   Astuce : génère un secret fort avec  openssl rand -base64 24');
    process.exit(1);
  }
  console.log(`\n✅ Mot de passe accepté (~${verdict.bits} bits d'entropie estimée).`);
  console.log('Colle cette valeur dans Vercel → Settings → Environment Variables → APP_PASSWORD_HASH (Production) :\n');
  console.log(hashPassword(pw));
  console.log('\n(Le mot de passe n\'a pas été stocké ni transmis. Pense aussi à définir APP_USERNAME et SESSION_SECRET.)');
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
