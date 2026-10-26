import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';

test('SYN-001-A2: defaults and explicit environment are validated', () => {
  assert.deepEqual(loadConfig({}), {
    host: '127.0.0.1',
    port: 3001,
    environment: 'development',
  });
  assert.deepEqual(
    loadConfig({
      API_HOST: '0.0.0.0',
      API_PORT: '8080',
      NODE_ENV: 'production',
    }),
    { host: '0.0.0.0', port: 8080, environment: 'production' },
  );
  for (const port of ['', '0', '-1', '65536', '3001x', '1.5', 'Infinity']) {
    assert.throws(() => loadConfig({ API_PORT: port }), /API_PORT/);
  }
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), /NODE_ENV/);
  assert.throws(() => loadConfig({ API_HOST: ' ' }), /API_HOST/);
});
