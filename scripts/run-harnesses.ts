/**
 * Lanceur de TOUS les harnais — `npm test`.
 *
 * Les ~29 harnais du projet (≈1000 assertions) ne tournaient jusqu'ici qu'un par
 * un, à la main : autant dire jamais en entier. Ce lanceur les découvre, les
 * exécute chacun dans son propre process (ils appellent `process.exit` et
 * possèdent leur base jetable) et rend un verdict unique.
 *
 * Deux garanties de sûreté :
 *  - les variables TURSO_* sont RETIRÉES de l'environnement des enfants : aucun
 *    harnais ne peut atteindre la base de prod, même par erreur de code. La prod
 *    est inaccessible par ABSENCE d'identifiants, pas par prudence ;
 *  - aucun saut SILENCIEUX : un harnais non exécuté est listé avec sa raison en
 *    fin de rapport. Un test sauté sans le dire se lit comme un test réussi.
 *
 * Exécution : npm test
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Harnais qui exigent un fichier local ABSENT du dépôt (donc de la CI). */
const CONDITIONAL: Record<string, { needs: string; why: string }> = {
  'harness-parse-email.ts': {
    needs: 'scripts/harness-parse-email.expected.local.json',
    why: 'attentes bâties sur de VRAIS emails de prospects — fichier gitignoré (RGPD), absent en CI',
  },
};

const tsx = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

// Environnement des enfants : sans le moindre identifiant Turso.
const childEnv = { ...process.env };
delete childEnv.TURSO_DATABASE_URL;
delete childEnv.TURSO_AUTH_TOKEN;

const files = readdirSync(path.resolve('scripts'))
  .filter(f => f.startsWith('harness-') && f.endsWith('.ts'))
  .sort();

const failures: Array<{ file: string; output: string }> = [];
const skipped: Array<{ file: string; why: string }> = [];
let ran = 0;

console.log(`Harnais découverts : ${files.length}\n`);

for (const file of files) {
  const cond = CONDITIONAL[file];
  if (cond && !existsSync(path.resolve(cond.needs))) {
    skipped.push({ file, why: `${cond.why} (attendu : ${cond.needs})` });
    console.log(`  ⊘ ${file.padEnd(34)} sauté`);
    continue;
  }

  const started = Date.now();
  const r = spawnSync(tsx, [path.join('scripts', file)], {
    encoding: 'utf-8', env: childEnv, shell: process.platform === 'win32',
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  ran++;

  if (r.status === 0) {
    console.log(`  ✔ ${file.padEnd(34)} ${secs}s`);
  } else {
    console.log(`  ✘ ${file.padEnd(34)} ${secs}s  ÉCHEC`);
    failures.push({ file, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd() });
  }
}

// Détail des échecs seulement : un run vert reste lisible d'un coup d'œil.
for (const f of failures) {
  console.error(`\n${'='.repeat(70)}\nÉCHEC — ${f.file}\n${'='.repeat(70)}`);
  console.error(f.output || '(aucune sortie)');
}

console.log(`\n${'='.repeat(70)}`);
console.log(`Harnais : ${ran - failures.length} OK, ${failures.length} KO sur ${ran} exécuté(s)`);
if (skipped.length) {
  console.log(`\n${skipped.length} harnais NON exécuté(s) — ce n'est PAS un succès :`);
  for (const s of skipped) console.log(`  ⊘ ${s.file} : ${s.why}`);
}
if (failures.length) {
  console.error('\nSuite ROUGE ❌');
  process.exit(1);
}
console.log('\nSuite VERTE ✅');
