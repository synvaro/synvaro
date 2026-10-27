import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SocialController } from './social.controller.js';
import { SocialService } from './social.service.js';
import { SocialProviders } from './providers.js';

@Module({
  imports: [AuthModule],
  controllers: [SocialController],
  providers: [SocialService, SocialProviders],
})
export class SocialModule {}
