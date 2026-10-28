CREATE TYPE "PublicationKind" AS ENUM ('TEXT', 'IMAGE');
ALTER TABLE "Publication"
  ADD COLUMN "kind" "PublicationKind" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "mediaAssetId" UUID,
  ADD COLUMN "mediaSha256" CHAR(64),
  ADD COLUMN "mediaMimeType" VARCHAR(40),
  ADD COLUMN "mediaSizeBytes" INTEGER;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Publication_mediaAssetId_idx" ON "Publication"("mediaAssetId");
