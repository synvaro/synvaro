import { createDatabase } from '../packages/database/dist/index.js';
import { releaseAbandonedYouTubeTransfer } from '../apps/api/dist/publication/reconciliation.js';

// Operator-only. Confirm process termination and absence of an in-flight PUT
// independently. An expired timestamp by itself is never enough evidence.
const [id, evidence, operator] = process.argv.slice(2);
if (!id || !evidence || !operator || !process.env.DATABASE_URL)
  throw new Error(
    'Usage: node script <publication-id> <termination-evidence> <operator> (DATABASE_URL required)',
  );
const db = createDatabase(process.env.DATABASE_URL);
try {
  const auditId = await releaseAbandonedYouTubeTransfer(db, {
    id,
    evidence,
    operator,
  });
  console.log(`YouTube transfer release recorded: ${auditId}`);
} finally {
  await db.$disconnect();
}
