-- Lot 4 — objectifs de la semaine. Migration STRICTEMENT ADDITIVE,
-- écrite à la main : une table neuve et ses index, aucune table existante touchée.
-- Même SQL que scripts/apply-weekly-objectives-turso.ts (version idempotente).
-- Jamais de suppression d'objectif : active = false (retiré).

-- CreateTable
CREATE TABLE "weekly_objectives" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "weekStart" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "ownerId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "copiedFromId" TEXT,
    "modifiedAfterWeekAt" TEXT,
    CONSTRAINT "weekly_objectives_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "weekly_objectives_weekStart_idx" ON "weekly_objectives"("weekStart");
CREATE INDEX "weekly_objectives_ownerId_idx" ON "weekly_objectives"("ownerId");
