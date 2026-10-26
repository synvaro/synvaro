import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';

test('SYN-002B security: production public registration stays closed', async () => {
  const databaseUrl = process.env.DATABASE_URL!;
  assert.ok(new URL(databaseUrl).pathname.endsWith('_test'));
  const savedEnvironment = process.env.NODE_ENV;
  const savedOrigin = process.env.WEB_ORIGIN;
  process.env.NODE_ENV = 'production';
  process.env.WEB_ORIGIN = 'https://studio.example.test';
  const app = await createApp();
  const db = createDatabase(databaseUrl);
  const email = `production-denied-${randomUUID()}@example.test`;
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/auth/register`, {
      method: 'POST',
      headers: {
        origin: process.env.WEB_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password: 'Production-test-password' }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(await db.user.count({ where: { email } }), 0);
  } finally {
    await app.close();
    await db.$disconnect();
    if (savedEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnvironment;
    if (savedOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = savedOrigin;
  }
});
