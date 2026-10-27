import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptSocial,
  encryptSocial,
  encryptionReady,
} from '../social/crypto.js';

test('SYN-SOC-001: social credential encryption is versioned, authenticated and rotatable', () => {
  const oldKeys = process.env.SOCIAL_TOKEN_KEYS_JSON;
  const oldActive = process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID;
  const first = randomBytes(32).toString('base64');
  const second = randomBytes(32).toString('base64');
  try {
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({ first });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'first';
    assert.equal(encryptionReady(), true);
    const value = encryptSocial({ accessToken: 'private-test-token' });
    assert.match(value, /^v1:first:/);
    assert.ok(!value.includes('private-test-token'));
    assert.deepEqual(decryptSocial(value), {
      accessToken: 'private-test-token',
    });
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({ first, second });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'second';
    assert.deepEqual(decryptSocial(value), {
      accessToken: 'private-test-token',
    });
    assert.match(encryptSocial({ accessToken: 'new' }), /^v1:second:/);
    const tampered =
      value.slice(0, -2) + (value.endsWith('A') ? 'B' : 'A') + value.slice(-1);
    assert.throws(() => decryptSocial(tampered));
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({ second });
    assert.throws(() => decryptSocial(value));
  } finally {
    if (oldKeys === undefined) delete process.env.SOCIAL_TOKEN_KEYS_JSON;
    else process.env.SOCIAL_TOKEN_KEYS_JSON = oldKeys;
    if (oldActive === undefined) delete process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID;
    else process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = oldActive;
  }
});
