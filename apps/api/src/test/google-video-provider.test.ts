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
    mode = 'pending',
    body: Record<string, unknown> = {};
  globalThis.fetch = async (input) => {
    calls++;
    if ((input as Request).method === 'POST')
      body = await (input as Request).clone().json();
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
        : mode === 'uri'
          ? {
              id: 'mock-operation',
              model: VIDEO_MODEL,
              status: 'completed',
              output_video: {
                mime_type: 'video/mp4',
                uri: 'https://generativelanguage.googleapis.com/v1beta/files/mock:download?alt=media',
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
    mode = 'completed';
    const result = await provider.retrieve('mock-operation');
    assert.equal(result.status, 'SUCCEEDED');
    if (result.status === 'SUCCEEDED') {
      assert.equal(result.outputVideoTokens, 90);
      assert.equal(result.bytes.toString(), 'small video');
    }
    assert.equal(calls, 3);
    mode = 'rate';
    await assert.rejects(
      provider.start(request),
      (error) =>
        error instanceof GoogleFailure &&
        error.category === 'RATE_LIMIT' &&
        !error.message.includes('secret'),
    );
    assert.equal(calls, 4);
    mode = 'timeout';
    await assert.rejects(
      provider.start(request),
      (error) =>
        error instanceof GoogleFailure &&
        error.category === 'TIMEOUT' &&
        !error.message.includes('secret'),
    );
    assert.equal(calls, 5);
    await assert.rejects(
      provider.start({ ...request, duration: '20s' }),
      (error) =>
        error instanceof GoogleFailure &&
        error.category === 'UNSUPPORTED_REQUEST',
    );
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousKey;
    if (previousAccess === undefined)
      delete process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED;
    else process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED = previousAccess;
  }
});
