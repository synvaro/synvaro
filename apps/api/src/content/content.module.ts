import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
@Module({
  imports: [AuthModule],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
