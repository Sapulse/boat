// Config Prisma 7 (chantier migration, Lot 1).
//
// En Prisma 7, l'url de la datasource est retirée du schema.prisma : elle est
// fournie ici pour Migrate. Base LOCALE uniquement (file:./dev.db par défaut).
//
// VERROU (2026-09-16) : la CLI Prisma (migrate deploy / dev / diff, db push,
// studio) ne vise JAMAIS Turso.
//  - `.env` n'est plus chargé en bloc : seule DATABASE_URL en est lue ;
//  - toute URL non `file:` est REFUSÉE (libsql://, https://…).
// Les migrations de la prod passent exclusivement par les scripts
// scripts/apply-*-turso.ts, eux-mêmes verrouillés (scripts/lib/dbTarget.ts).
// Et les migrations écrites à la main font foi : voir prisma/MIGRATIONS.md.
//
// ZÉRO impact runtime : ce fichier est hors du bundle Vite (tsc -b ne compile
// que src/ + vite.config.ts) et hors du lint (ignoré dans eslint.config.js).
import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

function databaseUrlFromEnvFile(): string | undefined {
  if (!existsSync(".env")) return undefined;
  const line = readFileSync(".env", "utf-8").split(/\r?\n/).find(l => /^\s*DATABASE_URL\s*=/.test(l));
  return line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").replace(/^["']|["']$/g, "").trim() || undefined;
}

const url = process.env["DATABASE_URL"] ?? databaseUrlFromEnvFile() ?? "file:./dev.db";
if (!url.startsWith("file:")) {
  throw new Error(`prisma.config.ts : DATABASE_URL doit être une base locale « file:… » (reçu « ${url.slice(0, 40)}… »). La CLI Prisma ne vise jamais Turso.`);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});
