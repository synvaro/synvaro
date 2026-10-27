import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { MultipartUpload } from '../auth/auth.guard.js';
import type { AuthRequest } from '../auth/auth.guard.js';
import { MediaService } from './media.service.js';
function id(value: string) {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('ID must be a UUID');
  return value;
}
class GenerationProvenanceDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) provider!: string;
  @ApiProperty({ type: String }) model!: string;
  @ApiProperty({ type: String, nullable: true }) imageSize!: string | null;
  @ApiProperty({ type: String, nullable: true }) imageQuality!: string | null;
  @ApiProperty({ type: String, nullable: true }) imageAspectRatio!:
    string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sourceMediaAssetId!: string | null;
  @ApiProperty({ type: String, nullable: true }) providerGenerationId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) voiceId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class AssetDto {
  @ApiProperty({
    type: GenerationProvenanceDto,
    nullable: true,
    description: 'AI generation provenance; null for uploaded originals',
  })
  generation!: GenerationProvenanceDto | null;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) brandId!: string;
  @ApiProperty({ type: String, maxLength: 255 }) originalFilename!: string;
  @ApiProperty({
    type: String,
    enum: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg'],
  })
  mimeType!: string;
  @ApiProperty({ type: Number, maximum: 20971520 }) sizeBytes!: number;
  @ApiProperty({ type: Number, nullable: true }) width!: number | null;
  @ApiProperty({ type: Number, nullable: true }) height!: number | null;
  @ApiProperty({ type: Number, nullable: true }) durationMs!: number | null;
  @ApiProperty({ enum: ['UPLOADED', 'AI_GENERATED', 'AI_EDITED', 'AI_VOICE'] })
  origin!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
class AssetResponse {
  @ApiProperty({ type: AssetDto }) asset!: AssetDto;
}
class AssetsResponse {
  @ApiProperty({ type: [AssetDto] }) assets!: AssetDto[];
}
@ApiTags('media')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources return identical 404s',
})
@ApiBadRequestResponse({ description: 'Invalid ID or upload' })
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @MultipartUpload()
  @Post('brands/:brandId/media')
  @ApiParam({ name: 'brandId', type: String, format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG, PNG, static WebP or H.264 MP4; max 20 MiB',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: AssetResponse })
  @ApiForbiddenResponse({ description: 'Origin rejected' })
  @ApiResponse({ status: 413, description: 'Upload exceeds 20 MiB' })
  @ApiResponse({
    status: 503,
    description: 'Private storage/ffprobe unavailable or upload capacity busy',
  })
  async upload(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('brandId') brandId: string,
  ) {
    try {
      return { asset: await this.media.upload(req.user!.id, id(brandId), req) };
    } catch (error) {
      res.setHeader('Connection', 'close');
      throw error;
    }
  }
  @Get('brands/:brandId/media')
  @ApiParam({ name: 'brandId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AssetsResponse })
  async list(@Req() req: AuthRequest, @Param('brandId') brandId: string) {
    return { assets: await this.media.list(req.user!.id, id(brandId)) };
  }
  @Get('media/:id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AssetResponse })
  async metadata(@Req() req: AuthRequest, @Param('id') assetId: string) {
    return { asset: await this.media.metadata(req.user!.id, id(assetId)) };
  }
  @Get('media/:id/file')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description: 'Authenticated original bytes, no-store',
  })
  @ApiResponse({ status: 206, description: 'Single byte range' })
  @ApiResponse({
    status: 416,
    description: 'Unsatisfiable or unsupported range',
  })
  async file(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') assetId: string,
  ) {
    const asset = await this.media.asset(req.user!.id, id(assetId));
    let start = 0,
      end = asset.sizeBytes - 1;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) {
        res
          .status(416)
          .setHeader('Content-Range', `bytes */${asset.sizeBytes}`);
        return;
      }
      if (!range[1]) {
        const suffix = Number(range[2]);
        start = Math.max(0, asset.sizeBytes - suffix);
      } else {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), end);
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= asset.sizeBytes
      ) {
        res
          .status(416)
          .setHeader('Content-Range', `bytes */${asset.sizeBytes}`);
        return;
      }
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${start}-${end}/${asset.sizeBytes}`,
      );
    }
    const stream = await this.media.storage
      .read(asset.storageKey, start, end)
      .catch(() => {
        throw new ServiceUnavailableException('Media file unavailable');
      });
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', end - start + 1);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `inline; filename="media-${asset.id}.${asset.mimeType === 'video/mp4' ? 'mp4' : asset.mimeType === 'audio/mpeg' ? 'mp3' : asset.mimeType.split('/')[1]}"`,
    );
    return new StreamableFile(stream);
  }
}
