import {
  Body,
  ForbiddenException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { Public } from './auth.guard.js';
import type { AuthRequest } from './auth.guard.js';
import { AUTH_CONFIG } from './auth.config.js';
import type { AuthConfig } from './auth.config.js';
import {
  AuthRateLimiter,
  parseCredentials,
  sessionCookie,
  sessionToken,
} from './auth-security.js';

const credentialSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: {
      type: 'string',
      format: 'password',
      minLength: 12,
      maxLength: 128,
    },
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiter: AuthRateLimiter,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Public()
  @Post('register')
  @ApiBody({ schema: credentialSchema })
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.config.registrationEnabled)
      throw new ForbiddenException('Registration is unavailable in production');
    this.limiter.ip(req, res);
    const { email, password } = parseCredentials(body);
    this.limiter.account(email, res);
    return this.auth.register(email, password);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiBody({ schema: credentialSchema })
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.limiter.ip(req, res);
    const { email, password } = parseCredentials(body);
    this.limiter.account(email, res);
    const result = await this.auth.login(
      email,
      password,
      sessionToken(req, this.config),
    );
    sessionCookie(res, this.config, result.token);
    return { user: result.user };
  }

  @Get('me')
  @ApiCookieAuth('session')
  me(@Req() req: AuthRequest) {
    return { user: req.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(sessionToken(req, this.config));
    sessionCookie(res, this.config, null);
    return { message: 'Signed out' };
  }
}
