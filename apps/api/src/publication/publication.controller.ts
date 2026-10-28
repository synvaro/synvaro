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
import { PublicationService } from './publication.service.js';

const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Invalid identifier');
  return value;
};
const prepareBody = z
  .object({ socialAccountId: z.uuid(), requestId: z.uuid() })
  .strict();
const confirmBody = z.object({ confirm: z.literal(true) }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const value = schema.safeParse(body);
  if (!value.success)
    throw new BadRequestException('Invalid publication request');
  return value.data;
}

@ApiTags('Facebook Page publishing')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({ description: 'Invalid publication input' })
@ApiConflictResponse({
  description:
    'Stale draft, missing permission or active uncertain publication',
})
@Controller()
export class PublicationController {
  constructor(private readonly service: PublicationService) {}

  @Get('contents/:id/facebook-publications/readiness')
  @ApiOperation({
    summary:
      'Check connected brand Pages against current Meta publishing grant and Page task',
  })
  @ApiOkResponse({ description: 'Safe Page readiness; no credentials' })
  readiness(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.readiness(req.user!.id, uuid(id));
  }

  @Get('contents/:id/facebook-publications')
  @ApiOperation({ summary: 'List owned Facebook publication history' })
  @ApiOkResponse({ description: 'Immutable text snapshots and safe status' })
  history(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.history(req.user!.id, uuid(id));
  }

  @Post('contents/:id/facebook-publications')
  @ApiOperation({
    summary:
      'Prepare a reviewed immutable Facebook Page text snapshot; does not publish',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['socialAccountId', 'requestId'],
      properties: {
        socialAccountId: { type: 'string', format: 'uuid' },
        requestId: { type: 'string', format: 'uuid' },
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
    );
  }

  @Post('facebook-publications/:id/confirm')
  @ApiOperation({
    summary:
      'Explicitly confirm one reviewed Page text post; never retries a request',
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

  @Get('facebook-publications/:id')
  @ApiOperation({
    summary: 'Read owned publication result; no publication side effect',
  })
  @ApiOkResponse({ description: 'Safe durable publication result' })
  read(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.read(req.user!.id, uuid(id));
  }
}
