import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Prisma } from '@synvaro/database';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { DatabaseService } from '../auth/database.service.js';
import { brandId } from './validation.js';

const text = z.string().trim().max(4000);
const language = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value, ctx) => {
    try {
      return Intl.getCanonicalLocales(value)[0]!;
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Use a language tag such as tr, en-GB or zh-Hant.',
      });
      return z.NEVER;
    }
  });
const input = z
  .object({
    description: text.optional(),
    targetAudience: text.optional(),
    toneOfVoice: text.optional(),
    defaultLanguage: language.nullable().optional(),
    contentGuidelines: text.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one profile field.',
  );

class ProfileDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) brandId!: string;
  @ApiProperty({ type: String, maxLength: 4000 }) description!: string;
  @ApiProperty({ type: String, maxLength: 4000 }) targetAudience!: string;
  @ApiProperty({ type: String, maxLength: 4000 }) toneOfVoice!: string;
  @ApiProperty({ type: String, maxLength: 100, nullable: true })
  defaultLanguage!: string | null;
  @ApiProperty({ type: String, maxLength: 4000 }) contentGuidelines!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
class ProfileResponseDto {
  @ApiProperty({ type: ProfileDto, nullable: true })
  profile!: ProfileDto | null;
}
const textProperty = {
  type: 'string',
  maxLength: 4000,
  description: 'Trimmed text; empty string clears this field.',
};

@ApiTags('brand profiles')
@ApiCookieAuth('session')
@ApiParam({ name: 'id', type: String, format: 'uuid' })
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiNotFoundResponse({
  description: 'Unknown or foreign brand; identical response',
})
@ApiBadRequestResponse({
  description: 'Invalid UUID, fields, language tag or input length',
})
@Controller('brands/:id/profile')
export class BrandProfileController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOkResponse({
    type: ProfileResponseDto,
    description:
      'Profile or explicit null for an owned brand without a profile',
  })
  async read(@Req() req: AuthRequest, @Param('id') id: string) {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId(id), organization: { ownerUserId: req.user!.id } },
      select: { profile: true },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  @Put()
  @ApiOkResponse({
    type: ProfileResponseDto,
    description:
      'Create or update supplied fields only; omitted fields remain unchanged. New text fields default to empty, language to null.',
  })
  @ApiForbiddenResponse({ description: 'Mutation Origin rejected' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        description: textProperty,
        targetAudience: textProperty,
        toneOfVoice: textProperty,
        contentGuidelines: textProperty,
        defaultLanguage: {
          type: 'string',
          nullable: true,
          maxLength: 100,
          description:
            'BCP 47 Unicode locale tag validated/canonicalized by Intl.getCanonicalLocales. Null clears; no inferred default.',
          example: 'tr-TR',
        },
      },
    },
  })
  async save(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = input.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Invalid profile: use only the five profile fields, text up to 4000 characters, and a language tag such as tr or en-GB (or null).',
      );
    try {
      // The parent write predicate enforces ownership for both create and update.
      return await this.db.client.brand.update({
        where: { id: brandId(id), organization: { ownerUserId: req.user!.id } },
        data: {
          profile: { upsert: { create: parsed.data, update: parsed.data } },
        },
        select: { profile: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException('Brand not found');
      throw error;
    }
  }
}
