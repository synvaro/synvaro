-- CreateEnum
CREATE TYPE "AiGenerationStatus" AS ENUM ('COUNTING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');

-- CreateTable
CREATE TABLE "AiPreference" (
    "userId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "model" VARCHAR(80) NOT NULL DEFAULT 'gpt-6-luna',
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 512,
    "monthlyBudgetMicros" BIGINT,
    "confirmPaid" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "status" "AiGenerationStatus" NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostMicros" INTEGER,
    "budgetChargeMicros" INTEGER NOT NULL DEFAULT 0,
    "costUncertain" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGeneration_userId_createdAt_idx" ON "AiGeneration"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_contentId_idx" ON "AiGeneration"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "AiGeneration_userId_requestId_key" ON "AiGeneration"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "AiPreference" ADD CONSTRAINT "AiPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
