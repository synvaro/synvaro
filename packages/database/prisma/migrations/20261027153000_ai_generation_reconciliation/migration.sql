CREATE TABLE "AiGenerationReconciliation" (
    "id" UUID NOT NULL,
    "generationId" UUID NOT NULL,
    "previousBudgetChargeMicros" INTEGER NOT NULL,
    "resolvedBudgetChargeMicros" INTEGER NOT NULL,
    "evidenceReference" VARCHAR(500) NOT NULL,
    "operator" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGenerationReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGenerationReconciliation_generationId_key" ON "AiGenerationReconciliation"("generationId");

ALTER TABLE "AiGenerationReconciliation" ADD CONSTRAINT "AiGenerationReconciliation_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "AiGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
