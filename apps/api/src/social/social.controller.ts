import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { SocialProvider } from '@synvaro/database';
import type { AuthRequest } from '../auth/auth.guard.js';
import { Public } from '../auth/auth.guard.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { sessionToken } from '../auth/auth-security.js';
import { SocialService } from './social.service.js';

const uuid = (value: string) => {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Invalid identifier');
  return value;
};
const platform = z.enum(['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'YOUTUBE']);
const bodyPlatform = z.object({ platform }).strict();
const bodyAccount = z
  .object({ externalId: z.string().min(1).max(160) })
  .strict();
const bodyEmpty = z.object({}).strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid social connection request');
  return result.data;
};
const token = (req: AuthRequest) => {
  const value = sessionToken(req, loadAuthConfig());
  if (!value) throw new BadRequestException('Invalid session');
  return value;
};

@ApiTags('Social account connections')
@ApiForbiddenResponse({ description: 'Origin rejected' })
@ApiNotFoundResponse({
  description: 'Unknown and foreign resources are indistinguishable',
})
@ApiBadRequestResponse({ description: 'Invalid input or OAuth state' })
@ApiConflictResponse({ description: 'Duplicate or expired authorization' })
@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('social/providers')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary: 'List connection capabilities and local configuration',
  })
  @ApiOkResponse({
    description: 'Safe provider catalog; never includes credentials',
  })
  catalog() {
    return this.social.catalog();
  }

  @Post('brands/:id/social/oauth')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary: 'Start OAuth for an owned brand and explicit platform',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['platform'],
      properties: { platform: { type: 'string', enum: platform.options } },
      additionalProperties: false,
    },
  })
  start(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.social.start(
      req.user!.id,
      token(req),
      uuid(id),
      parse(bodyPlatform, body).platform,
    );
  }

  @Public()
  @Post('social/oauth/:provider/callback')
  @ApiOperation({
    summary:
      'Consume provider callback state once; called by same-origin Next route',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['state'],
      properties: {
        state: { type: 'string' },
        code: { type: 'string' },
        error: { type: 'string' },
      },
      additionalProperties: false,
    },
  })
  callback(@Param('provider') provider: string, @Body() body: unknown) {
    const name = parse(
      z.enum(['meta', 'linkedin', 'google']),
      provider,
    ).toUpperCase() as SocialProvider;
    const data = parse(
      z
        .object({
          state: z.string().max(128),
          code: z.string().max(2048).optional(),
          error: z.string().max(100).optional(),
        })
        .strict(),
      body,
    );
    return this.social.callback(name, data.state, data.code, data.error);
  }

  @Get('social/oauth/attempts/:id')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary:
      'Read safe discovered accounts for the same session that started OAuth',
  })
  @ApiOkResponse({ description: 'Account candidates without provider tokens' })
  discovery(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.social.discovery(req.user!.id, token(req), uuid(id));
  }

  @Post('social/oauth/attempts/:id/accounts')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary:
      'Explicitly associate one discovered account with the selected brand',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['externalId'],
      properties: { externalId: { type: 'string', maxLength: 160 } },
      additionalProperties: false,
    },
  })
  associate(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.social.associate(
      req.user!.id,
      token(req),
      uuid(id),
      parse(bodyAccount, body).externalId,
    );
  }

  @Get('brands/:id/social-accounts')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary: 'List only safe connection metadata for an owned brand',
  })
  @ApiOkResponse({
    description: 'Owned brand connections with status and scopes',
  })
  list(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.social.list(req.user!.id, uuid(id));
  }

  @Delete('social/accounts/:id')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary:
      'Disconnect owned account, remove local token and attempt provider revocation',
  })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  disconnect(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(bodyEmpty, body);
    return this.social.disconnect(req.user!.id, uuid(id));
  }

  @Post('social/accounts/:id/refresh')
  @ApiCookieAuth('session')
  @ApiUnauthorizedResponse({ description: 'SYNVARO session required' })
  @ApiOperation({
    summary:
      'Explicitly refresh a YouTube connection where a refresh token exists',
  })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  refresh(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(bodyEmpty, body);
    return this.social.refresh(req.user!.id, uuid(id));
  }
}
