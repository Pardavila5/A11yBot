-- CreateTable
CREATE TABLE "Website" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL,
    "websiteId" INTEGER NOT NULL,
    "rawJson" JSONB NOT NULL,
    CONSTRAINT "Audit_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "auditId" INTEGER NOT NULL,
    "ruleId" TEXT NOT NULL,
    "impact" TEXT,
    "description" TEXT NOT NULL,
    "help" TEXT NOT NULL,
    "helpUrl" TEXT NOT NULL,
    "wcag" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    CONSTRAINT "Rule_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "auditId" INTEGER NOT NULL,
    "ruleRef" INTEGER NOT NULL,
    "htmlSnippet" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "failureSummary" TEXT,
    CONSTRAINT "Occurrence_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Occurrence_ruleRef_fkey" FOREIGN KEY ("ruleRef") REFERENCES "Rule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Website_url_key" ON "Website"("url");
