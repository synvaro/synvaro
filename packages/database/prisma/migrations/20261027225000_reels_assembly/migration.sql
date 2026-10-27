ALTER TYPE "MediaOrigin" ADD VALUE 'REEL_ASSEMBLED';
CREATE TYPE "ReelRenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TABLE "ReelRender" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requestId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "contentId" UUID NOT NULL,
  "scenes" JSONB NOT NULL,
  "narrationAssetId" UUID,
  "status" "ReelRenderStatus" NOT NULL DEFAULT 'QUEUED',
  "previewKey" UUID,
  "previewExpiresAt" TIMESTAMPTZ(3),
  "mediaAssetId" UUID,
  "durationMs" INTEGER NOT NULL,
  "errorCode" VARCHAR(40),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ReelRender_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReelRender_userId_requestId_key" ON "ReelRender"("userId", "requestId");
CREATE UNIQUE INDEX "ReelRender_previewKey_key" ON "ReelRender"("previewKey");
CREATE UNIQUE INDEX "ReelRender_mediaAssetId_key" ON "ReelRender"("mediaAssetId");
CREATE UNIQUE INDEX "ReelRender_one_active_per_user" ON "ReelRender"("userId") WHERE "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "ReelRender_userId_status_idx" ON "ReelRender"("userId", "status");
CREATE INDEX "ReelRender_contentId_createdAt_idx" ON "ReelRender"("contentId", "createdAt" DESC);
CREATE INDEX "ReelRender_previewExpiresAt_idx" ON "ReelRender"("previewExpiresAt");
ALTER TABLE "ReelRender" ADD CONSTRAINT "ReelRender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReelRender" ADD CONSTRAINT "ReelRender_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReelRender" ADD CONSTRAINT "ReelRender_narrationAssetId_fkey" FOREIGN KEY ("narrationAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReelRender" ADD CONSTRAINT "ReelRender_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
