import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiOrigin } from './api-origin.ts';

test('accepts local and exact private API origins', () => {
  assert.equal(apiOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  assert.equal(apiOrigin('http://api:3001'), 'http://api:3001');
  assert.equal(
    apiOrigin('https://internal.example'),
    'https://internal.example',
  );
});

test('rejects credentialed, arbitrary HTTP, and path-bearing origins', () => {
  for (const value of [
    'http://api:3002',
    'http://other:3001',
    'http://example.com:3001',
    'http://user:password@api:3001',
    'http://api:3001/auth/me',
    'http://api:3001?source=other',
    'http://api:3001#fragment',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => apiOrigin(value));
  }
});
