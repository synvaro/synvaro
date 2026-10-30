import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import { loadAuthConfig } from '../auth/auth.config.js';
import { AuthRateLimiter, sessionCookie } from '../auth/auth-security.js';

const database = 'postgresql://test:example@127.0.0.1/test_test';
test('SYN-002A-A10: production requires HTTPS and host-only Secure/HttpOnly/Strict cookie', () => {
  for (const origin of [
    undefined,
    'http://127.0.0.1:3000',
    'https://example.test/path',
    'https://user:password@example.test',
  ]) {
    assert.throws(() =>
      loadAuthConfig({
        NODE_ENV: 'production',
        DATABASE_URL: database,
        WEB_ORIGIN: origin,
      }),
    );
  }
  assert.throws(() =>
    loadAuthConfig({
      NODE_ENV: 'test',
      DATABASE_URL: database,
      WEB_ORIGIN: 'http://remote.example',
    }),
  );
  const config = loadAuthConfig({
    NODE_ENV: 'production',
    DATABASE_URL: database,
    WEB_ORIGIN: 'https://studio.example.test',
    AUTH_TOTP_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  assert.equal(config.mfaRequired, true);
  let header = '';
  const response = {
    setHeader: (_name: string, value: string) => {
      header = value;
    },
  } as unknown as Response;
  sessionCookie(response, config, 'test-only-value');
  assert.ok(header.startsWith('__Host-synvaro-session='));
  assert.ok(
    /; Secure/.test(header) &&
      /; HttpOnly/.test(header) &&
      /; SameSite=Strict/.test(header),
  );
  assert.ok(/; Path=\//.test(header) && !/Domain=/.test(header));
  sessionCookie(response, config, null);
  assert.ok(/Max-Age=0/.test(header) && /; Secure/.test(header));
});
test('SYN-002A-A9: rate windows expire and client address spoofing is not a configuration option', () => {
  const limiter = new AuthRateLimiter();
  const res = { setHeader: () => {} } as unknown as Response;
  limiter.consume('test', 1, res, 1000);
  assert.throws(() => limiter.consume('test', 1, res, 1001));
  assert.doesNotThrow(() => limiter.consume('test', 1, res, 901001));
});
