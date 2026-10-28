import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FacebookPublisher } from '../social/facebook-publisher.js';
import { MediaModule } from '../media/media.module.js';
import { PublicationController } from './publication.controller.js';
import { PublicationService } from './publication.service.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [PublicationController],
  providers: [FacebookPublisher, PublicationService],
})
export class PublicationModule {}
