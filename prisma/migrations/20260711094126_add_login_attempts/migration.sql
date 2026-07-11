-- CreateTable
CREATE TABLE "login_attempts" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" INTEGER NOT NULL
);
