import { createDatabase } from '../packages/database/dist/index.js';
import { reconcileGeneration } from '../apps/api/dist/ai/reconciliation.js';

// Explicit, operator-only action after independent provider billing review.
const [id, charged, evidence, operator] = process.argv.slice(2);
const db = createDatabase(process.env.DATABASE_URL ?? '');
try {
  const auditId = await reconcileGeneration(db, {
    id,
    chargedMicros: Number(charged),
    evidence,
    operator,
  });
  console.log(`Reconciled ${id}; audit ${auditId}`);
} finally {
  await db.$disconnect();
}
