ALTER TYPE "MediaOrigin" ADD VALUE 'AI_VIDEO';
ALTER TYPE "AiGenerationStatus" ADD VALUE 'PENDING';
ALTER TYPE "AiGenerationKind" ADD VALUE 'VIDEO';
ALTER TABLE "AiPreference" ADD COLUMN "videoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiGeneration" ADD COLUMN "videoAspectRatio" VARCHAR(10);
ALTER TABLE "AiGeneration" ADD COLUMN "videoResolution" VARCHAR(10);
ALTER TABLE "AiGeneration" ADD COLUMN "videoDuration" VARCHAR(10);
ALTER TABLE "AiGeneration" ADD COLUMN "outputVideoTokens" INTEGER;
ALTER TABLE "AiGeneration" ADD COLUMN "videoHasAudio" BOOLEAN;
