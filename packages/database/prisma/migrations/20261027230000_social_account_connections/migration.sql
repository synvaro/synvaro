-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('META', 'LINKEDIN', 'GOOGLE');

-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('CONNECTED', 'REAUTH_REQUIRED', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "SocialAttemptStatus" AS ENUM ('STARTED', 'READY', 'FAILED', 'USED');

-- CreateTable
CREATE TABLE "SocialOauthAttempt" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "stateHash" CHAR(64) NOT NULL,
    "sessionHash" CHAR(64) NOT NULL,
    "verifierEncrypted" TEXT,
    "credentialsEncrypted" TEXT,
    "discovered" JSONB,
    "status" "SocialAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "errorCode" VARCHAR(40),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SocialOauthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" VARCHAR(160) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "accountType" VARCHAR(40) NOT NULL,
    "status" "SocialConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "scopes" TEXT[],
    "credentialsEncrypted" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMPTZ(3),
    "refreshExpiresAt" TIMESTAMPTZ(3),
    "lastValidatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialOauthAttempt_stateHash_key" ON "SocialOauthAttempt"("stateHash");

-- CreateIndex
CREATE INDEX "SocialOauthAttempt_userId_expiresAt_idx" ON "SocialOauthAttempt"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "SocialOauthAttempt_expiresAt_idx" ON "SocialOauthAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "SocialAccount_brandId_createdAt_idx" ON "SocialAccount"("brandId", "createdAt" DESC);

CREATE INDEX "SocialAccount_grantId_idx" ON "SocialAccount"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");

-- AddForeignKey
ALTER TABLE "SocialOauthAttempt" ADD CONSTRAINT "SocialOauthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOauthAttempt" ADD CONSTRAINT "SocialOauthAttempt_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
