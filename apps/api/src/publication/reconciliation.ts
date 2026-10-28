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
    if (
      !row ||
      row.platform !== 'FACEBOOK' ||
      row.status !== 'UNCERTAIN' ||
      row.reconciledAt
    )
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

/** Operator-only. Evidence must independently identify the Instagram media or prove no post. */
export async function reconcileInstagramPublication(
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
      !/^\d{1,32}$/.test(input.providerPostId ?? '')) ||
    (input.outcome === 'FAILED' && input.providerPostId !== undefined)
  )
    throw new Error(
      'Valid Instagram outcome, evidence and operator are required',
    );
  const auditId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Publication" WHERE id = ${input.id}::uuid FOR UPDATE`;
    const row = await tx.publication.findUnique({ where: { id: input.id } });
    if (
      !row ||
      row.platform !== 'INSTAGRAM' ||
      row.status !== 'UNCERTAIN' ||
      row.reconciledAt
    )
      throw new Error(
        'Only an unreconciled uncertain Instagram publication can be resolved',
      );
    await tx.publication.update({
      where: { id: input.id },
      data: {
        status: input.outcome,
        providerPostId: input.providerPostId,
        reconciliationEvidence: `${auditId}: ${input.evidence}`,
        reconciliationOperator: input.operator,
        reconciledAt: new Date(),
        completedAt: new Date(),
      },
    });
  });
  return auditId;
}

/** Operator-only: an uncertain LinkedIn attempt needs independently checked evidence. */
export async function reconcileLinkedInPublication(
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
      !/^urn:li:(?:share|ugcPost):\d{1,32}$/.test(
        input.providerPostId ?? '',
      )) ||
    (input.outcome === 'FAILED' && input.providerPostId !== undefined)
  )
    throw new Error(
      'Verified LinkedIn outcome, evidence and operator are required',
    );
  const auditId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Publication" WHERE id = ${input.id}::uuid FOR UPDATE`;
    const row = await tx.publication.findUnique({ where: { id: input.id } });
    if (
      !row ||
      row.platform !== 'LINKEDIN' ||
      row.status !== 'UNCERTAIN' ||
      row.reconciledAt
    )
      throw new Error(
        'Only an unreconciled uncertain LinkedIn publication can be resolved',
      );
    await tx.publication.update({
      where: { id: input.id },
      data: {
        status: input.outcome,
        providerPostId: input.providerPostId,
        reconciliationEvidence: `${auditId}: ${input.evidence}`,
        reconciliationOperator: input.operator,
        reconciledAt: new Date(),
        completedAt: new Date(),
      },
    });
  });
  return auditId;
}

/**
 * Operator-only crash recovery. An expired lease is diagnostic, not proof that
 * a provider PUT has stopped. Evidence must establish that the old process is
 * terminated and no HTTP upload remains in flight before this is called.
 */
export async function releaseAbandonedYouTubeTransfer(
  db: Database,
  input: { id: string; evidence: string; operator: string },
) {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.id) ||
    !input.evidence.trim() ||
    input.evidence.length > 450 ||
    !input.operator.trim() ||
    input.operator.length > 120
  )
    throw new Error(
      'Valid publication, process-termination evidence and operator are required',
    );
  const auditId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Publication" WHERE id = ${input.id}::uuid FOR UPDATE`;
    const row = await tx.publication.findUnique({ where: { id: input.id } });
    if (
      !row ||
      row.platform !== 'YOUTUBE' ||
      row.status !== 'PUBLISHING' ||
      !(
        (row.youtubeTransferOwner &&
          row.youtubeTransferLeaseUntil &&
          row.youtubeTransferLeaseUntil <= new Date()) ||
        (!row.youtubeTransferOwner &&
          !row.youtubeTransferLeaseUntil &&
          row.confirmedAt &&
          row.confirmedAt.getTime() <= Date.now() - 300_000)
      ) ||
      !row.youtubeSessionEncrypted ||
      row.providerPostId ||
      row.reconciledAt
    )
      throw new Error(
        'Only an expired, known-session, unverified YouTube transfer can be released',
      );
    await tx.publication.update({
      where: { id: input.id },
      data: {
        status: 'UNCERTAIN',
        errorCode: 'INTERRUPTED',
        youtubeTransferOwner: null,
        youtubeTransferLeaseUntil: null,
        reconciliationEvidence: `${auditId}: ${input.evidence}`,
        reconciliationOperator: input.operator,
        reconciledAt: new Date(),
      },
    });
  });
  return auditId;
}
