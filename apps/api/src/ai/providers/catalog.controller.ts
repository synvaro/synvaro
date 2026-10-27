import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ModelCatalogService } from './catalog.service.js';
@ApiTags('AI models')
@ApiCookieAuth('session')
@Controller('ai/models')
export class ModelCatalogController {
  constructor(private readonly catalog: ModelCatalogService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Read supported and planned provider/model/capability combinations',
    description:
      'AVAILABLE means implemented and locally configured, not verified account access. PLANNED cannot execute. User preferences and budget rules still apply.',
  })
  @ApiUnauthorizedResponse({ description: 'Session required' })
  @ApiOkResponse({
    description:
      'Safe catalog; settings only apply to implemented capabilities',
    schema: {
      type: 'object',
      required: ['models'],
      properties: {
        models: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'provider',
              'model',
              'capability',
              'implemented',
              'configured',
              'status',
              'cost',
              'verifiedAt',
              'reference',
              'unavailableReason',
            ],
            properties: {
              provider: {
                type: 'string',
                enum: ['openai', 'google', 'elevenlabs'],
              },
              model: { type: 'string' },
              capability: {
                type: 'string',
                enum: [
                  'TEXT_GENERATION',
                  'IMAGE_GENERATION',
                  'IMAGE_EDITING',
                  'VIDEO_GENERATION',
                  'IMAGE_TO_VIDEO',
                  'SPEECH_GENERATION',
                ],
              },
              implemented: { type: 'boolean' },
              configured: { type: 'boolean' },
              status: {
                type: 'string',
                enum: ['AVAILABLE', 'NOT_CONFIGURED', 'PLANNED'],
              },
              unavailableReason: { type: 'string', nullable: true },
              verifiedAt: { type: 'string', format: 'date' },
              reference: { type: 'string', format: 'uri' },
              cost: {
                type: 'object',
                properties: {
                  capability: {
                    type: 'string',
                    enum: [
                      'CONSERVATIVE_BOUND',
                      'ESTIMATE_ONLY',
                      'UNAVAILABLE',
                    ],
                  },
                  reference: { type: 'string', format: 'uri' },
                },
              },
              settings: {
                oneOf: [
                  {
                    type: 'object',
                    properties: {
                      outputFormats: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      minOutputTokens: { type: 'integer' },
                      maxOutputTokens: { type: 'integer' },
                    },
                  },
                  {
                    type: 'object',
                    properties: {
                      outputFormats: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      maxCharacters: { type: 'integer' },
                    },
                  },
                  {
                    type: 'object',
                    properties: {
                      outputFormats: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      sizes: { type: 'array', items: { type: 'string' } },
                      qualities: { type: 'array', items: { type: 'string' } },
                      aspectRatios: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      inputFormats: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  })
  read() {
    return this.catalog.read();
  }
}
