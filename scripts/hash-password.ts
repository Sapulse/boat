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
  if (pw.length < 12) { console.error('❌ Trop court : 12 caractères minimum (une passphrase forte est recommandée).'); process.exit(1); }
  console.log('\n✅ Colle cette valeur dans Vercel → Settings → Environment Variables → APP_PASSWORD_HASH (Production) :\n');
  console.log(hashPassword(pw));
  console.log('\n(Le mot de passe n\'a pas été stocké ni transmis. Pense aussi à définir APP_USERNAME et SESSION_SECRET.)');
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
