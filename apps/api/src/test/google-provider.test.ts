import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleTextProvider } from '../ai/google-text-provider.js';
import { INSTRUCTIONS } from '../ai/text-provider.js';
import { classifyGoogleFailure, GoogleFailure } from '../ai/google-failure.js';
import { ApiError } from '@google/genai';

test('AIG-G002: Google SDK wire contract, thinking usage, malformed usage and no retries', async () => {
  const previous = process.env.GOOGLE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_API_KEY = 'test-only-not-a-key';
  let calls = 0;
  let mode = 'success';
  let observed: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    calls++;
    observed = JSON.parse(String(init?.body));
    if (mode === 'failure')
      return new Response('{}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    if (String(_url).includes(':countTokens'))
      return Response.json({ totalTokens: 100 });
    return Response.json({
      modelVersion: 'gemini-3.8-flash',
      candidates: [
        {
          finishReason: 'STOP',
          content: { role: 'model', parts: [{ text: 'Hypothetical output' }] },
        },
      ],
      usageMetadata:
        mode === 'missing'
          ? { promptTokenCount: 100 }
          : {
              promptTokenCount: 100,
              candidatesTokenCount: 40,
              thoughtsTokenCount: 10,
              totalTokenCount: 150,
            },
    });
  };
  try {
    const provider = new GoogleTextProvider();
    const request = {
      model: 'gemini-3.8-flash',
      context: '{"brand":"Hypothetical"}',
      maxOutputTokens: 512,
    };
    assert.equal(await provider.count(request), 100);
    assert.ok(JSON.stringify(observed).includes(INSTRUCTIONS));
    assert.ok('generateContentRequest' in observed);
    assert.ok(!('contents' in observed));
    const result = await provider.generate(request);
    assert.equal(result.text, 'Hypothetical output');
    assert.equal(result.inputTokens, 100);
    assert.equal(result.outputTokens, 50);
    assert.equal(
      (observed.generationConfig as Record<string, unknown>).maxOutputTokens,
      512,
    );
    assert.equal(
      (
        (observed.generationConfig as Record<string, unknown>)
          .thinkingConfig as Record<string, unknown>
      ).thinkingLevel,
      'LOW',
    );
    mode = 'missing';
    assert.equal((await provider.generate(request)).outputTokens, undefined);
    mode = 'failure';
    const before = calls;
    await assert.rejects(provider.generate(request));
    assert.equal(calls, before + 1);
    await assert.rejects(
      provider.generate({ ...request, model: 'unknown' }),
      /Unsupported text model/,
    );
    assert.equal(calls, before + 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previous;
  }
});

test('AIG-G002: classified Google errors contain only bounded diagnostics', () => {
  for (const [status, category] of [
    [401, 'AUTHENTICATION'],
    [403, 'PERMISSION'],
    [400, 'UNSUPPORTED_REQUEST'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER_ERROR'],
    [504, 'TIMEOUT'],
  ] as const) {
    const error = classifyGoogleFailure(
      new ApiError({ status, message: 'SECRET raw provider response' }),
      'generate',
      123,
    );
    assert.deepEqual(
      [error.category, error.phase, error.elapsedMs, error.httpStatus],
      [category, 'generate', 123, status],
    );
    assert.ok(!JSON.stringify(error).includes('SECRET'));
  }
  assert.equal(
    classifyGoogleFailure(
      new DOMException('SECRET request body', 'AbortError'),
      'generate',
      60_000,
    ).category,
    'TIMEOUT',
  );
});

test('AIG-G002: delayed response succeeds, SDK timeout stops once and malformed output is classified', async () => {
  const previous = process.env.GOOGLE_API_KEY;
  const originalFetch = globalThis.fetch;
  const timeout = GoogleTextProvider.GENERATE_TIMEOUT_MS;
  process.env.GOOGLE_API_KEY = 'test-only-not-a-key';
  Object.defineProperty(GoogleTextProvider, 'GENERATE_TIMEOUT_MS', {
    value: 35,
    configurable: true,
  });
  let calls = 0;
  let mode: 'delayed' | 'timeout' | 'malformed' = 'delayed';
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (mode === 'timeout')
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('SECRET', 'AbortError'));
        });
      });
    if (mode === 'delayed')
      await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json(
      mode === 'malformed'
        ? { candidates: [] }
        : {
            modelVersion: 'gemini-3.8-flash',
            candidates: [
              { finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
            },
          },
    );
  };
  try {
    const provider = new GoogleTextProvider();
    const request = {
      model: 'gemini-3.8-flash',
      context: 'test',
      maxOutputTokens: 512,
    };
    assert.equal((await provider.generate(request)).text, 'ok');
    mode = 'timeout';
    const before = calls;
    const keepAlive = setTimeout(() => {}, 100);
    await assert.rejects(provider.generate(request), (error) => {
      assert.ok(error instanceof GoogleFailure);
      assert.equal(error.category, 'TIMEOUT');
      assert.equal(error.phase, 'generate');
      assert.ok(error.elapsedMs >= 20);
      assert.ok(!error.message.includes('SECRET'));
      return true;
    });
    clearTimeout(keepAlive);
    assert.equal(calls, before + 1);
    mode = 'malformed';
    await assert.rejects(provider.generate(request), (error) => {
      assert.ok(error instanceof GoogleFailure);
      assert.equal(error.category, 'MALFORMED_RESPONSE');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(GoogleTextProvider, 'GENERATE_TIMEOUT_MS', {
      value: timeout,
      configurable: true,
    });
    if (previous === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previous;
  }
});
