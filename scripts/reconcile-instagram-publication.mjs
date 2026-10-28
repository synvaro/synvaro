import { createDatabase } from '../packages/database/dist/index.js';
import { reconcileInstagramPublication } from '../apps/api/dist/publication/reconciliation.js';

// Operator-only: independently verify Meta media history before resolving UNCERTAIN.
const [id, outcome, providerPostId, evidence, operator] = process.argv.slice(2);
const db = createDatabase(process.env.DATABASE_URL);
try {
  const auditId = await reconcileInstagramPublication(db, {
    id,
    outcome,
    providerPostId: providerPostId === '-' ? undefined : providerPostId,
    evidence,
    operator,
  });
  console.log(`Reconciliation recorded: ${auditId}`);
} finally {
  await db.$disconnect();
}
