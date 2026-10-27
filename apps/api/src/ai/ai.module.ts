import { GoogleTextProvider } from './google-text-provider.js';
import { GoogleImageProvider } from './google-image-provider.js';
import { ElevenLabsProvider } from './elevenlabs-provider.js';
import { SpeechService } from './speech.service.js';
import { SpeechController } from './speech.controller.js';
import { GoogleVideoProvider } from './google-video-provider.js';
import { VideoService } from './video.service.js';
import { VideoController } from './video.controller.js';
import { TEXT_PROVIDER, IMAGE_PROVIDER } from './providers/contracts.js';
import { ModelCatalogService } from './providers/catalog.service.js';
import { ModelCatalogController } from './providers/catalog.controller.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { OpenAITextProvider } from './text-provider.js';
import { MediaModule } from '../media/media.module.js';
import { ImageController } from './image.controller.js';
import { ImageService } from './image.service.js';
import { OpenAIImageProvider } from './image-provider.js';
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [
    AiController,
    ImageController,
    SpeechController,
    VideoController,
    ModelCatalogController,
  ],
  providers: [
    AiService,
    GoogleTextProvider,
    GoogleImageProvider,
    ElevenLabsProvider,
    SpeechService,
    GoogleVideoProvider,
    VideoService,
    OpenAITextProvider,
    ImageService,
    OpenAIImageProvider,
    ModelCatalogService,
    { provide: TEXT_PROVIDER, useExisting: OpenAITextProvider },
    { provide: IMAGE_PROVIDER, useExisting: OpenAIImageProvider },
  ],
})
export class AiModule {}
