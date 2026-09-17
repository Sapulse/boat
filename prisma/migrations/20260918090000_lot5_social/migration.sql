-- Lot 5 — réseaux sociaux (onglet « Réseaux sociaux » d'Acquisition). Migration
-- STRICTEMENT ADDITIVE, écrite à la main : deux tables neuves et leur index,
-- aucune table existante touchée (monthly_stats n'est PAS réutilisée).
-- Même SQL que scripts/apply-social-turso.ts (version idempotente).
-- Jamais de suppression : un réseau s'archive, un mois se corrige.

-- CreateTable
CREATE TABLE "social_networks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "social_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "networkId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "followers" INTEGER NOT NULL,
    "posts" INTEGER,
    "reach" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "social_stats_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "social_networks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "social_stats_networkId_year_month_key" ON "social_stats"("networkId", "year", "month");

-- Réseaux par défaut (identifiants fixes, rejouable)
INSERT OR IGNORE INTO "social_networks" ("id", "updatedAt", "name", "position", "archived") VALUES ('reseau-facebook', CURRENT_TIMESTAMP, 'Facebook', 1, false);
INSERT OR IGNORE INTO "social_networks" ("id", "updatedAt", "name", "position", "archived") VALUES ('reseau-instagram', CURRENT_TIMESTAMP, 'Instagram', 2, false);
INSERT OR IGNORE INTO "social_networks" ("id", "updatedAt", "name", "position", "archived") VALUES ('reseau-linkedin', CURRENT_TIMESTAMP, 'LinkedIn', 3, false);
