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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { ReelService } from './reel.service.js';
const uuid = (id: string) => {
  if (!z.uuid().safeParse(id).success)
    throw new BadRequestException('Invalid identifier');
  return id;
};
const scene = z
  .object({
    mediaAssetId: z.uuid(),
    imageDurationSec: z.number().int().min(1).max(10).optional(),
    videoStartSec: z.number().int().min(0).max(3600).optional(),
    videoDurationSec: z.number().int().min(1).max(15).optional(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) =>
        [...value].every(
          (ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127,
        ),
      )
      .optional(),
    placement: z.enum(['top', 'center', 'bottom']).optional(),
  })
  .strict();
const request = z
  .object({
    requestId: z.uuid(),
    scenes: z.array(scene).min(1).max(10),
    narrationAssetId: z.uuid().optional(),
  })
  .strict();
const empty = (body: unknown) => {
  if (body !== undefined && !z.object({}).strict().safeParse(body).success)
    throw new BadRequestException('Unsupported fields');
};
@ApiTags('Reels assembly')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({ description: 'Invalid scene, narration or fields' })
@ApiConflictResponse({ description: 'Duplicate or active render' })
@Controller()
export class ReelController {
  constructor(private readonly reels: ReelService) {}
  @Post('contents/:id/reels')
  @ApiOperation({
    summary: 'Queue one local FFmpeg Reel render from owned assets',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['requestId', 'scenes'],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        narrationAssetId: { type: 'string', format: 'uuid' },
        scenes: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              mediaAssetId: { type: 'string', format: 'uuid' },
              imageDurationSec: { type: 'integer' },
              videoStartSec: { type: 'integer' },
              videoDurationSec: { type: 'integer' },
              text: { type: 'string', maxLength: 120 },
              placement: { type: 'string', enum: ['top', 'center', 'bottom'] },
            },
          },
        },
      },
      additionalProperties: false,
    },
  })
  @ApiCreatedResponse({ description: 'Queued render status' })
  start(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = request.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid Reel request');
    return this.reels.start(
      req.user!.id,
      uuid(id),
      parsed.data.requestId,
      parsed.data.scenes,
      parsed.data.narrationAssetId,
    );
  }
  @Get('contents/:id/reels/latest')
  @ApiOperation({ summary: 'Recover latest Reel render after refresh' })
  @ApiOkResponse({ description: 'Latest render or null' })
  latest(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.reels.latest(req.user!.id, uuid(id));
  }
  @Get('reels/:id')
  @ApiOperation({ summary: 'Read owned local render status' })
  @ApiOkResponse({ description: 'Render status and safe scene provenance' })
  result(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.reels.result(req.user!.id, uuid(id));
  }
  @Get('reels/:id/file')
  @ApiOperation({ summary: 'Stream private Reel MP4 preview' })
  @ApiOkResponse({
    content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } },
  })
  async file(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.reels.file(
      req.user!.id,
      uuid(id),
      req.headers.range,
    );
    if (file.partial) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${file.start}-${file.end}/${file.size}`,
      );
    }
    res.set({
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(file.end - file.start + 1),
      'Accept-Ranges': 'bytes',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline; filename="reel-preview.mp4"',
    });
    return new StreamableFile(file.stream);
  }
  @Post('reels/:id/accept')
  @ApiOperation({
    summary: 'Save an owned reviewed Reel to private Media Library',
  })
  @ApiCreatedResponse({ description: 'Saved REEL_ASSEMBLED MediaAsset' })
  accept(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    empty(body);
    return this.reels.accept(req.user!.id, uuid(id));
  }
  @Delete('reels/:id')
  @ApiOperation({ summary: 'Discard unsaved completed Reel preview' })
  discard(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    empty(body);
    return this.reels.discard(req.user!.id, uuid(id));
  }
}
