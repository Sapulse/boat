-- Lot 3 — rangement des modèles (catégories + ordre manuel). Migration
-- STRICTEMENT ADDITIVE, écrite à la main (jamais la sortie de `prisma migrate
-- diff`, qui recréerait message_templates pour y ajouter des colonnes).
-- Même SQL que scripts/apply-template-layout-turso.ts (version idempotente).
-- Aucune donnée réécrite : tant qu'aucun rangement n'est fait, position = 0 et
-- l'ordre reste « plus récent d'abord » (lib/templateLayout).

-- CreateTable
CREATE TABLE "template_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0
);

-- AlterTable (ajout de colonnes)
ALTER TABLE "message_templates" ADD COLUMN "categoryId" TEXT REFERENCES "template_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_templates" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "message_templates_categoryId_idx" ON "message_templates"("categoryId");
