import type { AiModelDefinition } from '@synvaro/contracts';
import { MAX_NARRATION, SPEECH_MODEL } from '../elevenlabs-provider.js';
export const PRICING_EXPIRES = new Date('2026-11-25T00:00:00Z');
const verifiedAt = '2026-10-27';
const pricing = 'https://developers.openai.com/api/docs/pricing';
export const TEXT_MODEL = {
  provider: 'openai',
  model: 'gpt-6-luna',
  capability: 'TEXT_GENERATION',
  implemented: true,
  verifiedAt,
  reference: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
  cost: { capability: 'CONSERVATIVE_BOUND', reference: pricing },
  settings: {
    outputFormats: ['text/plain'],
    minOutputTokens: 128,
    maxOutputTokens: 2048,
  },
} as const satisfies AiModelDefinition;
export const GOOGLE_TEXT_MODEL = {
  provider: 'google',
  model: 'gemini-3.8-flash',
  capability: 'TEXT_GENERATION',
  implemented: true,
  verifiedAt,
  reference: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',
  cost: {
    capability: 'ESTIMATE_ONLY',
    reference: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  settings: {
    outputFormats: ['text/plain'],
    minOutputTokens: 128,
    maxOutputTokens: 2048,
  },
} as const satisfies AiModelDefinition;
export const IMAGE_MODEL_DEFINITION = {
  provider: 'openai',
  model: 'gpt-image-2.5-flare',
  capability: 'IMAGE_GENERATION',
  implemented: true,
  verifiedAt,
  reference:
    'https://developers.openai.com/api/docs/models/gpt-image-2.5-flare',
  cost: { capability: 'ESTIMATE_ONLY', reference: pricing },
  settings: {
    outputFormats: ['image/png'],
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
    qualities: ['low', 'medium', 'high'],
  },
} as const satisfies AiModelDefinition;
export const GOOGLE_IMAGE_MODEL = 'gemini-nano-banana-2.1';
export const GOOGLE_IMAGE_SIZES = ['1K'] as const;
export const GOOGLE_IMAGE_ASPECT_RATIOS = ['1:1', '4:5', '9:16'] as const;
// The Interactions API has no quality parameter; this is a UI/default marker.
export const GOOGLE_IMAGE_QUALITIES = ['default'] as const;
export const GOOGLE_IMAGE_PRICING_EXPIRES = new Date('2026-11-25T00:00:00Z');
const googleImageBase = {
  provider: 'google',
  model: GOOGLE_IMAGE_MODEL,
  implemented: true,
  verifiedAt,
  reference:
    'https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1',
  cost: {
    capability: 'ESTIMATE_ONLY',
    reference: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
} as const;
export const GOOGLE_IMAGE_GENERATION = {
  ...googleImageBase,
  capability: 'IMAGE_GENERATION',
  settings: {
    outputFormats: ['image/png'],
    sizes: GOOGLE_IMAGE_SIZES,
    qualities: GOOGLE_IMAGE_QUALITIES,
    aspectRatios: GOOGLE_IMAGE_ASPECT_RATIOS,
  },
} as const satisfies AiModelDefinition;
export const GOOGLE_IMAGE_EDITING = {
  ...googleImageBase,
  capability: 'IMAGE_EDITING',
  settings: {
    inputFormats: ['image/jpeg', 'image/png', 'image/webp'],
    outputFormats: ['image/png'],
    sizes: GOOGLE_IMAGE_SIZES,
    qualities: GOOGLE_IMAGE_QUALITIES,
    aspectRatios: GOOGLE_IMAGE_ASPECT_RATIOS,
  },
} as const satisfies AiModelDefinition;
const googleReference = 'https://ai.google.dev/gemini-api/docs/models';
const speechReference = 'https://elevenlabs.io/docs/overview/models';
export const MODEL_DEFINITIONS: readonly AiModelDefinition[] = [
  TEXT_MODEL,
  GOOGLE_TEXT_MODEL,
  IMAGE_MODEL_DEFINITION,
  GOOGLE_IMAGE_GENERATION,
  GOOGLE_IMAGE_EDITING,
  {
    provider: 'openai',
    model: IMAGE_MODEL_DEFINITION.model,
    verifiedAt,
    reference: IMAGE_MODEL_DEFINITION.reference,
    implemented: false,
    capability: 'IMAGE_EDITING',
    cost: { capability: 'UNAVAILABLE', reference: pricing },
  },
  ...(
    [
      ['gemini-omni-1.1-flash', 'VIDEO_GENERATION'],
      ['gemini-omni-1.1-flash', 'IMAGE_TO_VIDEO'],
    ] as const
  ).map(([model, capability]) => ({
    provider: 'google' as const,
    model,
    capability,
    implemented: false as const,
    verifiedAt,
    reference: googleReference,
    cost: { capability: 'UNAVAILABLE' as const, reference: googleReference },
  })),
  {
    provider: 'elevenlabs',
    model: SPEECH_MODEL,
    capability: 'SPEECH_GENERATION',
    implemented: true,
    verifiedAt,
    reference: speechReference,
    cost: {
      capability: 'ESTIMATE_ONLY',
      reference: 'https://elevenlabs.io/docs/api-reference/introduction',
    },
    settings: { outputFormats: ['audio/mpeg'], maxCharacters: MAX_NARRATION },
  },
];
