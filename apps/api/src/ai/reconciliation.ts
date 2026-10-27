import type { createDatabase } from '@synvaro/database';

type Database = ReturnType<typeof createDatabase>;

// Operator-only. Evidence is independently verified before invocation. The
// original reservation and new charge are preserved in a unique audit row.
export async function reconcileGeneration(
  db: Database,
  input: {
    id: string;
    chargedMicros: number;
    evidence: string;
    operator: string;
  },
) {
  const { id, chargedMicros, evidence, operator } = input;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    ) ||
    !Number.isSafeInteger(chargedMicros) ||
    chargedMicros < 0 ||
    chargedMicros > 1_000_000_000 ||
    !evidence ||
    evidence.length > 500 ||
    !operator ||
    operator.length > 120
  )
    throw new Error(
      'A valid generation ID, verified charge, evidence reference and operator are required',
    );
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        status: string;
        costUncertain: boolean;
        budgetChargeMicros: number;
      }[]
    >`
      SELECT id, status, "costUncertain", "budgetChargeMicros"
      FROM "AiGeneration" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (
      !row ||
      !['FAILED', 'SUCCEEDED'].includes(row.status) ||
      !row.costUncertain
    )
      throw new Error('Generation is not an uncertain completed request');
    const audit = await tx.aiGenerationReconciliation.create({
      data: {
        generationId: id,
        previousBudgetChargeMicros: row.budgetChargeMicros,
        resolvedBudgetChargeMicros: chargedMicros,
        evidenceReference: evidence,
        operator,
      },
    });
    await tx.aiGeneration.update({
      where: { id },
      data: { budgetChargeMicros: chargedMicros, costUncertain: false },
    });
    return audit.id;
  });
}
