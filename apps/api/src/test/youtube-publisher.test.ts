import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { SocialProviders } from '../social/providers.js';
import {
  YouTubePublisher,
  YouTubePublishError,
  validateYouTubeSession,
} from '../social/youtube-publisher.js';

const channel = 'UCabcdefgh12345678901234';
const video = 'abcdefghijk';
const session =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=mockupload123&part=snippet%2Cstatus';

test('YTP-001 explicit YouTube-only upload OAuth and PKCE', () => {
  const before = {
    id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
  try {
    const provider = new SocialProviders();
    const ordinary = new URL(
      provider.authorize('GOOGLE', 'YOUTUBE', 'state', 'verifier'),
    );
    const publish = new URL(
      provider.authorize('GOOGLE', 'YOUTUBE', 'state', 'verifier', true),
    );
    assert.equal(
      ordinary.searchParams.get('scope'),
      'https://www.googleapis.com/auth/youtube.readonly',
    );
    assert.equal(
      publish.searchParams.get('scope'),
      'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
    );
    assert.equal(publish.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(publish.searchParams.get('access_type'), 'offline');
  } finally {
    for (const [key, value] of Object.entries({
      GOOGLE_OAUTH_CLIENT_ID: before.id,
      GOOGLE_OAUTH_CLIENT_SECRET: before.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('YTP-005 fixed resumable Location, 308/probe and final ID', async () => {
  assert.equal(validateYouTubeSession(session), session);
  for (const bad of [
    'http://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=mockupload123',
    'https://evil.example/upload/youtube/v3/videos?uploadType=resumable&upload_id=mockupload123',
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=mockupload123&redirect=https://evil.example',
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=mockupload123&upload_id=another123',
  ])
    assert.throws(() => validateYouTubeSession(bad), YouTubePublishError);
  const old = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      calls++;
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      assert.ok(headers.Authorization?.startsWith('Bearer '));
      if (calls === 1) {
        assert.equal(
          url,
          'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50',
        );
        return Response.json({ items: [{ id: channel }] });
      }
      if (calls === 2) {
        assert.ok(url.includes('uploadType=resumable&part=snippet,status'));
        assert.equal(init?.method, 'POST');
        assert.equal(headers['X-Upload-Content-Length'], '3');
        const body = JSON.parse(String(init?.body)) as {
          status: { privacyStatus: string };
        };
        assert.equal(body.status.privacyStatus, 'private');
        return new Response(null, {
          status: 200,
          headers: { location: session },
        });
      }
      if (calls === 3) {
        assert.equal(headers['Content-Range'], 'bytes 0-1/3');
        assert.deepEqual(
          Buffer.concat(
            (await (init!.body as unknown as Readable).toArray()) as Buffer[],
          ),
          Buffer.from([1, 2]),
        );
        return new Response(null, {
          status: 308,
          headers: { range: 'bytes=0-1' },
        });
      }
      if (calls === 4) {
        assert.equal(headers['Content-Range'], 'bytes */3');
        return new Response(null, {
          status: 308,
          headers: { range: 'bytes=0-1' },
        });
      }
      if (calls === 5) {
        assert.equal(headers['Content-Range'], 'bytes 2-2/3');
        return Response.json({ id: video }, { status: 201 });
      }
      assert.equal(
        url,
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=${video}`,
      );
      return Response.json({
        items: [
          {
            id: video,
            snippet: { channelId: channel },
            status: { privacyStatus: 'private' },
            processingDetails: { processingStatus: 'succeeded' },
          },
        ],
      });
    };
    const adapter = new YouTubePublisher();
    assert.equal(await adapter.readiness(channel, 'token'), true);
    assert.equal(
      await adapter.initiate(
        'token',
        {
          title: 'Exact title',
          description: 'Saved description',
          privacy: 'private',
        },
        3,
      ),
      session,
    );
    assert.deepEqual(
      await adapter.upload(
        session,
        'token',
        Readable.from([Buffer.from([1, 2])]),
        0,
        1,
        3,
      ),
      { kind: 'INCOMPLETE', offset: 2 },
    );
    assert.deepEqual(await adapter.probe(session, 'token', 3), {
      kind: 'INCOMPLETE',
      offset: 2,
    });
    assert.deepEqual(
      await adapter.upload(
        session,
        'token',
        Readable.from([Buffer.from([3])]),
        2,
        2,
        3,
      ),
      { kind: 'COMPLETE', videoId: video },
    );
    assert.equal(
      await adapter.verify(video, channel, 'private', 'token'),
      'succeeded',
    );
    assert.equal(calls, 6);
  } finally {
    globalThis.fetch = old;
  }
});

test('YTP-005/009 provider errors, timeout, malformed ranges and secret sanitization', async () => {
  const old = globalThis.fetch;
  const adapter = new YouTubePublisher();
  try {
    for (const [status, category] of [
      [400, 'REJECTED'],
      [401, 'AUTH'],
      [403, 'PERMISSION'],
      [404, 'EXPIRED'],
      [429, 'RATE_LIMIT'],
      [500, 'PROVIDER_ERROR'],
    ] as const) {
      globalThis.fetch = async () =>
        new Response('secret raw provider body', { status });
      await assert.rejects(
        adapter.probe(session, 'private-token', 3),
        (error: unknown) =>
          error instanceof YouTubePublishError &&
          error.category === category &&
          !error.message.includes('secret'),
      );
    }
    globalThis.fetch = async () =>
      new Response(null, { status: 308, headers: { range: 'bytes=1-2' } });
    await assert.rejects(
      adapter.probe(session, 'token', 3),
      (error: unknown) =>
        error instanceof YouTubePublishError && error.category === 'MALFORMED',
    );
    globalThis.fetch = async () => {
      throw new DOMException('secret timeout', 'TimeoutError');
    };
    await assert.rejects(
      adapter.initiate(
        'token',
        { title: 'T', description: '', privacy: 'private' },
        3,
      ),
      (error: unknown) =>
        error instanceof YouTubePublishError &&
        error.category === 'TIMEOUT' &&
        error.uncertain,
    );
  } finally {
    globalThis.fetch = old;
  }
});
