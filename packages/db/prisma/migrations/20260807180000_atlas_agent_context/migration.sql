ALTER TABLE "agentConversation"
ADD COLUMN "atlasContextKind" TEXT,
ADD COLUMN "atlasContextId" TEXT;

CREATE INDEX "agentConversation_atlasContextKind_atlasContextId_lastMessageAt_idx"
ON "agentConversation"("atlasContextKind", "atlasContextId", "lastMessageAt");

CREATE TABLE "questionChangeProposal" (
  "id" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "queryLanguage" "QueryLanguage" NOT NULL,
  "queryText" TEXT NOT NULL,
  "display" TEXT NOT NULL,
  "visualization" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "questionChangeProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "questionChangeProposal_questionId_status_createdAt_idx"
ON "questionChangeProposal"("questionId", "status", "createdAt");

CREATE INDEX "questionChangeProposal_sessionId_createdAt_idx"
ON "questionChangeProposal"("sessionId", "createdAt");

ALTER TABLE "questionChangeProposal"
ADD CONSTRAINT "questionChangeProposal_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
