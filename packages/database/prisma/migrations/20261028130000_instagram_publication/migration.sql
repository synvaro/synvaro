ALTER TYPE "PublicationStatus" ADD VALUE 'PROCESSING';
ALTER TABLE "Publication"
  ADD COLUMN "providerContainerId" VARCHAR(160),
  ADD COLUMN "containerStatus" VARCHAR(32),
  ADD COLUMN "deliveryExpiresAt" TIMESTAMPTZ(3);
