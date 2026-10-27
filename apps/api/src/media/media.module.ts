import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { LocalMediaStorage } from './storage.js';
@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  exports: [LocalMediaStorage, MediaService],
  providers: [MediaService, LocalMediaStorage],
})
export class MediaModule {}
