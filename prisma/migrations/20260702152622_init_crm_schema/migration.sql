-- CreateTable
CREATE TABLE "commercials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "email" TEXT,
    "signature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "commercialId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "boatType" TEXT NOT NULL DEFAULT '',
    "boatCondition" TEXT NOT NULL DEFAULT '',
    "boatInterest" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "budget" REAL,
    "status" TEXT NOT NULL,
    "contactDate" TEXT NOT NULL DEFAULT '',
    "quoteAmount" REAL,
    "probability" REAL,
    "currentBoat" TEXT NOT NULL DEFAULT '',
    "comments" TEXT NOT NULL DEFAULT '',
    "deliveryDate" TEXT NOT NULL DEFAULT '',
    "temperature" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "nextActionType" TEXT NOT NULL DEFAULT '',
    "nextActionDate" TEXT NOT NULL DEFAULT '',
    "nextActionTime" TEXT,
    "nextActionEndTime" TEXT,
    "lastActionDate" TEXT NOT NULL DEFAULT '',
    "lossReason" TEXT NOT NULL DEFAULT '',
    "signedAt" TEXT NOT NULL DEFAULT '',
    "lostAt" TEXT NOT NULL DEFAULT '',
    "reportedAt" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "leads_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lead_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "newStatus" TEXT,
    "nextActionType" TEXT,
    "nextActionDate" TEXT,
    CONSTRAINT "lead_actions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lead_actions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "monthly_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "budget" REAL,
    "leads" INTEGER
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "endTime" TEXT,
    "commercialId" TEXT,
    "category" TEXT,
    "note" TEXT,
    CONSTRAINT "calendar_events_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "commercials" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "commercial_goals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "commercialId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "prospectsCreatedTarget" REAL,
    "prospectsCreatedOverride" REAL,
    "coldCallsTarget" REAL,
    "coldCallsOverride" REAL,
    "followupsTarget" REAL,
    "followupsOverride" REAL,
    "meetingsTarget" REAL,
    "meetingsOverride" REAL,
    "revenueTarget" REAL,
    "revenueOverride" REAL,
    "conversionRateTarget" REAL,
    "conversionRateOverride" REAL,
    CONSTRAINT "commercial_goals_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "commercials" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "default_goal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "prospectsCreated" REAL,
    "coldCalls" REAL,
    "followups" REAL,
    "meetings" REAL,
    "revenue" REAL,
    "conversionRate" REAL
);

-- CreateIndex
CREATE INDEX "leads_commercialId_idx" ON "leads"("commercialId");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "lead_actions_leadId_idx" ON "lead_actions"("leadId");

-- CreateIndex
CREATE INDEX "lead_actions_authorId_idx" ON "lead_actions"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_stats_year_month_source_key" ON "monthly_stats"("year", "month", "source");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_goals_commercialId_year_month_key" ON "commercial_goals"("commercialId", "year", "month");
