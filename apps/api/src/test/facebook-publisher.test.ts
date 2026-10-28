import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FacebookPublisher,
  FacebookPublishError,
} from '../social/facebook-publisher.js';
import { SocialProviders } from '../social/providers.js';

test('SYN-SOC-002 publishing scope is explicit and Facebook-only', () => {
  const old = {
    id: process.env.META_APP_ID,
    secret: process.env.META_APP_SECRET,
  };
  process.env.META_APP_ID = 'test-app';
  process.env.META_APP_SECRET = 'test-secret';
  try {
    const provider = new SocialProviders();
    const normal = new URL(provider.authorize('META', 'FACEBOOK', 'state'));
    const publishing = new URL(
      provider.authorize('META', 'FACEBOOK', 'state', undefined, true),
    );
    const instagram = new URL(provider.authorize('META', 'INSTAGRAM', 'state'));
    assert.ok(
      !normal.searchParams.get('scope')?.includes('pages_manage_posts'),
    );
    assert.ok(
      publishing.searchParams.get('scope')?.includes('pages_manage_posts'),
    );
    assert.equal(publishing.searchParams.get('auth_type'), 'rerequest');
    assert.ok(
      !instagram.searchParams.get('scope')?.includes('pages_manage_posts'),
    );
  } finally {
    if (old.id === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = old.id;
    if (old.secret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = old.secret;
  }
});

test('SYN-SOC-002 Meta adapter checks live grant and Page task without posting', async () => {
  const old = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.method ?? 'GET', 'GET');
    assert.ok(
      (init?.headers as Record<string, string>).Authorization?.startsWith(
        'Bearer ',
      ),
    );
    if (String(input).endsWith('/me/permissions'))
      return Response.json({
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_read_engagement', status: 'granted' },
          { permission: 'pages_manage_posts', status: 'granted' },
        ],
      });
    if (String(input).includes('/me/accounts'))
      return Response.json({
        data: [{ id: '12345', tasks: ['CREATE_CONTENT'] }],
      });
    return Response.json({ id: '12345' });
  };
  try {
    const result = await new FacebookPublisher().readiness(
      '12345',
      'user-token',
      'page-token',
    );
    assert.equal(result.eligible, true);
    assert.equal(calls.length, 3);
    assert.equal(
      (
        await new FacebookPublisher().readiness(
          '../bad',
          'user-token',
          'page-token',
        )
      ).eligible,
      false,
    );
    assert.equal(calls.length, 3);
    assert.equal(
      await new FacebookPublisher()
        .readiness('12345', '', 'page-token')
        .then((v) => v.reason),
      'REAUTHORIZE',
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('SYN-SOC-002 Meta adapter publishes once and sanitizes provider errors', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  try {
    const adapter = new FacebookPublisher();
    globalThis.fetch = async (input, init) => {
      calls++;
      assert.equal(
        String(input),
        'https://graph.facebook.com/v26.0/12345/feed',
      );
      assert.equal(init?.method, 'POST');
      assert.equal(
        (init?.body as URLSearchParams).get('message'),
        'Exact saved copy',
      );
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer page-secret',
      );
      return Response.json({ id: '12345_67890' });
    };
    assert.equal(
      await adapter.publish('12345', 'page-secret', 'Exact saved copy'),
      '12345_67890',
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
        new Response('raw secret provider response', { status });
      await assert.rejects(
        adapter.publish('12345', 'page-secret', 'Exact saved copy'),
        (error: unknown) =>
          error instanceof FacebookPublishError &&
          error.code === code &&
          error.uncertain === uncertain &&
          !error.message.includes('secret'),
      );
    }
    globalThis.fetch = async () => {
      throw new DOMException('timeout with secret', 'TimeoutError');
    };
    await assert.rejects(
      adapter.publish('12345', 'page-secret', 'Exact saved copy'),
      (error: unknown) =>
        error instanceof FacebookPublishError &&
        error.code === 'TIMEOUT' &&
        error.uncertain,
    );
    globalThis.fetch = async () => Response.json({ unexpected: 'private' });
    await assert.rejects(
      adapter.publish('12345', 'page-secret', 'Exact saved copy'),
      (error: unknown) =>
        error instanceof FacebookPublishError &&
        error.code === 'MALFORMED' &&
        error.uncertain,
    );
    await assert.rejects(
      adapter.publish('../other', 'page-secret', 'Exact saved copy'),
      (error: unknown) =>
        error instanceof FacebookPublishError && !error.uncertain,
    );
  } finally {
    globalThis.fetch = old;
  }
});

test('SYN-SOC-003 photo adapter sends one private multipart upload and requires a Page post ID', async () => {
  const old = globalThis.fetch;
  const adapter = new FacebookPublisher();
  const bytes = Buffer.from([137, 80, 78, 71]);
  let calls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      calls++;
      assert.equal(
        String(input),
        'https://graph.facebook.com/v26.0/12345/photos',
      );
      assert.equal(init?.method, 'POST');
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer page-secret',
      );
      const form = init?.body as FormData;
      assert.equal(form.get('caption'), 'Saved caption');
      assert.equal(form.get('published'), 'true');
      assert.deepEqual(
        Buffer.from(await (form.get('source') as Blob).arrayBuffer()),
        bytes,
      );
      return Response.json({ id: '9988', post_id: '12345_67890' });
    };
    assert.equal(
      await adapter.publishPhoto(
        '12345',
        'page-secret',
        'Saved caption',
        bytes,
        'image/png',
      ),
      '12345_67890',
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ id: '9988' });
    await assert.rejects(
      adapter.publishPhoto(
        '12345',
        'page-secret',
        'Saved caption',
        bytes,
        'image/png',
      ),
      (error: unknown) =>
        error instanceof FacebookPublishError &&
        error.code === 'MALFORMED' &&
        error.uncertain,
    );
    for (const [status, code, uncertain] of [
      [400, 'REJECTED', false],
      [401, 'AUTH', false],
      [403, 'PERMISSION', false],
      [429, 'RATE_LIMIT', false],
      [500, 'PROVIDER_ERROR', true],
    ] as const) {
      globalThis.fetch = async () =>
        new Response('private provider details', { status });
      await assert.rejects(
        adapter.publishPhoto(
          '12345',
          'page-secret',
          'Saved caption',
          bytes,
          'image/png',
        ),
        (error: unknown) =>
          error instanceof FacebookPublishError &&
          error.code === code &&
          error.uncertain === uncertain &&
          !error.message.includes('private'),
      );
    }
    globalThis.fetch = async () => {
      throw new DOMException('secret timeout', 'TimeoutError');
    };
    await assert.rejects(
      adapter.publishPhoto(
        '12345',
        'page-secret',
        'Saved caption',
        bytes,
        'image/png',
      ),
      (error: unknown) =>
        error instanceof FacebookPublishError &&
        error.code === 'TIMEOUT' &&
        error.uncertain &&
        !error.message.includes('secret'),
    );
  } finally {
    globalThis.fetch = old;
  }
});
