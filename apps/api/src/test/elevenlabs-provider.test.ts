import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ElevenLabsProvider,
  ElevenFailure,
  SPEECH_MODEL,
  SPEECH_FORMAT,
} from '../ai/elevenlabs-provider.js';

test('VOC-002/005: official HTTP shape, premade voice filter, bounded MP3 and one-call failures', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'test-only-not-a-key';
  const id = 'JBFqnCBsd6RMkjVDRZzb';
  let calls = 0;
  let mode: 'ok' | 'rate' | 'timeout' | 'oversize' = 'ok';
  const mp3 = Buffer.alloc(150, 1);
  mp3.write('ID3', 0, 'ascii');
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.ok(String(input).startsWith('https://api.elevenlabs.io/'));
    assert.equal(
      (init?.headers as Record<string, string>)['xi-api-key'],
      'test-only-not-a-key',
    );
    if (String(input).includes('/v2/voices'))
      return Response.json({
        voices: [
          {
            voice_id: id,
            name: 'Premade test',
            category: 'premade',
            verified_languages: [{ language: 'tr', model_id: SPEECH_MODEL }],
          },
          {
            voice_id: 'abcdefghijklmnopqrst',
            name: 'Cloned',
            category: 'cloned',
          },
        ],
        has_more: false,
      });
    assert.equal(init?.method, 'POST');
    assert.equal(JSON.parse(String(init?.body)).model_id, SPEECH_MODEL);
    if (mode === 'rate')
      return Response.json({ detail: 'secret' }, { status: 429 });
    if (mode === 'timeout') throw new DOMException('Timeout', 'AbortError');
    if (mode === 'oversize')
      return new Response(Buffer.alloc(5 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'audio/mpeg' },
      });
    return new Response(mp3, {
      headers: {
        'content-type': 'audio/mpeg',
        'character-cost': '13',
        'request-id': 'request-test-1',
      },
    });
  };
  try {
    const provider = new ElevenLabsProvider();
    assert.deepEqual(await provider.voices(), [
      { id, name: 'Premade test', languages: ['tr'] },
    ]);
    const input = {
      model: SPEECH_MODEL,
      text: 'Merhaba dünya',
      voiceId: id,
      format: SPEECH_FORMAT,
    };
    const output = await provider.generate(input);
    assert.deepEqual(Buffer.from(output.bytes), mp3);
    assert.equal(output.characterCost, 13);
    assert.equal(output.providerGenerationId, 'request-test-1');
    for (const [state, category] of [
      ['rate', 'RATE_LIMIT'],
      ['timeout', 'TIMEOUT'],
      ['oversize', 'MALFORMED_RESPONSE'],
    ] as const) {
      mode = state;
      const before = calls;
      await assert.rejects(
        provider.generate(input),
        (error) =>
          error instanceof ElevenFailure && error.category === category,
      );
      assert.equal(calls, before + 1);
    }
    const before = calls;
    await assert.rejects(
      provider.generate({ ...input, model: 'wrong' }),
      (error) =>
        error instanceof ElevenFailure && error.category === 'INVALID_REQUEST',
    );
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = oldKey;
  }
});
