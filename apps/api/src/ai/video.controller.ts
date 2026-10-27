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
import { VideoService } from './video.service.js';
import {
  VIDEO_MODEL,
  VIDEO_DURATIONS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
} from './google-video-provider.js';
const startSchema = z
  .object({
    requestId: z.uuid(),
    instruction: z.string().trim().min(1).max(1000),
    model: z.literal(VIDEO_MODEL),
    duration: z.enum(VIDEO_DURATIONS),
    aspectRatio: z.enum(VIDEO_ASPECT_RATIOS),
    resolution: z.enum(VIDEO_RESOLUTIONS),
    sourceMediaAssetId: z.uuid().optional(),
    confirmed: z.boolean(),
  })
  .strict();
function uuid(id: string) {
  const r = z.uuid().safeParse(id);
  if (!r.success) throw new BadRequestException('Invalid identifier');
  return r.data;
}
@ApiTags('AI video')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({
  description: 'Invalid settings or unsupported fields',
})
@ApiConflictResponse({
  description:
    'Preference, budget, confirmation, duplicate or active request conflict',
})
@ApiServiceUnavailableResponse({
  description: 'Provider unavailable; charges may be uncertain',
})
@Controller()
export class VideoController {
  constructor(private readonly service: VideoService) {}
  @Post('contents/:id/video-generations')
  @ApiOperation({
    summary:
      'Start one confirmed background text-to-video or owned image-to-video request',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'requestId',
        'instruction',
        'model',
        'duration',
        'aspectRatio',
        'resolution',
        'confirmed',
      ],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        instruction: { type: 'string', maxLength: 1000 },
        model: { type: 'string', enum: [VIDEO_MODEL] },
        duration: { type: 'string', enum: [...VIDEO_DURATIONS] },
        aspectRatio: { type: 'string', enum: [...VIDEO_ASPECT_RATIOS] },
        resolution: { type: 'string', enum: [...VIDEO_RESOLUTIONS] },
        sourceMediaAssetId: { type: 'string', format: 'uuid' },
        confirmed: { type: 'boolean' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Owned operation status, provenance and estimated usage; no automatic save',
  })
  start(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid video request');
    return this.service.start(req.user!.id, uuid(id), parsed.data);
  }
  @Get('contents/:id/video-generations/latest')
  @ApiOperation({
    summary:
      'Recover latest owned operation after refresh without resubmitting',
  })
  @ApiOkResponse({ description: 'Generation or null' })
  latest(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.latest(req.user!.id, uuid(id));
  }
  @Get('video-generations/:id')
  @ApiOperation({
    summary: 'Observe owned provider operation and retrieve completed result',
  })
  @ApiOkResponse({
    description: 'Status, provenance, preview availability and estimated usage',
  })
  result(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.result(req.user!.id, uuid(id));
  }
  @Get('video-generations/:id/file')
  @ApiOperation({
    summary: 'Stream private MP4 preview before one-hour expiry',
  })
  @ApiOkResponse({
    content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } },
  })
  async file(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.service.file(
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
      'Content-Disposition': 'inline; filename="ai-video-preview.mp4"',
    });
    return new StreamableFile(file.stream);
  }
  @Post('video-generations/:id/accept')
  @ApiOperation({
    summary:
      'Save an owned reviewed preview as a new private AI_VIDEO MediaAsset',
  })
  @ApiCreatedResponse({
    description: 'MediaAsset for attachment through existing ContentMedia API',
  })
  accept(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.empty(body);
    return this.service.accept(req.user!.id, uuid(id));
  }
  @Delete('video-generations/:id')
  @ApiOperation({
    summary: 'Discard an unaccepted preview without clearing usage',
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
