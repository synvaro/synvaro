CREATE TYPE "SessionStage" AS ENUM ('PENDING_MFA', 'FULL');
ALTER TABLE "Session" ADD COLUMN "stage" "SessionStage" NOT NULL DEFAULT 'PENDING_MFA', ADD COLUMN "mfaAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "pendingMfaSecret" TEXT;
-- Existing sessions have not passed the new factor. Require password re-entry.
UPDATE "Session" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL;
CREATE TABLE "UserMfa" (
  "userId" UUID NOT NULL PRIMARY KEY,
  "secretEncrypted" TEXT NOT NULL,
  "lastCounter" BIGINT NOT NULL DEFAULT -1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "MfaRecoveryCode" (
  "id" UUID NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MfaRecoveryCode_userId_codeHash_key" ON "MfaRecoveryCode"("userId", "codeHash");
