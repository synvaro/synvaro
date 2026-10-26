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
  controllers: [AiController, ImageController],
  providers: [AiService, OpenAITextProvider, ImageService, OpenAIImageProvider],
})
export class AiModule {}
