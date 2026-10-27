import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { SpeechService } from './speech.service.js';
import { MAX_NARRATION, SPEECH_MODEL } from './elevenlabs-provider.js';

const input = z
  .object({
    requestId: z.uuid(),
    model: z.literal(SPEECH_MODEL),
    voiceId: z.string().regex(/^[A-Za-z0-9]{20,40}$/),
    text: z.string().trim().min(1).max(MAX_NARRATION),
    confirmed: z.boolean(),
  })
  .strict();
function id(value: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid identifier');
  return parsed.data;
}
@ApiTags('AI voice')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiBadRequestResponse({
  description: 'Invalid input or unavailable voice/model',
})
@ApiNotFoundResponse({
  description: 'Unknown and foreign drafts/results are indistinguishable',
})
@ApiConflictResponse({
  description:
    'Disabled, confirmation, duplicate, active request or selected budget',
})
@ApiServiceUnavailableResponse({
  description:
    'Provider, storage or inspection unavailable; charge may be uncertain',
})
@Controller()
export class SpeechController {
  constructor(private readonly speech: SpeechService) {}
  @Get('ai/voices')
  @ApiOperation({
    summary:
      'List available premade ElevenLabs voices for this server account; no paid generation',
  })
  @ApiOkResponse({
    description:
      'Voice IDs, names and verified language metadata when available',
  })
  voices() {
    return this.speech.voices();
  }

  @Post('contents/:id/speech-generations')
  @ApiOperation({
    summary:
      'Explicitly generate one private MP3 preview from editable narration; draft text stays unchanged',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId', 'model', 'voiceId', 'text', 'confirmed'],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        model: { type: 'string', enum: [SPEECH_MODEL] },
        voiceId: { type: 'string' },
        text: { type: 'string', minLength: 1, maxLength: MAX_NARRATION },
        confirmed: { type: 'boolean' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Generation metadata and private preview state; no narration or credential returned',
  })
  generate(
    @Req() req: AuthRequest,
    @Param('id') contentId: string,
    @Body() body: unknown,
  ) {
    const parsed = input.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Invalid voice generation request');
    return this.speech.generate(req.user!.id, id(contentId), parsed.data);
  }
  @Get('contents/:id/speech-generations/latest')
  @ApiOkResponse({ description: 'Latest owned voice generation or null' })
  latest(@Req() req: AuthRequest, @Param('id') contentId: string) {
    return this.speech.latest(req.user!.id, id(contentId));
  }
  @Get('speech-generations/:id')
  @ApiOkResponse({
    description:
      'Owned generation status and usage; no narration or storage path',
  })
  result(@Req() req: AuthRequest, @Param('id') generationId: string) {
    return this.speech.result(req.user!.id, id(generationId));
  }
  @Get('speech-generations/:id/file')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description: 'Private MP3 preview',
  })
  async file(
    @Req() req: AuthRequest,
    @Param('id') generationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stream = await this.speech.file(req.user!.id, id(generationId));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      'inline; filename="voice-preview.mp3"',
    );
    return new StreamableFile(stream);
  }
  @Post('speech-generations/:id/accept')
  @ApiCreatedResponse({
    description:
      'New private AI_VOICE MediaAsset; association uses ContentMedia separately',
  })
  accept(@Req() req: AuthRequest, @Param('id') generationId: string) {
    return this.speech.accept(req.user!.id, id(generationId));
  }
  @Delete('speech-generations/:id')
  @ApiOkResponse({
    description: 'Discard unsaved preview; usage record remains',
  })
  discard(@Req() req: AuthRequest, @Param('id') generationId: string) {
    return this.speech.discard(req.user!.id, id(generationId));
  }
}
