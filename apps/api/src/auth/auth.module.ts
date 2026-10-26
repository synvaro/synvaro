import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRateLimiter } from './auth-security.js';
import { DatabaseService } from './database.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() },
    DatabaseService,
    AuthService,
    AuthRateLimiter,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
