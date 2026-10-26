import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
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
  ApiParam,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { AssetDto } from '../media/media.controller.js';
import { ContentMediaService } from './content-media.service.js';
const attach = z.object({ mediaAssetId: z.uuid() }).strict();
const order = z
  .object({
    mediaAssetIds: z
      .array(z.uuid())
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(
      'Invalid attachment request: valid unique UUIDs only; unsupported fields are not accepted',
    );
  return parsed.data;
}
class AttachmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) contentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) mediaAssetId!: string;
  @ApiProperty({ type: Number, minimum: 0 }) position!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: AssetDto }) asset!: AssetDto;
}
class AttachmentsDto {
  @ApiProperty({ type: [AttachmentDto] }) attachments!: AttachmentDto[];
}
@ApiTags('content media')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Session required' })
@ApiForbiddenResponse({ description: 'Mutation Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown, foreign, wrong-brand or unattached resource',
})
@ApiBadRequestResponse({
  description: 'Invalid or duplicate IDs/unsupported fields',
})
@ApiConflictResponse({
  description: 'Already attached or incomplete/stale reorder membership',
})
@ApiParam({ name: 'id', type: String, format: 'uuid' })
@Controller('contents/:id/media')
export class ContentMediaController {
  constructor(private readonly service: ContentMediaService) {}
  @Get()
  @ApiOkResponse({ type: AttachmentsDto })
  async list(@Req() req: AuthRequest, @Param('id') id: string) {
    return {
      attachments: await this.service.list(req.user!.id, parse(z.uuid(), id)),
    };
  }
  @Post()
  @ApiCreatedResponse({ type: AttachmentsDto })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaAssetId'],
      properties: { mediaAssetId: { type: 'string', format: 'uuid' } },
    },
  })
  async attach(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return {
      attachments: await this.service.attach(
        req.user!.id,
        parse(z.uuid(), id),
        parse(attach, value).mediaAssetId,
      ),
    };
  }
  @Put('order')
  @ApiOkResponse({ type: AttachmentsDto })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaAssetIds'],
      properties: {
        mediaAssetIds: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', format: 'uuid' },
          description:
            'Complete ordered list of current attachment mediaAssetIds',
        },
      },
    },
  })
  async order(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return {
      attachments: await this.service.reorder(
        req.user!.id,
        parse(z.uuid(), id),
        parse(order, value).mediaAssetIds,
      ),
    };
  }
  @Delete(':mediaAssetId')
  @ApiOkResponse({ type: AttachmentsDto })
  @ApiParam({ name: 'mediaAssetId', type: String, format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  async detach(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('mediaAssetId') asset: string,
    @Body() value: unknown,
  ) {
    parse(z.object({}).strict(), value);
    return {
      attachments: await this.service.detach(
        req.user!.id,
        parse(z.uuid(), id),
        parse(z.uuid(), asset),
      ),
    };
  }
}
