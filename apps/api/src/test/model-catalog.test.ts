import { GoogleTextProvider } from '../ai/google-text-provider.js';
import { GoogleImageProvider } from '../ai/google-image-provider.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelCatalogService } from '../ai/providers/catalog.service.js';
import { OpenAITextProvider, MODEL } from '../ai/text-provider.js';
import { OpenAIImageProvider, IMAGE_MODEL } from '../ai/image-provider.js';

test('AIP-002: catalog derives availability without provider calls or leaking keys', () => {
  let configured = false;
  const text = {
    configured: () => configured,
    count: async () => {
      throw new Error('No network');
    },
    generate: async () => {
      throw new Error('No network');
    },
  };
  const image = {
    configured: () => configured,
    generate: async () => {
      throw new Error('No network');
    },
  };
  const catalog = new ModelCatalogService(
    text,
    image,
    new GoogleTextProvider(),
    new GoogleImageProvider(),
  );
  catalog.now = () => new Date('2026-10-27');
  const previous = process.env.MEDIA_STORAGE_ROOT;
  const google = process.env.GOOGLE_API_KEY;
  const eleven = process.env.ELEVENLABS_API_KEY;
  const imageAccess = process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED;
  try {
    delete process.env.GOOGLE_API_KEY;
    assert.equal(
      catalog.read().models.find((m) => m.model === 'gemini-3.8-flash')?.status,
      'NOT_CONFIGURED',
    );
    process.env.GOOGLE_API_KEY = 'test-only-not-a-real-key';
    process.env.ELEVENLABS_API_KEY = 'test-only-not-a-real-key';
    delete process.env.MEDIA_STORAGE_ROOT;
    let rows = catalog.read().models;
    assert.equal(rows.filter((m) => m.status === 'NOT_CONFIGURED').length, 4);
    assert.ok(
      rows
        .filter((m) => !m.implemented)
        .every((m) => m.status === 'PLANNED' && !m.configured),
    );
    configured = true;
    rows = catalog.read().models;
    assert.equal(rows[0]!.status, 'AVAILABLE');
    assert.equal(rows[2]!.status, 'NOT_CONFIGURED');
    process.env.MEDIA_STORAGE_ROOT = '/tmp/test-only-catalog';
    rows = catalog.read().models;
    assert.equal(rows.filter((m) => m.status === 'AVAILABLE').length, 3);
    assert.equal(
      rows.filter(
        (m) => m.provider === 'google' && m.capability === 'IMAGE_GENERATION',
      )[0]?.status,
      'NOT_CONFIGURED',
    );
    process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED = 'true';
    rows = catalog.read().models;
    assert.equal(rows.filter((m) => m.status === 'AVAILABLE').length, 5);
    assert.equal(rows[0]!.cost.capability, 'CONSERVATIVE_BOUND');
    assert.equal(rows[2]!.cost.capability, 'ESTIMATE_ONLY');
    assert.equal(
      rows.find(
        (m) => m.capability === 'IMAGE_EDITING' && m.provider === 'openai',
      )!.status,
      'PLANNED',
    );
    assert.ok(!JSON.stringify(rows).includes('test-only'));
    catalog.now = () => new Date('2026-11-25');
    assert.ok(
      catalog
        .read()
        .models.filter((m) => m.implemented)
        .every((m) => m.status === 'NOT_CONFIGURED'),
    );
  } finally {
    for (const [name, value] of [
      ['MEDIA_STORAGE_ROOT', previous],
      ['GOOGLE_IMAGE_PAID_TIER_CONFIRMED', imageAccess],
      ['GOOGLE_API_KEY', google],
      ['ELEVENLABS_API_KEY', eleven],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('AIP-003: SDK adapters reject wrong capability/model before network access', async () => {
  const text = new OpenAITextProvider();
  const image = new OpenAIImageProvider();
  for (const model of [IMAGE_MODEL, 'gemini-3.8-flash', 'unknown']) {
    await assert.rejects(
      text.count({ model, context: '{}', maxOutputTokens: 128 }),
      /Unsupported text model/,
    );
    await assert.rejects(
      text.generate({ model, context: '{}', maxOutputTokens: 128 }),
      /Unsupported text model/,
    );
  }
  for (const model of [MODEL, 'gemini-nano-banana-2.1', 'unknown'])
    await assert.rejects(
      image.generate({
        model,
        size: '1024x1024',
        quality: 'low',
        prompt: 'test',
      }),
      /Unsupported image/,
    );
  await assert.rejects(
    image.generate({
      model: IMAGE_MODEL,
      size: '1x1',
      quality: 'low',
      prompt: 'test',
    }),
    /Unsupported image/,
  );
});
