import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAIImageProvider,
  IMAGE_MODEL,
  boundedImageFetch,
} from '../ai/image-provider.js';

test('IMG-006: official SDK Images API wire contract, bounded response and no retries', async () => {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-placeholder-not-a-real-key';
  let calls = 0;
  const request = {
    model: IMAGE_MODEL,
    size: '1024x1024' as const,
    quality: 'low' as const,
    prompt: 'Hypothetical illustration',
  };
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.openai.com/v1/images/generations');
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        model: IMAGE_MODEL,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        n: 1,
        output_format: 'png',
        background: 'opaque',
        moderation: 'auto',
      });
      return Response.json({
        created: 1,
        data: [{ b64_json: Buffer.from('provider-bytes').toString('base64') }],
        usage: {
          input_tokens: 10,
          input_tokens_details: { text_tokens: 10, image_tokens: 0 },
          output_tokens: 20,
          total_tokens: 30,
        },
      });
    };
    const result = await new OpenAIImageProvider().generate(request);
    assert.equal(result.bytes.toString(), 'provider-bytes');
    assert.equal(result.inputTextTokens, 10);
    assert.equal(result.outputTokens, 20);
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      return Response.json(
        { error: { message: 'sensitive provider detail' } },
        { status: 429 },
      );
    };
    await assert.rejects(new OpenAIImageProvider().generate(request));
    assert.equal(calls, 2);
    globalThis.fetch = async () =>
      Response.json({ data: [{ url: 'https://untrusted.invalid/image.png' }] });
    await assert.rejects(new OpenAIImageProvider().generate(request));
    globalThis.fetch = async () =>
      Response.json({ data: [{ b64_json: 'bad===data' }] });
    await assert.rejects(new OpenAIImageProvider().generate(request));
    globalThis.fetch = async () =>
      Response.json({
        data: [{ b64_json: Buffer.from('bytes').toString('base64') }],
        usage: {
          input_tokens: 10,
          input_tokens_details: { text_tokens: 10, image_tokens: 0 },
          output_tokens: 20,
          total_tokens: 30,
          output_tokens_details: { text_tokens: 5, image_tokens: 15 },
        },
      });
    const unsupportedUsage = await new OpenAIImageProvider().generate(request);
    assert.equal(unsupportedUsage.outputTokens, undefined);
    let cancelled = false;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    await assert.rejects(
      boundedImageFetch('https://api.openai.com/v1/images/generations'),
      /too large/,
    );
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
