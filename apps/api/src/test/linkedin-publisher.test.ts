import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialProviders } from '../social/providers.js';
import {
  LinkedInPublisher,
  LinkedInPublishError,
  LINKEDIN_VERSION,
  escapeLinkedInText,
} from '../social/linkedin-publisher.js';

test('LIP-001 publishing authorization requests w_member_social only explicitly', () => {
  const previous = {
    id: process.env.LINKEDIN_CLIENT_ID,
    secret: process.env.LINKEDIN_CLIENT_SECRET,
  };
  process.env.LINKEDIN_CLIENT_ID = 'local-app';
  process.env.LINKEDIN_CLIENT_SECRET = 'local-secret';
  try {
    const provider = new SocialProviders();
    const ordinary = new URL(
      provider.authorize('LINKEDIN', 'LINKEDIN', 'state'),
    );
    const publishing = new URL(
      provider.authorize('LINKEDIN', 'LINKEDIN', 'state', undefined, true),
    );
    assert.equal(ordinary.searchParams.get('scope'), 'openid profile');
    assert.equal(
      publishing.searchParams.get('scope'),
      'openid profile w_member_social',
    );
  } finally {
    if (previous.id === undefined) delete process.env.LINKEDIN_CLIENT_ID;
    else process.env.LINKEDIN_CLIENT_ID = previous.id;
    if (previous.secret === undefined)
      delete process.env.LINKEDIN_CLIENT_SECRET;
    else process.env.LINKEDIN_CLIENT_SECRET = previous.secret;
  }
});

test('LIP-005 versioned member text post sends once and validates post URN', async () => {
  assert.equal(escapeLinkedInText('Sale #1 *today*'), 'Sale \\#1 \\*today\\*');
  const old = globalThis.fetch;
  const adapter = new LinkedInPublisher();
  let calls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      calls++;
      assert.equal(String(input), 'https://api.linkedin.com/rest/posts');
      assert.equal(init?.method, 'POST');
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers['Linkedin-Version'], LINKEDIN_VERSION);
      assert.equal(headers['X-Restli-Protocol-Version'], '2.0.0');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.author, 'urn:li:person:member123');
      assert.equal(body.commentary, 'Exact saved copy');
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:123456789' },
      });
    };
    assert.equal(
      await adapter.publish(
        'urn:li:person:member123',
        'private-token',
        'Exact saved copy',
      ),
      'urn:li:share:123456789',
    );
    assert.equal(calls, 1);
    for (const [status, code, uncertain] of [
      [400, 'REJECTED', false],
      [401, 'AUTH', false],
      [403, 'PERMISSION', false],
      [429, 'RATE_LIMIT', false],
      [500, 'PROVIDER_ERROR', true],
    ] as const) {
      globalThis.fetch = async () =>
        new Response('private raw error', { status });
      await assert.rejects(
        adapter.publish('urn:li:person:member123', 'private-token', 'text'),
        (error: unknown) =>
          error instanceof LinkedInPublishError &&
          error.code === code &&
          error.uncertain === uncertain &&
          !error.message.includes('private'),
      );
    }
    globalThis.fetch = async () => {
      throw new DOMException('secret timeout', 'TimeoutError');
    };
    await assert.rejects(
      adapter.publish('urn:li:person:member123', 'private-token', 'text'),
      (error: unknown) =>
        error instanceof LinkedInPublishError &&
        error.code === 'TIMEOUT' &&
        error.uncertain,
    );
    await assert.rejects(
      adapter.publish('urn:li:organization:other', 'private-token', 'text'),
      (error: unknown) =>
        error instanceof LinkedInPublishError &&
        error.code === 'MALFORMED' &&
        !error.uncertain,
    );
    globalThis.fetch = async () =>
      new Response(null, { status: 201, headers: { 'x-restli-id': 'bad-id' } });
    await assert.rejects(
      adapter.publish('urn:li:person:member123', 'private-token', 'text'),
      (error: unknown) =>
        error instanceof LinkedInPublishError &&
        error.code === 'MALFORMED' &&
        error.uncertain,
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('LIP-005 image initialize, bounded approved upload host, readiness and image post', async () => {
  const old = globalThis.fetch;
  const adapter = new LinkedInPublisher();
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('initializeUpload'))
        return Response.json({
          value: {
            image: 'urn:li:image:asset123',
            uploadUrl:
              'https://www.linkedin.com/dms-uploads/asset123/upload?signature=x',
          },
        });
      if (url.includes('/dms-uploads/')) {
        assert.equal(init?.method, 'PUT');
        assert.deepEqual(
          Buffer.from(init?.body as Uint8Array),
          Buffer.from([1, 2, 3]),
        );
        return new Response(null, { status: 201 });
      }
      if (url.includes('/rest/images/'))
        return Response.json({
          id: 'urn:li:image:asset123',
          owner: 'urn:li:person:member123',
          status: 'AVAILABLE',
        });
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:ugcPost:987654321' },
      });
    };
    const image = await adapter.initializeImage(
      'urn:li:person:member123',
      'token',
    );
    await adapter.uploadImage(
      image.url,
      'token',
      Buffer.from([1, 2, 3]),
      'image/png',
    );
    await adapter.imageReady(image.urn, 'token', 'urn:li:person:member123');
    assert.equal(
      await adapter.publish(
        'urn:li:person:member123',
        'token',
        'text',
        image.urn,
      ),
      'urn:li:ugcPost:987654321',
    );
    assert.equal(
      calls.filter((call) =>
        call.startsWith('POST https://api.linkedin.com/rest/posts'),
      ).length,
      1,
    );
    await assert.rejects(
      adapter.uploadImage(
        'https://evil.example/dms-uploads/x',
        'token',
        Buffer.from([1]),
        'image/png',
      ),
      (error: unknown) =>
        error instanceof LinkedInPublishError && error.code === 'MALFORMED',
    );
    assert.equal(calls.length, 4);
    globalThis.fetch = async () =>
      Response.json({
        value: {
          image: 'urn:li:image:asset123',
          uploadUrl: 'https://evil.example/dms-uploads/x',
        },
      });
    await assert.rejects(
      adapter.initializeImage('urn:li:person:member123', 'token'),
      (error: unknown) =>
        error instanceof LinkedInPublishError && error.code === 'MALFORMED',
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('LIP-001/005 wrong member and write-only image read fail safely', async () => {
  const old = globalThis.fetch;
  const adapter = new LinkedInPublisher();
  let reads = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      reads++;
      if (reads === 1) return Response.json({ sub: 'other-member' });
      assert.equal(
        (init?.headers as Record<string, string>)['Linkedin-Version'],
        undefined,
      );
      return Response.json({
        id: 'urn:li:image:asset',
        owner: 'urn:li:person:member',
        status: 'AVAILABLE',
      });
    };
    assert.equal((await adapter.readiness('member', 'token')).eligible, false);
    globalThis.fetch = async (_input, init) => {
      if ((init?.headers as Record<string, string>)['Linkedin-Version'])
        return new Response('private error', { status: 403 });
      return Response.json({
        id: 'urn:li:image:asset',
        owner: 'urn:li:person:member',
        status: 'AVAILABLE',
      });
    };
    await adapter.imageReady(
      'urn:li:image:asset',
      'token',
      'urn:li:person:member',
    );
    globalThis.fetch = async () =>
      new Response('private error', { status: 403 });
    await assert.rejects(
      adapter.imageReady('urn:li:image:asset', 'token', 'urn:li:person:member'),
      (error: unknown) =>
        error instanceof LinkedInPublishError &&
        error.code === 'PERMISSION' &&
        !error.uncertain,
    );
  } finally {
    globalThis.fetch = old;
  }
});
