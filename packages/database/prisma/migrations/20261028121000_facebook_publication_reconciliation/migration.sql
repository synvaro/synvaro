ALTER TABLE "Publication"
  ADD COLUMN "reconciliationEvidence" VARCHAR(500),
  ADD COLUMN "reconciliationOperator" VARCHAR(120),
  ADD COLUMN "reconciledAt" TIMESTAMPTZ(3);
