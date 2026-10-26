import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { ContentService } from './content.service.js';
const title = z.string().trim().min(1).max(200);
const body = z.string().max(20000);
const create = z
  .object({ brandId: z.uuid(), title, body: body.optional() })
  .strict();
const update = z
  .object({ title: title.optional(), body: body.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      'Invalid draft: title 1–200 characters, body up to 20000, valid UUID; unsupported fields are not accepted.',
    );
  return result.data;
}
class SummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) brandId!: string;
  @ApiProperty({ type: String, maxLength: 200 }) title!: string;
  @ApiProperty({ enum: ['DRAFT'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
class ContentDto extends SummaryDto {
  @ApiProperty({ type: String, maxLength: 20000 }) body!: string;
}
class ContentResponseDto {
  @ApiProperty({ type: ContentDto }) content!: ContentDto;
}
class ListDto {
  @ApiProperty({ type: [SummaryDto] }) contents!: SummaryDto[];
}
const properties = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  body: { type: 'string', maxLength: 20000 },
};
@ApiTags('content drafts')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiForbiddenResponse({ description: 'Mutation Origin rejected' })
@ApiBadRequestResponse({ description: 'Invalid fields, UUID or brand filter' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources have identical responses',
})
@Controller('contents')
export class ContentController {
  constructor(private readonly service: ContentService) {}
  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['brandId', 'title'],
      properties: {
        ...properties,
        brandId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: ContentResponseDto })
  async create(@Req() req: AuthRequest, @Body() value: unknown) {
    return {
      content: await this.service.create(req.user!.id, parse(create, value)),
    };
  }
  @Get()
  @ApiQuery({ name: 'brandId', required: true, type: String, format: 'uuid' })
  @ApiOkResponse({ type: ListDto })
  async list(@Req() req: AuthRequest, @Query() query: unknown) {
    const { brandId } = parse(z.object({ brandId: z.uuid() }).strict(), query);
    return { contents: await this.service.list(req.user!.id, brandId) };
  }
  @Get(':id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: ContentResponseDto })
  async read(@Req() req: AuthRequest, @Param('id') id: string) {
    return {
      content: await this.service.read(req.user!.id, parse(z.uuid(), id)),
    };
  }
  @Patch(':id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties,
    },
  })
  @ApiOkResponse({ type: ContentResponseDto })
  async update(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    return {
      content: await this.service.update(
        req.user!.id,
        parse(z.uuid(), id),
        parse(update, value),
      ),
    };
  }
}
