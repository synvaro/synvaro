import { GoogleTextProvider } from '../google-text-provider.js';
import { GOOGLE_TEXT_MODEL } from './models.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AiModelCatalog } from '@synvaro/contracts';
import {
  TEXT_PROVIDER,
  IMAGE_PROVIDER,
  type TextProvider,
  type ImageProvider,
} from './contracts.js';
import { MODEL_DEFINITIONS, PRICING_EXPIRES } from './models.js';
@Injectable()
export class ModelCatalogService {
  now = () => new Date();
  constructor(
    @Inject(TEXT_PROVIDER) private readonly text: TextProvider,
    @Inject(IMAGE_PROVIDER) private readonly image: ImageProvider,
    private readonly google: GoogleTextProvider,
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
          model.capability === 'TEXT_GENERATION'
            ? model.model === GOOGLE_TEXT_MODEL.model
              ? this.google
              : this.text
            : this.image;
        const reason = !adapter.configured()
          ? 'Server API key is not configured.'
          : model.capability === 'IMAGE_GENERATION' &&
              !process.env.MEDIA_STORAGE_ROOT?.trim()
            ? 'Private media storage is not configured.'
            : this.now() >= PRICING_EXPIRES
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
