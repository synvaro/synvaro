// Test-only executable, never imported by main.ts. No production mock-provider flag.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { AiService } from '../ai/ai.service.js';
import { OpenAITextProvider } from '../ai/text-provider.js';
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'));
const app = await createApp();
app.get(AiService).now = () => new Date('2026-10-26T16:00:00Z');
const provider = app.get(OpenAITextProvider);
provider.configured = () => true;
provider.count = async () => 100;
let sequence = 0;
provider.generate = async (request) => ({
  text: `Hypothetical example ${++sequence} for ${JSON.parse(request.context).brand.name}. This is a test-provider suggestion, not a claim about released capabilities.`,
  model: request.model,
  inputTokens: 100,
  outputTokens: 50,
});
const { ImageService } = await import('../ai/image.service.js');
const { OpenAIImageProvider } = await import('../ai/image-provider.js');
const { default: sharp } = await import('sharp');
const imageClockStart = Date.now();
app.get(ImageService).now = () =>
  new Date(
    new Date('2026-10-26T16:00:00Z').getTime() + Date.now() - imageClockStart,
  );
const imageProvider = app.get(OpenAIImageProvider);
imageProvider.configured = () => true;
imageProvider.generate = async (request) => {
  const [width, height] = request.size.split('x').map(Number);
  return {
    bytes: await sharp({
      create: {
        width: width!,
        height: height!,
        channels: 3,
        background: '#225588',
      },
    })
      .png()
      .toBuffer(),
    inputTextTokens: 100,
    inputImageTokens: 0,
    outputTokens: 200,
  };
};
// Deterministic Gemini adapter for local/CI browser and smoke acceptance only.
const { GoogleTextProvider } = await import('../ai/google-text-provider.js');
const google = app.get(GoogleTextProvider);
google.configured = () => true;
google.count = async () => 100;
google.generate = async (request) => ({
  text: 'Hypothetical Google test-provider suggestion; no released claims.',
  model: request.model,
  inputTokens: 100,
  outputTokens: 50,
});
const { GoogleImageProvider } = await import('../ai/google-image-provider.js');
const googleImage = app.get(GoogleImageProvider);
googleImage.configured = () => true;
let imageSequence = 0;
const previewImage = async (request: { aspectRatio?: string }) => {
  const [width, height] =
    request.aspectRatio === '4:5'
      ? [928, 1152]
      : request.aspectRatio === '9:16'
        ? [768, 1376]
        : [1024, 1024];
  return {
    bytes: await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: imageSequence++ % 2 ? '#6d8f66' : '#b58a62',
      },
    })
      .png()
      .toBuffer(),
    providerGenerationId: `mock-google-image-${imageSequence}`,
    inputTextTokens: 100,
    inputImageTokens: 0,
    outputTokens: 1120,
    imageOutputTokens: 1120,
  };
};
googleImage.generate = previewImage;
googleImage.edit = previewImage;

// Local acceptance uses a generated tone, not a paid ElevenLabs request.
const { ElevenLabsProvider } = await import('../ai/elevenlabs-provider.js');
const voice = app.get(ElevenLabsProvider);
voice.configured = () => true;
voice.voices = async () => [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Premade test voice', languages: ['tr'] },
];
voice.generate = async (request) => ({
  bytes: execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.5',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-f',
    'mp3',
    'pipe:1',
  ]),
  mimeType: 'audio/mpeg',
  model: request.model,
  characterCost: [...request.text].length,
  providerGenerationId: 'mock-elevenlabs-voice',
});

const config = loadConfig();
await app.listen(config.port, config.host);
