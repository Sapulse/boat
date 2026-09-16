-- Lot 2 — actions programmées. Migration STRICTEMENT ADDITIVE, écrite à la main :
-- `prisma migrate diff` propose de RECRÉER leads et lead_actions (copie + DROP
-- TABLE) pour ajouter des colonnes ; refusé. SQLite sait ajouter une colonne
-- NOT NULL avec une valeur par défaut constante sans toucher aux lignes.
-- Même SQL que scripts/apply-planned-actions-turso.ts (version idempotente).

-- AlterTable (ajout de colonnes)
ALTER TABLE "leads" ADD COLUMN "noNextActionReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "leads" ADD COLUMN "noNextActionAt" TEXT NOT NULL DEFAULT '';
ALTER TABLE "lead_actions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'realisee';
ALTER TABLE "lead_actions" ADD COLUMN "plannedActionId" TEXT;

-- CreateTable
CREATE TABLE "planned_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "time" TEXT,
    "endTime" TEXT,
    "originalDate" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'a_faire',
    "doneAt" TEXT,
    "doneActionId" TEXT,
    CONSTRAINT "planned_actions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "planned_action_people" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "plannedActionId" TEXT NOT NULL,
    "commercialId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "planned_action_people_plannedActionId_fkey" FOREIGN KEY ("plannedActionId") REFERENCES "planned_actions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "planned_action_people_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "planned_actions_leadId_idx" ON "planned_actions"("leadId");
CREATE INDEX "planned_actions_status_date_idx" ON "planned_actions"("status", "date");
CREATE INDEX "planned_action_people_commercialId_idx" ON "planned_action_people"("commercialId");
CREATE UNIQUE INDEX "planned_action_people_plannedActionId_commercialId_key" ON "planned_action_people"("plannedActionId", "commercialId");
