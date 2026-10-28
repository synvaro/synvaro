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
import { LinkedInPublisher } from '../social/linkedin-publisher.js';
import { LinkedInPublicationController } from './linkedin.controller.js';
import { LinkedInPublicationService } from './linkedin.service.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [
    PublicationController,
    InstagramPublicationController,
    InstagramDeliveryController,
    LinkedInPublicationController,
  ],
  providers: [
    FacebookPublisher,
    PublicationService,
    InstagramPublisher,
    InstagramPublicationService,
    LinkedInPublisher,
    LinkedInPublicationService,
  ],
})
export class PublicationModule {}
