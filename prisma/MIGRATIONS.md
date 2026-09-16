# Migrations — règles (à lire avant toute modification du schéma)

## 1. La migration écrite à la main fait foi

Sous SQLite / Turso, `prisma migrate diff` et `prisma migrate dev` **recréent une table
entière** pour lui ajouter une colonne : `CREATE TABLE "new_leads"`, copie des lignes
(`INSERT INTO "new_leads" … SELECT … FROM "leads"`), `DROP TABLE "leads"`,
`ALTER TABLE … RENAME`. Sur la base de prod, utilisée tous les jours par l'équipe,
c'est **inacceptable**.

- Les fichiers `prisma/migrations/*/migration.sql` sont **écrits à la main** et ne
  contiennent que des ajouts : `ALTER TABLE … ADD COLUMN`, `CREATE TABLE`,
  `CREATE INDEX`.
- Si Prisma génère une migration (après `prisma migrate dev` ou `diff`), **ne pas la
  garder telle quelle** : la réécrire en ajouts purs.
- Le harnais `scripts/harness-migrations-guard.ts` (lancé par `npm test` et la CI)
  **échoue** si une migration contient `DROP`, `RENAME`, une table `new_…`, une copie
  `INSERT INTO … SELECT` ou `PRAGMA foreign_keys=OFF`.

## 2. La prod ne se migre jamais avec la CLI Prisma

- `prisma.config.ts` refuse toute `DATABASE_URL` qui n'est pas `file:` : `migrate deploy`,
  `migrate dev`, `db push` ne peuvent viser que des bases locales.
- Rien dans le build (`build`, `vercel-build` = `prisma generate` + compilation), la CI
  (`.github/workflows/ci.yml`) ou le lanceur local n'exécute de migration contre Turso.
- La prod se migre avec `scripts/apply-*-turso.ts`, verrouillés par
  `scripts/lib/dbTarget.ts` :
  - cible **explicite** (`--target=prod` ou `--target=local --db=<fichier>`), aucune
    lecture automatique de `.env` ;
  - écriture en prod = `--apply` **et** `--target=prod` **et**
    `BOB_CONFIRM_PROD=<nom de la base>` ; sinon refus avant toute connexion ;
  - base visée affichée avant toute action, même à blanc.

## 3. Ordre en prod

1. `npm run backup:prod` (lit aussi une base pas encore migrée).
2. Script de migration **à blanc** (`--target=prod`), relu.
3. Répétition sur une copie locale des données réelles (`--target=local --db=…`).
4. `--apply` en prod dans une fenêtre sans utilisateur, preuve.
5. **Seulement ensuite**, déploiement du code qui lit les nouvelles colonnes / tables.
