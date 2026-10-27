import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleImageProvider } from '../ai/google-image-provider.js';
import { GOOGLE_IMAGE_MODEL } from '../ai/providers/models.js';

test('IMG-G001/002: official Interactions SDK sends bounded single generation and edit requests without retries', async () => {
  const oldKey = process.env.GOOGLE_API_KEY;
  const oldAccess = process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_API_KEY = 'test-only-not-a-key';
  process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED = 'true';
  let calls = 0;
  let mode: 'success' | 'rate' | 'timeout' | 'malformed' = 'success';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input) => {
    calls++;
    requestBody = await (input as Request).clone().json();
    if (mode === 'rate')
      return Response.json(
        { error: { message: 'SECRET raw error' } },
        { status: 429 },
      );
    if (mode === 'timeout') throw new DOMException('Timed out', 'AbortError');
    return Response.json(
      mode === 'malformed'
        ? { id: 'bad', status: 'completed', model: GOOGLE_IMAGE_MODEL }
        : {
            id: 'test-interaction',
            status: 'completed',
            model: GOOGLE_IMAGE_MODEL,
            output_image: {
              type: 'image',
              mime_type: 'image/png',
              data: Buffer.from('test image bytes').toString('base64'),
            },
            usage: {
              total_input_tokens: 20,
              total_output_tokens: 1130,
              total_tokens: 1150,
              output_tokens_by_modality: [{ modality: 'IMAGE', tokens: 1120 }],
            },
          },
    );
  };
  try {
    const provider = new GoogleImageProvider();
    assert.equal(provider.configured(), true);
    const request = {
      model: GOOGLE_IMAGE_MODEL,
      size: '1K',
      quality: 'default',
      aspectRatio: '4:5',
      prompt: 'Hypothetical visual',
    };
    const result = await provider.generate(request);
    assert.equal(result.providerGenerationId, 'test-interaction');
    assert.equal(result.imageOutputTokens, 1120);
    assert.equal(requestBody.model, GOOGLE_IMAGE_MODEL);
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.background, false);
    assert.deepEqual(requestBody.response_format, {
      type: 'image',
      mime_type: 'image/png',
      image_size: '1K',
      aspect_ratio: '4:5',
    });
    assert.equal(requestBody.input, request.prompt);
    await provider.edit({
      ...request,
      source: Buffer.from('image source'),
      mimeType: 'image/png',
    });
    const parts = requestBody.input as unknown as {
      type: string;
      data?: string;
    }[];
    assert.equal(parts[0]?.type, 'text');
    assert.equal(parts[1]?.type, 'image');
    assert.equal(
      parts[1]?.data,
      Buffer.from('image source').toString('base64'),
    );
    mode = 'rate';
    const before = calls;
    await assert.rejects(provider.generate(request));
    assert.equal(calls, before + 1);
    mode = 'timeout';
    const beforeTimeout = calls;
    await assert.rejects(provider.generate(request));
    assert.equal(calls, beforeTimeout + 1);
    mode = 'malformed';
    await assert.rejects(
      provider.generate(request),
      /Invalid Google image response/,
    );
    const after = calls;
    await assert.rejects(
      provider.generate({ ...request, size: '4K' }),
      /Unsupported Google image settings/,
    );
    assert.equal(calls, after);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = oldKey;
    if (oldAccess === undefined)
      delete process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED;
    else process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED = oldAccess;
  }
});
