import { GoogleTextProvider } from '../google-text-provider.js';
import { GoogleImageProvider } from '../google-image-provider.js';
import { ElevenLabsProvider } from '../elevenlabs-provider.js';
import {
  GoogleVideoProvider,
  VIDEO_MODEL,
  VIDEO_PRICING_EXPIRES,
} from '../google-video-provider.js';
import { GOOGLE_TEXT_MODEL } from './models.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AiModelCatalog } from '@synvaro/contracts';
import {
  TEXT_PROVIDER,
  IMAGE_PROVIDER,
  type TextProvider,
  type ImageProvider,
} from './contracts.js';
import {
  GOOGLE_IMAGE_MODEL,
  GOOGLE_IMAGE_PRICING_EXPIRES,
  MODEL_DEFINITIONS,
  PRICING_EXPIRES,
} from './models.js';
@Injectable()
export class ModelCatalogService {
  now = () => new Date();
  constructor(
    @Inject(TEXT_PROVIDER) private readonly text: TextProvider,
    @Inject(IMAGE_PROVIDER) private readonly image: ImageProvider,
    private readonly google: GoogleTextProvider,
    private readonly googleImage: GoogleImageProvider,
    private readonly speech: ElevenLabsProvider,
    private readonly video: GoogleVideoProvider,
  ) {}
  read(): AiModelCatalog {
    return {
      models: MODEL_DEFINITIONS.map((model) => {
        // No credential probing for reference-only integrations.
        if (!model.implemented)
          return {
            ...model,
            status: 'PLANNED',
            configured: false,
            unavailableReason: 'Integration not implemented.',
          };
        const adapter =
          model.capability === 'VIDEO_GENERATION' ||
          model.capability === 'IMAGE_TO_VIDEO'
            ? this.video
            : model.capability === 'SPEECH_GENERATION'
              ? this.speech
              : model.capability === 'TEXT_GENERATION'
                ? model.model === GOOGLE_TEXT_MODEL.model
                  ? this.google
                  : this.text
                : model.model === GOOGLE_IMAGE_MODEL
                  ? this.googleImage
                  : this.image;
        const reason = !adapter.configured()
          ? model.model === VIDEO_MODEL
            ? 'Google video access requires a server key and confirmed paid-tier model access.'
            : model.model === GOOGLE_IMAGE_MODEL
              ? 'Google image access requires a server key and confirmed paid-tier model access.'
              : 'Server API key is not configured.'
          : (model.capability === 'VIDEO_GENERATION' ||
                model.capability === 'IMAGE_TO_VIDEO' ||
                model.capability === 'IMAGE_GENERATION' ||
                model.capability === 'IMAGE_EDITING' ||
                model.capability === 'SPEECH_GENERATION') &&
              !process.env.MEDIA_STORAGE_ROOT?.trim()
            ? 'Private media storage is not configured.'
            : model.capability !== 'SPEECH_GENERATION' &&
                this.now() >=
                  (model.model === VIDEO_MODEL
                    ? VIDEO_PRICING_EXPIRES
                    : model.model === GOOGLE_IMAGE_MODEL
                      ? GOOGLE_IMAGE_PRICING_EXPIRES
                      : PRICING_EXPIRES)
              ? 'Model pricing needs maintenance review.'
              : null;
        return {
          ...model,
          status: reason ? 'NOT_CONFIGURED' : 'AVAILABLE',
          configured: reason === null,
          unavailableReason: reason,
        };
      }),
    };
  }
}
