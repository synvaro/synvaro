import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { loadAuthConfig } from '../auth/auth.config.js';
import { reconcileGeneration } from '../ai/reconciliation.js';

test('AIG-G002: uncertain reservation requires evidence and writes one audit record atomically in PostgreSQL', async () => {
  const url = loadAuthConfig().databaseUrl;
  assert.ok(new URL(url).pathname.endsWith('_test'));
  const db = createDatabase(url);
  const slug = randomUUID();
  try {
    const user = await db.user.create({
      data: { email: `${slug}@example.test`, passwordHash: 'test-only' },
    });
    const org = await db.organization.create({
      data: { ownerUserId: user.id, name: 'Test', slug },
    });
    const brand = await db.brand.create({
      data: { organizationId: org.id, name: 'Test', slug },
    });
    const content = await db.content.create({
      data: { brandId: brand.id, title: 'Test', body: '' },
    });
    const generation = await db.aiGeneration.create({
      data: {
        userId: user.id,
        contentId: content.id,
        requestId: randomUUID(),
        model: 'gemini-3.8-flash',
        provider: 'google',
        maxOutputTokens: 512,
        status: 'FAILED',
        errorCode: 'GOOGLE_TIMEOUT',
        budgetChargeMicros: 4319,
        costUncertain: true,
      },
    });
    try {
      await assert.rejects(
        reconcileGeneration(db, {
          id: generation.id,
          chargedMicros: 0,
          evidence: '',
          operator: 'test operator',
        }),
      );
      assert.equal(
        (
          await db.aiGeneration.findUniqueOrThrow({
            where: { id: generation.id },
          })
        ).budgetChargeMicros,
        4319,
      );
      const auditId = await reconcileGeneration(db, {
        id: generation.id,
        chargedMicros: 525,
        evidence: 'verified provider usage record test-only',
        operator: 'test operator',
      });
      const audit = await db.aiGenerationReconciliation.findUniqueOrThrow({
        where: { id: auditId },
      });
      assert.equal(audit.previousBudgetChargeMicros, 4319);
      assert.equal(audit.resolvedBudgetChargeMicros, 525);
      const settled = await db.aiGeneration.findUniqueOrThrow({
        where: { id: generation.id },
      });
      assert.equal(settled.budgetChargeMicros, 525);
      assert.equal(settled.costUncertain, false);
      await assert.rejects(
        reconcileGeneration(db, {
          id: generation.id,
          chargedMicros: 0,
          evidence: 'repeat',
          operator: 'test operator',
        }),
      );
    } finally {
      await db.aiGenerationReconciliation.deleteMany({
        where: { generationId: generation.id },
      });
      await db.aiGeneration.delete({ where: { id: generation.id } });
      await db.content.delete({ where: { id: content.id } });
      await db.brand.delete({ where: { id: brand.id } });
      await db.organization.delete({ where: { id: org.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  } finally {
    await db.$disconnect();
  }
});
