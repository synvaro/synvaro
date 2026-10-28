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
import { YouTubePublisher } from '../social/youtube-publisher.js';
import { YouTubePublicationController } from './youtube.controller.js';
import { YouTubePublicationService } from './youtube.service.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [
    PublicationController,
    InstagramPublicationController,
    InstagramDeliveryController,
    LinkedInPublicationController,
    YouTubePublicationController,
  ],
  providers: [
    FacebookPublisher,
    PublicationService,
    InstagramPublisher,
    InstagramPublicationService,
    LinkedInPublisher,
    LinkedInPublicationService,
    YouTubePublisher,
    YouTubePublicationService,
  ],
})
export class PublicationModule {}
