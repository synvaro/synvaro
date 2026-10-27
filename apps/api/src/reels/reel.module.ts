import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { ReelController } from './reel.controller.js';
import { ReelService } from './reel.service.js';
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ReelController],
  providers: [ReelService],
})
export class ReelModule {}
