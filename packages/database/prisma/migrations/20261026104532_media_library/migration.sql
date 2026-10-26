-- CreateEnum
CREATE TYPE "MediaOrigin" AS ENUM ('UPLOADED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "storageKey" UUID NOT NULL,
    "mimeType" VARCHAR(40) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "origin" "MediaOrigin" NOT NULL DEFAULT 'UPLOADED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_brandId_createdAt_id_idx" ON "MediaAsset"("brandId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
