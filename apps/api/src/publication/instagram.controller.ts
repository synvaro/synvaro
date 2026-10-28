import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { Public } from '../auth/auth.guard.js';
import { InstagramPublicationService } from './instagram.service.js';
const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Invalid identifier');
  return value;
};
const bodySchema = z
  .object({
    socialAccountId: z.uuid(),
    mediaAssetId: z.uuid(),
    requestId: z.uuid(),
  })
  .strict();
const confirmSchema = z.object({ confirm: z.literal(true) }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid publication request');
  return result.data;
}
@ApiTags('Instagram professional publishing')
@ApiCookieAuth('session')
@ApiNotFoundResponse({
  description: 'Unknown and foreign records have the same response',
})
@ApiBadRequestResponse({ description: 'Invalid publication request or image' })
@ApiConflictResponse({
  description: 'Stale snapshot, incomplete grant or unresolved publication',
})
@Controller()
export class InstagramPublicationController {
  constructor(private readonly service: InstagramPublicationService) {}
  @Get('contents/:id/instagram-publications/readiness')
  @ApiOperation({
    summary:
      'Read Instagram professional account readiness and HTTPS delivery configuration',
  })
  readiness(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.readiness(req.user!.id, uuid(id));
  }
  @Get('contents/:id/instagram-publications')
  @ApiOperation({ summary: 'List owned Instagram publication history' })
  history(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.history(req.user!.id, uuid(id));
  }
  @Post('contents/:id/instagram-publications')
  @ApiOperation({
    summary:
      'Prepare immutable saved caption and owned JPEG snapshot; no Meta write',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['socialAccountId', 'mediaAssetId', 'requestId'],
      properties: {
        socialAccountId: { type: 'string', format: 'uuid' },
        mediaAssetId: { type: 'string', format: 'uuid' },
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
    const input = parse(bodySchema, body);
    return this.service.prepare(
      req.user!.id,
      uuid(id),
      input.socialAccountId,
      input.requestId,
      input.mediaAssetId,
    );
  }
  @Get('instagram-publications/:id')
  @ApiOperation({ summary: 'Read durable result without a provider write' })
  read(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.read(req.user!.id, uuid(id));
  }
  @Post('instagram-publications/:id/confirm')
  @ApiOperation({
    summary: 'Explicitly create exactly one Instagram image container',
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
    parse(confirmSchema, body);
    return this.service.confirm(req.user!.id, uuid(id));
  }
  @Post('instagram-publications/:id/check')
  @ApiOperation({
    summary:
      'Check existing container status; never creates or publishes media',
  })
  check(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(confirmSchema, body);
    return this.service.check(req.user!.id, uuid(id));
  }
  @Post('instagram-publications/:id/publish')
  @ApiOperation({
    summary:
      'Explicitly publish a finished container once; uncertain outcomes are never retried',
  })
  publish(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(confirmSchema, body);
    return this.service.publish(req.user!.id, uuid(id));
  }
}

@ApiTags('Instagram image delivery')
@Controller()
export class InstagramDeliveryController {
  constructor(private readonly service: InstagramPublicationService) {}
  @Public()
  @Get('instagram-delivery/:id/:expiry/:signature')
  @ApiOperation({
    summary:
      'Short-lived signed JPEG delivery to Meta; not a general media URL',
  })
  @ApiOkResponse({ description: 'Validated immutable JPEG bytes' })
  async delivery(
    @Param('id') id: string,
    @Param('expiry') expiry: string,
    @Param('signature') signature: string,
    @Res() response: Response,
  ) {
    if (!/^\d{10}$/.test(expiry) || !/^[A-Za-z0-9_-]{43}$/.test(signature))
      throw new NotFoundException('Publication not found');
    const bytes = await this.service.delivery(
      uuid(id),
      Number(expiry),
      signature,
    );
    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Content-Length', String(bytes.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      'inline; filename="instagram-image.jpg"',
    );
    response.end(bytes);
  }
}
