import { GOOGLE_TEXT_MODEL } from './providers/models.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard.js';
import { AiService } from './ai.service.js';
import { MODEL } from './text-provider.js';
import { IMAGE_MODEL, IMAGE_SIZES, IMAGE_QUALITIES } from './image-provider.js';
import {
  GOOGLE_IMAGE_MODEL,
  GOOGLE_IMAGE_SIZES,
  GOOGLE_IMAGE_QUALITIES,
  GOOGLE_IMAGE_ASPECT_RATIOS,
} from './providers/models.js';
const preference = z
  .object({
    speechEnabled: z.boolean().optional(),
    videoEnabled: z.boolean().optional(),
    imageEnabled: z.boolean().optional(),
    imageModel: z.enum([IMAGE_MODEL, GOOGLE_IMAGE_MODEL]).optional(),
    imageSize: z.enum([...IMAGE_SIZES, ...GOOGLE_IMAGE_SIZES]).optional(),
    imageQuality: z
      .enum([...IMAGE_QUALITIES, ...GOOGLE_IMAGE_QUALITIES])
      .optional(),
    imageAspectRatio: z.enum(GOOGLE_IMAGE_ASPECT_RATIOS).optional(),
    enabled: z.boolean(),
    model: z.enum([MODEL, GOOGLE_TEXT_MODEL.model]),
    maxOutputTokens: z.number().int().min(128).max(2048),
    monthlyBudgetUsd: z
      .number()
      .min(0)
      .max(1000000)
      .multipleOf(0.01)
      .nullable(),
    confirmPaid: z.boolean(),
  })
  .strict();
const generation = z
  .object({
    requestId: z.uuid(),
    instruction: z.string().max(1000).optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      'Invalid AI preferences or generation input. Unsupported fields are rejected.',
    );
  return result.data;
}
@ApiTags('AI drafts')
@ApiCookieAuth('session')
@ApiBadRequestResponse({ description: 'Invalid or unsupported input' })
@ApiUnauthorizedResponse({ description: 'Session required' })
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Content not found (unknown and foreign indistinguishable)',
})
@ApiConflictResponse({
  description: 'Preference, confirmation, active request or budget conflict',
})
@ApiServiceUnavailableResponse({
  description:
    'Configuration unavailable or provider failure; paid reservation may be retained',
})
@Controller()
export class AiController {
  constructor(private readonly service: AiService) {}
  @Get('ai/preferences')
  @ApiOperation({
    summary:
      'Read own AI preferences, configuration availability and estimated UTC monthly usage',
  })
  @ApiOkResponse({
    description:
      'Preferences, supported models, pricing and usage; no credentials',
  })
  read(@Req() req: AuthRequest) {
    return this.service.preferences(req.user!.id);
  }
  @Put('ai/preferences')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'enabled',
        'model',
        'maxOutputTokens',
        'monthlyBudgetUsd',
        'confirmPaid',
      ],
      properties: {
        speechEnabled: { type: 'boolean' },
        videoEnabled: { type: 'boolean' },
        imageEnabled: { type: 'boolean' },
        imageModel: { type: 'string', enum: [IMAGE_MODEL, GOOGLE_IMAGE_MODEL] },
        imageSize: {
          type: 'string',
          enum: [...IMAGE_SIZES, ...GOOGLE_IMAGE_SIZES],
        },
        imageQuality: {
          type: 'string',
          enum: [...IMAGE_QUALITIES, ...GOOGLE_IMAGE_QUALITIES],
        },
        imageAspectRatio: {
          type: 'string',
          enum: [...GOOGLE_IMAGE_ASPECT_RATIOS],
        },
        enabled: { type: 'boolean' },
        model: { type: 'string', enum: [MODEL, GOOGLE_TEXT_MODEL.model] },
        maxOutputTokens: { type: 'integer', minimum: 128, maximum: 2048 },
        monthlyBudgetUsd: {
          type: 'number',
          nullable: true,
          minimum: 0,
          maximum: 1000000,
          multipleOf: 0.01,
        },
        confirmPaid: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'Updated preferences and current usage' })
  update(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.update(req.user!.id, parse(preference, body));
  }
  @Post('contents/:id/ai-generations')
  @ApiOperation({
    summary:
      'Generate a preview from saved owned draft context; never modifies Content',
    description:
      '409: disabled, confirmation required, active/duplicate request or budget blocked. 404: unknown/foreign content. 503: unavailable provider. Failed paid attempts retain reservations. No automatic retries.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId'],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        instruction: { type: 'string', maxLength: 1000 },
        confirmed: { type: 'boolean' },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Suggestion text and estimated (not billed) cost; no automatic save',
    schema: {
      type: 'object',
      required: [
        'generationId',
        'text',
        'model',
        'usage',
        'estimatedCostUsd',
        'reservedOrChargedUsd',
        'costUncertain',
      ],
      properties: {
        generationId: { type: 'string', format: 'uuid' },
        text: { type: 'string', maxLength: 20000 },
        model: { type: 'string' },
        usage: {
          type: 'object',
          nullable: true,
          properties: {
            inputTokens: { type: 'integer' },
            outputTokens: { type: 'integer' },
          },
        },
        estimatedCostUsd: { type: 'number', nullable: true },
        reservedOrChargedUsd: { type: 'number' },
        costUncertain: { type: 'boolean' },
      },
    },
  })
  generate(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(
      req.user!.id,
      parse(z.uuid(), id),
      parse(generation, body),
    );
  }
}
