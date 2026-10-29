import { createDatabase } from '@synvaro/database';
import { bootstrapOwner } from './bootstrap-owner.js';

async function readInput() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const part = Buffer.from(chunk);
    bytes += part.length;
    if (bytes > 512) throw new Error('Invalid owner credentials');
    chunks.push(part);
  }
  const lines = Buffer.concat(chunks).toString('utf8').split('\n');
  if (lines.length !== 3 || lines[2] !== '')
    throw new Error('Invalid owner credentials');
  return { email: lines[0]!, password: lines[1]! };
}

let db: ReturnType<typeof createDatabase> | undefined;
try {
  if (process.env.NODE_ENV !== 'production' || !process.env.DATABASE_URL)
    throw new Error('Production database configuration required');
  const credentials = await readInput();
  db = createDatabase(process.env.DATABASE_URL);
  await bootstrapOwner(credentials.email, credentials.password, db);
  console.log('Initial owner created.');
} catch {
  console.error(
    'Owner bootstrap failed. Check input and existing account state.',
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
