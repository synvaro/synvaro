ALTER TYPE "PublicationKind" ADD VALUE 'VIDEO';

ALTER TABLE "Publication"
  ADD COLUMN "youtubeTitle" VARCHAR(100),
  ADD COLUMN "youtubePrivacy" VARCHAR(16),
  ADD COLUMN "youtubeSessionEncrypted" TEXT,
  ADD COLUMN "youtubeUploadedBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "youtubeWidth" INTEGER,
  ADD COLUMN "youtubeHeight" INTEGER,
  ADD COLUMN "youtubeDurationMs" INTEGER,
  ADD COLUMN "youtubeProcessingStatus" VARCHAR(32),
  ADD COLUMN "youtubeLastProbeAt" TIMESTAMPTZ(3);
