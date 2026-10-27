import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleTextProvider } from '../ai/google-text-provider.js';
import { INSTRUCTIONS } from '../ai/text-provider.js';

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
