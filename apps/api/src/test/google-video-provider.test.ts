import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GoogleVideoProvider,
  VIDEO_MODEL,
} from '../ai/google-video-provider.js';
import { GoogleFailure } from '../ai/google-failure.js';

test('VID-004: Google Interactions start/get use one request each, no retry and safe errors', async () => {
  const previousKey = process.env.GOOGLE_API_KEY;
  const previousAccess = process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_API_KEY = 'test-only-not-a-key';
  process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED = 'true';
  let calls = 0,
    downloads = 0,
    mode = 'pending',
    body: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).origin === 'https://storage.googleapis.com') {
      assert.equal(request.headers.get('x-goog-api-key'), null);
      return new Response(Buffer.from('small video'));
    }
    const path = new URL(request.url).pathname;
    if (path.endsWith(':download')) {
      downloads++;
      if (mode === 'uri-redirect')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.example/video.mp4' },
        });
      if (mode === 'uri-allowed-redirect')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://storage.googleapis.com/safe.mp4' },
        });
      return new Response(Buffer.from('small video'), {
        headers: { 'content-type': 'video/mp4' },
      });
    }
    if (path.includes('/files/'))
      return Response.json({
        name: 'files/mock',
        state: 'ACTIVE',
        sizeBytes: mode === 'uri-oversize' ? '20971521' : '11',
      });
    calls++;
    if (request.method === 'POST') body = await request.clone().json();
    if (mode === 'timeout')
      throw new DOMException('Timed out with secret', 'AbortError');
    if (mode === 'rate')
      return Response.json(
        { error: { message: 'secret raw body' } },
        { status: 429 },
      );
    return Response.json(
      mode === 'pending'
        ? { id: 'mock-operation', model: VIDEO_MODEL, status: 'in_progress' }
        : mode.startsWith('uri')
          ? {
              id: 'mock-operation',
              model: VIDEO_MODEL,
              status: 'completed',
              output_video: {
                mime_type: 'video/mp4',
                uri:
                  mode === 'uri-foreign'
                    ? 'https://untrusted.example/v1beta/files/mock:download?alt=media'
                    : 'https://generativelanguage.googleapis.com/v1beta/files/mock:download?alt=media',
              },
            }
          : {
              id: 'mock-operation',
              model: VIDEO_MODEL,
              status: 'completed',
              output_video: {
                type: 'video',
                mime_type: 'video/mp4',
                data: Buffer.from('small video').toString('base64'),
              },
              usage: {
                total_input_tokens: 10,
                total_output_tokens: 100,
                output_tokens_by_modality: [{ modality: 'VIDEO', tokens: 90 }],
              },
            },
    );
  };
  try {
    const provider = new GoogleVideoProvider();
    assert.equal(provider.configured(), true);
    const request = {
      model: VIDEO_MODEL,
      prompt: 'Hypothetical scene',
      duration: '3s',
      aspectRatio: '9:16',
      resolution: '720p',
    };
    assert.deepEqual(await provider.start(request), {
      status: 'RUNNING',
      operationId: 'mock-operation',
    });
    assert.equal(calls, 1);
    assert.equal(body.model, VIDEO_MODEL);
    assert.equal(body.background, true);
    assert.equal(body.store, true);
    assert.deepEqual(body.response_format, {
      type: 'video',
      duration: '3s',
      aspect_ratio: '9:16',
      resolution: '720p',
      delivery: 'uri',
    });
    mode = 'uri';
    assert.deepEqual(await provider.start(request), {
      status: 'RUNNING',
      operationId: 'mock-operation',
    });
    assert.equal(calls, 2);
    const uriResult = await provider.retrieve('mock-operation');
    assert.equal(uriResult.status, 'SUCCEEDED');
    if (uriResult.status === 'SUCCEEDED')
      assert.equal(uriResult.bytes.toString(), 'small video');
    assert.equal(downloads, 1);
    for (const failure of ['uri-foreign', 'uri-oversize', 'uri-redirect']) {
      mode = failure;
      await assert.rejects(
        provider.retrieve('mock-operation'),
        (error) =>
          error instanceof GoogleFailure &&
          error.category === 'MALFORMED_RESPONSE',
      );
    }
    assert.equal(downloads, 2); // Only trusted, bounded file IDs reach download.
    mode = 'uri-allowed-redirect';
    const redirected = await provider.retrieve('mock-operation');
    assert.equal(redirected.status, 'SUCCEEDED');
    assert.equal(downloads, 3);
    mode = 'completed';
    const result = await provider.retrieve('mock-operation');
    assert.equal(result.status, 'SUCCEEDED');
    if (result.status === 'SUCCEEDED') {
      assert.equal(result.outputVideoTokens, 90);
      assert.equal(result.bytes.toString(), 'small video');
    }
    assert.equal(calls, 8);
    mode = 'rate';
    await assert.rejects(
      provider.start(request),
      (error) =>
        error instanceof GoogleFailure &&
        error.category === 'RATE_LIMIT' &&
        !error.message.includes('secret'),
    );
    assert.equal(calls, 9);
    mode = 'timeout';
    await assert.rejects(
      provider.start(request),
      (error) =>
        error instanceof GoogleFailure &&
        error.category === 'TIMEOUT' &&
        !error.message.includes('secret'),
    );
    assert.equal(calls, 10);
    await assert.rejects(
      provider.start({ ...request, duration: '20s' }),
      (error) =>
        error instanceof GoogleFailure &&
        error.category === 'UNSUPPORTED_REQUEST',
    );
    assert.equal(calls, 10);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousKey;
    if (previousAccess === undefined)
      delete process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED;
    else process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED = previousAccess;
  }
});
