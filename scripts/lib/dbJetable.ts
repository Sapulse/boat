/**
 * BASES JETABLES DES HARNAIS — hors du dépôt, et donc hors de OneDrive.
 *
 * Incident du 18/09 : `npm test` a échoué deux fois de suite sur un harnais
 * DIFFÉRENT (mort en moins d'une seconde), alors que chacun passait seul et que
 * l'exécution suivante était verte. Le lanceur est séquentiel : ce n'était donc
 * pas une collision entre harnais.
 *
 * Cause retenue : le dépôt est sur le Bureau, donc **synchronisé par OneDrive**.
 * OneDrive surveille le dossier pendant que des bases SQLite s'y créent, s'y
 * écrivent et s'y suppriment — d'où des verrous aléatoires (EPERM à la
 * suppression, fichier occupé à l'ouverture) et des `.db` orphelins qui
 * s'accumulent. Une suite qui échoue au hasard finit par être ignorée : on la
 * met à l'abri.
 *
 * Correctif : les bases de test vivent dans le dossier temporaire du SYSTÈME
 * (`os.tmpdir()`), sous un sous-dossier propre à l'exécution (pid + aléa), que
 * personne ne synchronise. Le vrai correctif — sortir le dépôt de OneDrive —
 * est noté au TODO pour après le salon.
 */
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Un dossier par EXÉCUTION : deux lancements simultanés ne se marchent pas dessus. */
const RACINE = path.join(os.tmpdir(), `bob-harnais-${process.pid}-${randomBytes(3).toString('hex')}`);

/**
 * Chemin d'une base jetable. `nom` sert seulement à la lisibilité des messages
 * d'erreur ; l'unicité vient du dossier.
 */
export function dbJetable(nom: string): string {
  mkdirSync(RACINE, { recursive: true });
  return path.join(RACINE, `${nom}.db`);
}

/**
 * Ménage de fin de test. TOLÉRANT par construction : un fichier encore verrouillé
 * ne doit pas faire échouer un harnais qui, lui, a réussi — on n'échange pas un
 * faux rouge contre un autre. Ce qui resterait est dans le dossier temporaire du
 * système, que l'OS nettoie.
 */
export function nettoyerDbJetables(...fichiers: string[]): void {
  for (const f of fichiers) {
    for (const suffixe of ['', '-wal', '-shm', '-journal']) {
      try { rmSync(f + suffixe, { force: true }); } catch { /* verrou : sans gravité */ }
    }
  }
  try { rmSync(RACINE, { recursive: true, force: true }); } catch { /* idem */ }
}
