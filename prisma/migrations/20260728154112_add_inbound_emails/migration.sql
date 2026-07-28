-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "graphId" TEXT NOT NULL,
    "internetMessageId" TEXT NOT NULL,
    "receivedAt" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL DEFAULT '',
    "sourceDetail" TEXT,
    "leadSource" TEXT NOT NULL DEFAULT '',
    "extracted" TEXT NOT NULL DEFAULT '{}',
    "score" INTEGER NOT NULL,
    "scoreReasons" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'a_traiter',
    "leadId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_internetMessageId_key" ON "inbound_emails"("internetMessageId");

-- CreateIndex
CREATE INDEX "inbound_emails_status_idx" ON "inbound_emails"("status");

-- CreateIndex
CREATE INDEX "inbound_emails_receivedAt_idx" ON "inbound_emails"("receivedAt");
