import { Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '@synvaro/contracts';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG } from './auth.config.js';
import type { AuthConfig } from './auth.config.js';
import { requireSameOrigin, sessionToken } from './auth-security.js';

const PUBLIC = 'synvaro:public';
export const Public = () => SetMetadata(PUBLIC, true);
export type AuthRequest = Request & { user?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      requireSameOrigin(req, this.config);
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    req.user = await this.auth.authenticate(sessionToken(req, this.config));
    return true;
  }
}
