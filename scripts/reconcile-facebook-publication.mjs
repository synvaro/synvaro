import { createDatabase } from '../packages/database/dist/index.js';
import { reconcileFacebookPublication } from '../apps/api/dist/publication/reconciliation.js';

// Operator-only: independently verify Meta Page history before resolving UNCERTAIN.
const [id, outcome, providerPostId, evidence, operator] = process.argv.slice(2);
const db = createDatabase(process.env.DATABASE_URL);
try {
  const auditId = await reconcileFacebookPublication(db, {
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
