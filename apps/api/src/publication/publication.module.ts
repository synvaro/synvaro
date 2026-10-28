import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FacebookPublisher } from '../social/facebook-publisher.js';
import { MediaModule } from '../media/media.module.js';
import { PublicationController } from './publication.controller.js';
import { PublicationService } from './publication.service.js';
import {
  InstagramDeliveryController,
  InstagramPublicationController,
} from './instagram.controller.js';
import { InstagramPublicationService } from './instagram.service.js';
import { InstagramPublisher } from '../social/instagram-publisher.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [
    PublicationController,
    InstagramPublicationController,
    InstagramDeliveryController,
  ],
  providers: [
    FacebookPublisher,
    PublicationService,
    InstagramPublisher,
    InstagramPublicationService,
  ],
})
export class PublicationModule {}
