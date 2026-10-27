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
  ApiTags,
  ApiCookieAuth,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { AssetDto } from '../media/media.controller.js';
import { ImageService } from './image.service.js';
const schema = z
  .object({
    requestId: z.uuid(),
    instruction: z.string().trim().min(1).max(1000),
    confirmed: z.boolean(),
  })
  .strict();
const editSchema = schema.extend({ sourceMediaAssetId: z.uuid() });
function uuid(value: string) {
  const r = z.uuid().safeParse(value);
  if (!r.success) throw new BadRequestException('Invalid identifier');
  return r.data;
}
@ApiTags('AI images')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({ description: 'Invalid input or unsupported fields' })
@ApiConflictResponse({
  description:
    'Disabled, confirmation required, budget selected, active or duplicate request, or existing preview',
})
@ApiServiceUnavailableResponse({
  description: 'Configuration or provider unavailable; charge may be uncertain',
})
@Controller()
export class ImageController {
  constructor(private readonly service: ImageService) {}
  @Post('contents/:id/image-generations')
  @ApiOperation({
    summary:
      'Generate a conceptual image preview from saved owned brand/draft context; never saves or attaches automatically',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId', 'instruction', 'confirmed'],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        instruction: { type: 'string', minLength: 1, maxLength: 1000 },
        confirmed: { type: 'boolean' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Generation status, protected preview availability, settings, usage and estimated cost; no prompt, key or storage path',
  })
  generate(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const r = schema.safeParse(body);
    if (!r.success)
      throw new BadRequestException('Invalid image generation request');
    return this.service.generate(req.user!.id, uuid(id), r.data);
  }
  @Post('contents/:id/image-edits')
  @ApiOperation({
    summary:
      'Edit an existing image from the owned draft brand with Google; source remains unchanged and result is a private preview',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId', 'instruction', 'confirmed', 'sourceMediaAssetId'],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        instruction: { type: 'string', minLength: 1, maxLength: 1000 },
        confirmed: { type: 'boolean' },
        sourceMediaAssetId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Protected edited-image preview, source asset reference and estimated usage; no automatic save or attachment',
  })
  edit(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const r = editSchema.safeParse(body);
    if (!r.success) throw new BadRequestException('Invalid image edit request');
    return this.service.generate(req.user!.id, uuid(id), r.data);
  }
  @Get('contents/:id/image-generations/latest')
  @ApiOperation({
    summary: 'Recover latest owned image result without another paid request',
  })
  @ApiOkResponse({
    description: 'Object containing generation metadata or generation: null',
  })
  latest(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.latest(req.user!.id, uuid(id));
  }
  @Get('image-generations/:id')
  @ApiOperation({
    summary: 'Read own image generation metadata and estimated usage',
  })
  read(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.result(req.user!.id, uuid(id));
  }
  @Get('image-generations/:id/file')
  @ApiOperation({
    summary: 'Stream private unaccepted PNG preview; expires after one hour',
  })
  @ApiOkResponse({
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  async file(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stream = await this.service.file(req.user!.id, uuid(id));
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `inline; filename="ai-preview.png"`,
    });
    return new StreamableFile(stream);
  }
  @Post('image-generations/:id/accept')
  @ApiOperation({
    summary:
      'Idempotently save preview to its brand Media Library, preserving original bytes and provenance',
  })
  @ApiCreatedResponse({
    type: AssetDto,
    description:
      'MediaAsset with AI_GENERATED or AI_EDITED origin and generation provenance',
  })
  accept(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.empty(body);
    return this.service.accept(req.user!.id, uuid(id));
  }
  @Delete('image-generations/:id')
  @ApiOperation({
    summary:
      'Discard an unaccepted preview without clearing usage or uncertain charges',
  })
  discard(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.empty(body);
    return this.service.discard(req.user!.id, uuid(id));
  }
  private empty(body: unknown) {
    if (body !== undefined && !z.object({}).strict().safeParse(body).success)
      throw new BadRequestException('Unsupported fields');
  }
}
