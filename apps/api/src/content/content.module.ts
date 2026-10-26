import { ContentMediaController } from '../content-media/content-media.controller.js';
import { ContentMediaService } from '../content-media/content-media.service.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
@Module({
  imports: [AuthModule],
  controllers: [ContentController, ContentMediaController],
  providers: [ContentService, ContentMediaService],
})
export class ContentModule {}
