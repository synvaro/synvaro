import * as argon2 from 'argon2';
import type { createDatabase } from '@synvaro/database';
import { hashOptions } from './auth.service.js';
import { parseCredentials } from './auth-security.js';

type Database = ReturnType<typeof createDatabase>;

/** Create the first account only; never expose this operation over HTTP. */
export async function bootstrapOwner(
  email: string,
  password: string,
  db: Database,
) {
  const credentials = parseCredentials({ email, password });
  const passwordHash = await argon2.hash(credentials.password, hashOptions);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(19019001)::text`;
    if ((await tx.user.count()) !== 0)
      throw new Error('Initial owner already exists');
    await tx.user.create({
      data: { email: credentials.email, passwordHash },
    });
  });
}
