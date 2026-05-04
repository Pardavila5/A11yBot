-- Align the persisted schema with the current TFG baseline.
ALTER TABLE "Audit" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "Audit" ADD COLUMN "notes" TEXT;

CREATE TABLE "AiTrace" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operation" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "auditId" INTEGER,
    "compareOldAudit" INTEGER,
    "compareNewAudit" INTEGER,
    "ruleId" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "requestMeta" JSONB NOT NULL,
    "responseMeta" JSONB NOT NULL,
    CONSTRAINT "AiTrace_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AiTrace_createdAt_idx" ON "AiTrace"("createdAt");
CREATE INDEX "AiTrace_operation_idx" ON "AiTrace"("operation");
CREATE INDEX "AiTrace_source_idx" ON "AiTrace"("source");
CREATE INDEX "AiTrace_auditId_idx" ON "AiTrace"("auditId");
