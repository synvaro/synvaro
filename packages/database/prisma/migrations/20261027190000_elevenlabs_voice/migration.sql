ALTER TYPE "MediaOrigin" ADD VALUE 'AI_VOICE';
ALTER TYPE "AiGenerationKind" ADD VALUE 'SPEECH';
ALTER TABLE "AiPreference" ADD COLUMN "speechEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiGeneration" ADD COLUMN "voiceId" VARCHAR(80);
ALTER TABLE "AiGeneration" ADD COLUMN "narrationCharacters" INTEGER;
ALTER TABLE "AiGeneration" ADD COLUMN "providerCharacterCost" INTEGER;
