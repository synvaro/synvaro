ALTER TYPE "SocialConnectionStatus" ADD VALUE 'DISCONNECTED';
ALTER TABLE "SocialOauthAttempt" ADD COLUMN "publishing" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "PublicationStatus" AS ENUM ('READY', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'UNCERTAIN');

CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "socialAccountId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL DEFAULT 'FACEBOOK',
    "pageId" VARCHAR(160) NOT NULL,
    "pageName" VARCHAR(200) NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "draftUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'READY',
    "providerPostId" VARCHAR(160),
    "errorCode" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Publication_userId_requestId_key" ON "Publication"("userId", "requestId");
CREATE INDEX "Publication_contentId_createdAt_idx" ON "Publication"("contentId", "createdAt" DESC);
CREATE INDEX "Publication_userId_status_idx" ON "Publication"("userId", "status");
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
