/**
 * Harnais de la politique de force du mot de passe (durcissement auth, commit 1).
 *
 * Execution : npx tsx scripts/harness-password-policy.ts
 * (hors tsc -b et hors bundle Vite : ce fichier n'est importe par aucun fichier
 * de l'app et scripts/ n'est dans aucun tsconfig.)
 *
 * Couvre le coeur PUR (api/_lib/passwordPolicy.ts) :
 *  - rejet : trop court, trop peu de caracteres distincts, repetition d'un meme
 *    caractere, entropie insuffisante ;
 *  - acceptation : secret genere (openssl rand -base64 24), passphrase longue ;
 *  - l'estimation d'entropie NE se fait PAS berner par la repetition ;
 *  - le verdict ne contient jamais le mot de passe (juste ok/bits/reason).
 */

import { checkPasswordStrength, estimateEntropyBits, charPoolSize } from '../api/_lib/passwordPolicy';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n— ${title}`);
}

// ---------------------------------------------------------------------------
section('Rejets : longueur');
{
  const v = checkPasswordStrength('Ab1!xY9?');       // 8 car.
  check('mot de passe court (8) rejeté', !v.ok);
  check('raison mentionne la longueur', /court|minimum/i.test(v.reason ?? ''));
}

section('Rejets : répétition (le piège classique de pool×longueur)');
{
  const v = checkPasswordStrength('aaaaaaaaaaaaaaaaaaaa'); // 20 'a'
  check('20× le même caractère rejeté (distinct)', !v.ok);
  check('raison mentionne la répétition', /répétitif|distinct/i.test(v.reason ?? ''));
}
{
  // Long, quelques caractères distincts mais un dominant à >40%
  const v = checkPasswordStrength('aaaaaaaaaaaaaAbc1!def'); // 'a' très majoritaire
  check('caractère dominant (>40%) rejeté', !v.ok, `bits=${v.bits} reason=${v.reason}`);
}

section('Rejets : entropie insuffisante malgré longueur ok');
{
  // 16 caractères, 2 caractères alternés -> distinct faible
  const v = checkPasswordStrength('abababababababab');
  check('16 car. mais 2 distincts rejeté', !v.ok);
}

section('Acceptations : secrets réellement forts');
{
  // Simule un openssl rand -base64 24 (32 car., classes mixtes, très distinct)
  const generated = 'kJ8pQ2mZ0vR7nX4wL6tB9yC3sD1fG5hA';
  const v = checkPasswordStrength(generated);
  check('secret généré style base64 (32 car.) accepté', v.ok, v.reason);
  check('entropie estimée élevée (≥ 120 bits)', v.bits >= 120, `=${v.bits}`);
}
{
  // Passphrase longue avec variété
  const v = checkPasswordStrength('Cheval-Bateau-Brest-2026-Ocean!');
  check('passphrase longue variée acceptée', v.ok, v.reason);
}
{
  // Cas limite juste au-dessus du seuil : 16 car., 3 classes, bien distinct
  const v = checkPasswordStrength('Tr7$Km9pWz2Lx4Qb');
  check('16 car. mixtes bien distincts accepté', v.ok, `bits=${v.bits} reason=${v.reason}`);
}

section('Estimation d\'entropie : monotone et cohérente');
{
  check('pool = 0 pour chaîne vide', charPoolSize('') === 0);
  check('bits = 0 pour chaîne vide', estimateEntropyBits('') === 0);
  check('pool minuscules seules = 26', charPoolSize('abcdef') === 26);
  check('pool mixte 4 classes = 95', charPoolSize('aB3!') === 95);
  check('plus long -> plus de bits (même jeu)',
    estimateEntropyBits('aB3!aB3!aB3!aB3!aB3!') > estimateEntropyBits('aB3!aB3!'));
}

section('Le verdict ne fuit jamais le mot de passe');
{
  const secret = 'kJ8pQ2mZ0vR7nX4wL6tB9yC3sD1fG5hA';
  const v = checkPasswordStrength(secret);
  const serialized = JSON.stringify(v);
  check('sérialisation du verdict ne contient pas le mot de passe', !serialized.includes(secret));
  const weak = 'aaaaaaaaaaaaaaaaaaaa';
  check('verdict de rejet ne contient pas le mot de passe non plus',
    !JSON.stringify(checkPasswordStrength(weak)).includes(weak));
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log(`Harnais password-policy : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  console.error('Des invariants sont violés. ❌');
  process.exit(1);
}
console.log('Tous les invariants tiennent. ✅');
