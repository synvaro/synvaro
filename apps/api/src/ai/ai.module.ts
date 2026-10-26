import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { OpenAITextProvider } from './text-provider.js';
@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiService, OpenAITextProvider],
})
export class AiModule {}
