-- LOT SALONS (S1) — campagnes et participations. Migration STRICTEMENT ADDITIVE,
-- écrite à la main : deux tables neuves, leurs index, et UNE ligne de seed.
-- Aucune table existante n'est touchée — `leads` en particulier : le champ
-- `leads.source` dit d'où vient le lead la PREMIÈRE fois, il est immuable et
-- aucun script de ce lot ne l'écrit.
-- Même SQL que scripts/apply-campagnes-turso.ts (version idempotente).
--
-- DEUX PAIRES DE DATES (décision du 18/09) :
--   dateDebut / dateFin           = période d'ACTIVITÉ (préparation comprise),
--                                   borne les compteurs dérivés ;
--   dateSalonDebut / dateSalonFin = jours du SALON, bornent les RDV du stand.
-- Les confondre remettrait les compteurs à zéro le matin de l'ouverture.
--
-- Dates : TEXT "YYYY-MM-DD", '' = non renseignée (idiome du projet).

-- CreateTable
CREATE TABLE "campagnes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lieu" TEXT NOT NULL DEFAULT '',
    "dateDebut" TEXT NOT NULL DEFAULT '',
    "dateFin" TEXT NOT NULL DEFAULT '',
    "dateSalonDebut" TEXT NOT NULL DEFAULT '',
    "dateSalonFin" TEXT NOT NULL DEFAULT '',
    "objectifRdv" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "campagne_leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "campagneId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "responsableId" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT '',
    "priorite" TEXT NOT NULL DEFAULT 'Moyenne',
    "statutCampagne" TEXT NOT NULL DEFAULT 'À contacter',
    "bateauxAVoir" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "campagne_leads_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "campagnes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campagne_leads_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campagne_leads_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "campagne_leads_campagneId_leadId_key" ON "campagne_leads"("campagneId", "leadId");

-- CreateIndex
CREATE INDEX "campagne_leads_campagneId_idx" ON "campagne_leads"("campagneId");

-- CreateIndex
CREATE INDEX "campagne_leads_leadId_idx" ON "campagne_leads"("leadId");

-- CreateIndex
CREATE INDEX "campagne_leads_responsableId_idx" ON "campagne_leads"("responsableId");

-- Seed : la campagne du salon, identifiant FIXE (rejouable).
-- TODO (César / Nicolas) : renseigner dateFin, dateSalonDebut, dateSalonFin et
-- objectifRdv dès que les dates du Grand Pavois sont confirmées. C'est un simple
-- UPDATE d'UNE ligne, par exemple :
--   UPDATE "campagnes" SET "dateFin" = '2026-09-27', "dateSalonDebut" = '2026-09-22',
--          "dateSalonFin" = '2026-09-27', "objectifRdv" = 40, "updatedAt" = CURRENT_TIMESTAMP
--   WHERE "id" = 'campagne-grand-pavois-2026';
-- Tant que dateSalon* sont vides, l'écran affiche « dates du salon à renseigner »
-- et la détection des RDV retombe sur la fenêtre d'activité — jamais un chiffre
-- silencieusement faux.
INSERT OR IGNORE INTO "campagnes" ("id", "updatedAt", "nom", "type", "lieu", "dateDebut", "dateFin", "dateSalonDebut", "dateSalonFin", "objectifRdv", "active") VALUES ('campagne-grand-pavois-2026', CURRENT_TIMESTAMP, 'Grand Pavois 2026', 'salon', 'La Rochelle', '2026-09-18', '', '', '', NULL, true);
