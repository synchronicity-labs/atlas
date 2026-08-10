CREATE TABLE "rudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contextKind" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "hermesSessionId" TEXT NOT NULL,
    "title" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rudySession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rudySession_hermesSessionId_key"
ON "rudySession"("hermesSessionId");

CREATE INDEX "rudySession_userId_contextKind_contextId_lastMessageAt_idx"
ON "rudySession"("userId", "contextKind", "contextId", "lastMessageAt");

ALTER TABLE "rudySession"
ADD CONSTRAINT "rudySession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
