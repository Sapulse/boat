// Config Prisma 7 (chantier migration, Lot 1).
//
// En Prisma 7, l'url de la datasource est retirée du schema.prisma : elle est
// fournie ici pour Migrate. On reste sur une base LOCALE de dev (file:./dev.db)
// tant que le schéma n'est pas validé ; la vraie base Turso (région UE) sera
// créée plus tard (Lots 4-6). Pour pusher vers Turso le moment venu, on suivra
// le pattern SAForm (migrate diff --script + script de push libsql), quand les
// vars TURSO_DATABASE_URL / TURSO_AUTH_TOKEN seront présentes dans .env.
//
// ZÉRO impact runtime : ce fichier est hors du bundle Vite (tsc -b ne compile
// que src/ + vite.config.ts) et hors du lint (ignoré dans eslint.config.js).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./dev.db",
  },
});
