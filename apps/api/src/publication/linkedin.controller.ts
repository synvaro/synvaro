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
import { LinkedInPublicationService } from './linkedin.service.js';

const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Invalid identifier');
  return value;
};
const prepareBody = z
  .object({
    socialAccountId: z.uuid(),
    requestId: z.uuid(),
    mediaAssetId: z.uuid().optional(),
  })
  .strict();
const confirmBody = z.object({ confirm: z.literal(true) }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException('Invalid publication request');
  return result.data;
}

@ApiTags('LinkedIn member publishing')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({ description: 'Invalid request or source image' })
@ApiConflictResponse({
  description:
    'Stale draft, changed media, missing grant or unresolved publication',
})
@Controller()
export class LinkedInPublicationController {
  constructor(private readonly service: LinkedInPublicationService) {}

  @Get('contents/:id/linkedin-publications/readiness')
  @ApiOperation({
    summary:
      'Check same-brand LinkedIn member grant and identity without a provider write',
  })
  @ApiOkResponse({
    description:
      'Safe member readiness; product entitlement is not inferred from a token',
  })
  readiness(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.readiness(req.user!.id, uuid(id));
  }
  @Get('contents/:id/linkedin-publications')
  @ApiOperation({ summary: 'Read owned LinkedIn publication history' })
  @ApiOkResponse({ description: 'Immutable snapshots and safe statuses' })
  history(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.history(req.user!.id, uuid(id));
  }
  @Post('contents/:id/linkedin-publications')
  @ApiOperation({
    summary:
      'Prepare a member text or single-image snapshot; no provider write',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['socialAccountId', 'requestId'],
      properties: {
        socialAccountId: { type: 'string', format: 'uuid' },
        requestId: { type: 'string', format: 'uuid' },
        mediaAssetId: { type: 'string', format: 'uuid' },
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
      input.requestId,
      input.mediaAssetId,
    );
  }
  @Post('linkedin-publications/:id/confirm')
  @ApiOperation({
    summary:
      'Explicitly attempt one LinkedIn member post; never automatically retries',
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
  @Get('linkedin-publications/:id')
  @ApiOperation({
    summary: 'Read owned LinkedIn publication result without side effects',
  })
  @ApiOkResponse({ description: 'Safe durable publication state' })
  read(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.read(req.user!.id, uuid(id));
  }
}
