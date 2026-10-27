/*
  Warnings:

  - A unique constraint covering the columns `[previewKey]` on the table `AiGeneration` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[mediaAssetId]` on the table `AiGeneration` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AiGenerationKind" AS ENUM ('TEXT', 'IMAGE');

-- AlterEnum
ALTER TYPE "MediaOrigin" ADD VALUE 'AI_GENERATED';

-- AlterTable
ALTER TABLE "AiGeneration" ADD COLUMN     "imageQuality" VARCHAR(20),
ADD COLUMN     "imageSize" VARCHAR(20),
ADD COLUMN     "inputImageTokens" INTEGER,
ADD COLUMN     "kind" "AiGenerationKind" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "mediaAssetId" UUID,
ADD COLUMN     "previewExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "previewKey" UUID,
ADD COLUMN     "provider" VARCHAR(40) NOT NULL DEFAULT 'openai';

-- AlterTable
ALTER TABLE "AiPreference" ADD COLUMN     "imageEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageModel" VARCHAR(80) NOT NULL DEFAULT 'gpt-image-2.5-flare',
ADD COLUMN     "imageQuality" VARCHAR(20) NOT NULL DEFAULT 'low',
ADD COLUMN     "imageSize" VARCHAR(20) NOT NULL DEFAULT '1024x1024';

-- CreateIndex
CREATE UNIQUE INDEX "AiGeneration_previewKey_key" ON "AiGeneration"("previewKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiGeneration_mediaAssetId_key" ON "AiGeneration"("mediaAssetId");

-- CreateIndex
CREATE INDEX "AiGeneration_previewExpiresAt_idx" ON "AiGeneration"("previewExpiresAt");

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
