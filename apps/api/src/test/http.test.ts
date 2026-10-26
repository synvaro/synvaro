import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

test('SYN-001-A1/A3: real HTTP health, OpenAPI and consistent 404', async () => {
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      service: 'synvaro-api',
    });
    const schema = await fetch(`${base}/openapi.json`);
    assert.equal(schema.status, 200);
    const doc = (await schema.json()) as { paths: Record<string, unknown> };
    assert.ok(doc.paths['/health']);
    const missing = await fetch(`${base}/not-found`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      statusCode: 404,
      message: 'Cannot GET /not-found',
    });
  } finally {
    await app.close();
  }
});
