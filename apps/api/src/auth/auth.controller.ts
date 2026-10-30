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
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { PendingMfa, Public } from './auth.guard.js';
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
const mfaCodeSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['code'],
  properties: {
    code: {
      type: 'string',
      description: 'Six-digit TOTP or one-time recovery code',
    },
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
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
      this.config.mfaRequired,
    );
    sessionCookie(res, this.config, result.token);
    return result.mfaRequired
      ? { mfaRequired: true, setupRequired: result.setupRequired }
      : { user: result.user };
  }

  @PendingMfa()
  @Get('mfa/status')
  @ApiCookieAuth('session')
  @ApiOperation({ summary: 'Read pending MFA setup status' })
  status(@Req() req: Request) {
    return this.mfa.status(sessionToken(req, this.config));
  }

  @PendingMfa()
  @Post('mfa/setup')
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Start first authenticator setup for a pending session',
  })
  setup(@Req() req: Request) {
    return this.mfa.setup(sessionToken(req, this.config));
  }

  @PendingMfa()
  @Post('mfa/activate')
  @ApiCookieAuth('session')
  @ApiBody({ schema: mfaCodeSchema })
  @ApiOperation({
    summary: 'Confirm TOTP enrollment and receive recovery codes once',
  })
  async activate(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const code = this.parseCode(body);
    const result = await this.mfa.activate(
      sessionToken(req, this.config),
      code,
    );
    sessionCookie(res, this.config, result.token);
    return { recoveryCodes: result.recoveryCodes };
  }

  @PendingMfa()
  @Post('mfa/verify')
  @ApiCookieAuth('session')
  @ApiBody({ schema: mfaCodeSchema })
  @ApiOperation({
    summary: 'Finish MFA challenge and rotate to a full session',
  })
  async verify(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const code = this.parseCode(body);
    const result = await this.mfa.verify(sessionToken(req, this.config), code);
    sessionCookie(res, this.config, result.token);
    return { verified: true };
  }

  private parseCode(body: unknown) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { code?: unknown }).code !== 'string' ||
      !/^(?:\d{6}|[0-9a-f]{32})$/.test((body as { code: string }).code)
    )
      throw new ForbiddenException('Invalid verification code');
    return (body as { code: string }).code;
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
