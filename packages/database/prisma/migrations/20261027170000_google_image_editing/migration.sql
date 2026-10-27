ALTER TYPE "MediaOrigin" ADD VALUE 'AI_EDITED';

ALTER TABLE "AiPreference" ADD COLUMN "imageAspectRatio" VARCHAR(10) NOT NULL DEFAULT '1:1';
ALTER TABLE "AiGeneration" ADD COLUMN "imageAspectRatio" VARCHAR(10);
ALTER TABLE "AiGeneration" ADD COLUMN "sourceMediaAssetId" UUID;
ALTER TABLE "AiGeneration" ADD COLUMN "providerGenerationId" VARCHAR(160);

CREATE INDEX "AiGeneration_sourceMediaAssetId_idx" ON "AiGeneration"("sourceMediaAssetId");

ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_sourceMediaAssetId_fkey"
  FOREIGN KEY ("sourceMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
