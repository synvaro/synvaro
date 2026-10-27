import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialProviders, SocialProviderError } from '../social/providers.js';

test('SYN-SOC-001 provider adapters parse bounded OAuth token and account discovery responses', async () => {
  const oldFetch = globalThis.fetch;
  const old = {
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
  Object.assign(process.env, {
    META_APP_ID: 'meta-test',
    META_APP_SECRET: 'meta-secret',
    LINKEDIN_CLIENT_ID: 'linkedin-test',
    LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
    GOOGLE_OAUTH_CLIENT_ID: 'google-test',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
  });
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.redirect, 'error');
    if (
      url.includes('/oauth/access_token') ||
      url.includes('/oauth/v2/accessToken') ||
      url.includes('oauth2.googleapis.com/token')
    ) {
      const form = init?.body as URLSearchParams;
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.ok(form.get('redirect_uri')?.endsWith('/callback'));
      return Response.json({
        access_token: 'private-access',
        refresh_token: 'private-refresh',
        expires_in: 3600,
        scope: 'openid profile',
      });
    }
    if (url.includes('/me/accounts'))
      return Response.json({
        data: [
          {
            id: 'page-1',
            name: 'Test Page',
            access_token: 'private-page-token',
            instagram_business_account: { id: 'ig-1', username: 'test_ig' },
          },
        ],
      });
    if (url.includes('/v2/userinfo'))
      return Response.json({ sub: 'member-1', name: 'Test Member' });
    if (url.includes('/youtube/v3/channels'))
      return Response.json({
        items: [{ id: 'channel-1', snippet: { title: 'Test Channel' } }],
      });
    throw new Error('Unexpected endpoint');
  };
  try {
    const adapter = new SocialProviders();
    const page = await adapter.complete('META', 'FACEBOOK', 'code');
    assert.equal(page[0]?.externalId, 'page-1');
    assert.equal(page[0]?.credential.accessToken, 'private-page-token');
    const instagram = await adapter.complete('META', 'INSTAGRAM', 'code');
    assert.equal(instagram[0]?.externalId, 'ig-1');
    assert.equal(instagram[0]?.accountType, 'PROFESSIONAL');
    const linkedin = await adapter.complete('LINKEDIN', 'LINKEDIN', 'code');
    assert.equal(linkedin[0]?.externalId, 'member-1');
    const youtube = await adapter.complete(
      'GOOGLE',
      'YOUTUBE',
      'code',
      'verifier',
    );
    assert.equal(youtube[0]?.externalId, 'channel-1');
    assert.equal(youtube[0]?.credential.refreshToken, 'private-refresh');
    assert.equal(requests.length, 8);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('SYN-SOC-001 provider errors are classified without raw response details', async () => {
  const oldFetch = globalThis.fetch;
  const adapter = new SocialProviders();
  try {
    for (const [status, category] of [
      [401, 'AUTH'],
      [403, 'PERMISSION'],
      [429, 'RATE_LIMIT'],
      [500, 'UNAVAILABLE'],
    ] as const) {
      globalThis.fetch = async () =>
        new Response('private provider error with token', { status });
      await assert.rejects(
        adapter.request('https://example.test/provider'),
        (error: unknown) => {
          assert.ok(error instanceof SocialProviderError);
          assert.equal(error.category, category);
          assert.ok(!error.message.includes('private'));
          return true;
        },
      );
    }
    globalThis.fetch = async () => Response.json({ data: 'x'.repeat(70_000) });
    await assert.rejects(
      adapter.request('https://example.test/provider'),
      (error: unknown) =>
        error instanceof SocialProviderError && error.category === 'MALFORMED',
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('SYN-SOC-001 revoked Google refresh grant requires reauthorization', async () => {
  const oldFetch = globalThis.fetch;
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
  globalThis.fetch = async () =>
    new Response('private invalid_grant detail', { status: 400 });
  try {
    await assert.rejects(
      new SocialProviders().refreshGoogle('test-refresh'),
      (error: unknown) =>
        error instanceof SocialProviderError &&
        error.category === 'AUTH' &&
        !error.message.includes('private'),
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = id;
    if (secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = secret;
  }
});
