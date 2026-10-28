import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { YouTubePublicationService } from './youtube.service.js';

const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Invalid identifier');
  return value;
};
const prepareBody = z
  .object({
    socialAccountId: z.uuid(),
    mediaAssetId: z.uuid(),
    requestId: z.uuid(),
    title: z.string().min(1).max(100),
    privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
  })
  .strict();
const confirmBody = z.object({ confirm: z.literal(true) }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException('Invalid YouTube publication request');
  return result.data;
}

@ApiTags('YouTube video publishing')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({ description: 'Invalid metadata or video source' })
@ApiConflictResponse({
  description:
    'Stale review, changed source, missing grant or uncertain upload',
})
@Controller()
export class YouTubePublicationController {
  constructor(private readonly service: YouTubePublicationService) {}
  @Get('contents/:id/youtube-publications/readiness')
  @ApiOperation({
    summary:
      'Read same-Brand channel and upload-grant readiness without a provider write',
  })
  @ApiOkResponse({
    description: 'Safe channel states; app entitlement is not inferred',
  })
  readiness(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.readiness(req.user!.id, uuid(id));
  }
  @Get('contents/:id/youtube-publications')
  @ApiOperation({ summary: 'Read owned YouTube upload history' })
  history(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.history(req.user!.id, uuid(id));
  }
  @Post('contents/:id/youtube-publications')
  @ApiOperation({
    summary:
      'Prepare immutable video, channel, title, description and privacy review; no upload',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['socialAccountId', 'mediaAssetId', 'requestId', 'title'],
      properties: {
        socialAccountId: { type: 'string', format: 'uuid' },
        mediaAssetId: { type: 'string', format: 'uuid' },
        requestId: { type: 'string', format: 'uuid' },
        title: { type: 'string', maxLength: 100 },
        privacy: {
          type: 'string',
          enum: ['private', 'unlisted', 'public'],
          default: 'private',
        },
      },
      additionalProperties: false,
    },
  })
  prepare(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(prepareBody, body);
    return this.service.prepare(
      req.user!.id,
      uuid(id),
      input.socialAccountId,
      input.mediaAssetId,
      input.title,
      input.privacy,
      input.requestId,
    );
  }
  @Post('youtube-publications/:id/confirm')
  @ApiOperation({
    summary: 'Explicitly start exactly one resumable YouTube upload session',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['confirm'],
      properties: { confirm: { type: 'boolean', enum: [true] } },
      additionalProperties: false,
    },
  })
  confirm(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(confirmBody, body);
    return this.service.confirm(req.user!.id, uuid(id));
  }
  @Post('youtube-publications/:id/resume')
  @ApiOperation({
    summary:
      'Explicitly probe and continue only the existing encrypted upload session',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['confirm'],
      properties: { confirm: { type: 'boolean', enum: [true] } },
      additionalProperties: false,
    },
  })
  resume(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(confirmBody, body);
    return this.service.resume(req.user!.id, uuid(id));
  }
  @Post('youtube-publications/:id/check')
  @ApiOperation({
    summary:
      'Read-only provider verification of a known video ID and processing/privacy state',
  })
  check(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(z.object({}).strict(), body);
    return this.service.check(req.user!.id, uuid(id));
  }
  @Get('youtube-publications/:id')
  @ApiOperation({
    summary: 'Read owned upload state; no provider write or resubmission',
  })
  read(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.read(req.user!.id, uuid(id));
  }
}
