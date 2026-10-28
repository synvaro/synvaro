ALTER TABLE "Publication"
  ADD COLUMN "youtubeTransferOwner" UUID,
  ADD COLUMN "youtubeTransferLeaseUntil" TIMESTAMPTZ(3);
