-- CreateTable
CREATE TABLE "ContentMedia" (
    "contentId" UUID NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentMedia_pkey" PRIMARY KEY ("contentId","mediaAssetId")
);

-- CreateIndex
CREATE INDEX "ContentMedia_contentId_position_mediaAssetId_idx" ON "ContentMedia"("contentId", "position", "mediaAssetId");

-- CreateIndex
CREATE INDEX "ContentMedia_mediaAssetId_idx" ON "ContentMedia"("mediaAssetId");

-- AddForeignKey
ALTER TABLE "ContentMedia" ADD CONSTRAINT "ContentMedia_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMedia" ADD CONSTRAINT "ContentMedia_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
