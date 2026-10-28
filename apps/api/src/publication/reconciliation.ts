import { randomUUID } from 'node:crypto';
import type { createDatabase } from '@synvaro/database';

type Database = ReturnType<typeof createDatabase>;
export async function reconcileFacebookPublication(
  db: Database,
  input: {
    id: string;
    outcome: 'PUBLISHED' | 'FAILED';
    providerPostId?: string;
    evidence: string;
    operator: string;
  },
) {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.id) ||
    !['PUBLISHED', 'FAILED'].includes(input.outcome) ||
    !input.evidence.trim() ||
    input.evidence.length > 500 ||
    !input.operator.trim() ||
    input.operator.length > 120 ||
    (input.outcome === 'PUBLISHED' &&
      !/^\d{1,32}_\d{1,32}$/.test(input.providerPostId ?? '')) ||
    (input.outcome === 'FAILED' && input.providerPostId !== undefined)
  )
    throw new Error(
      'Valid publication, verified outcome, evidence and operator are required',
    );
  const auditId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Publication" WHERE id = ${input.id}::uuid FOR UPDATE`;
    const row = await tx.publication.findUnique({ where: { id: input.id } });
    if (!row || row.status !== 'UNCERTAIN' || row.reconciledAt)
      throw new Error(
        'Only an unreconciled uncertain publication can be resolved',
      );
    await tx.publication.update({
      where: { id: input.id },
      data: {
        status: input.outcome,
        providerPostId: input.providerPostId,
        reconciliationEvidence: `${auditId}: ${input.evidence}`,
        reconciliationOperator: input.operator,
        reconciledAt: new Date(),
      },
    });
  });
  return auditId;
}
