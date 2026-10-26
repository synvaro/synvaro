import { ContentModule } from './content/content.module.js';
import { OrganizationBrandModule } from './organization-brand/organization-brand.module.js';
import { AuthModule } from './auth/auth.module.js';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthModule } from './health/health.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

@Module({
  imports: [HealthModule, AuthModule, OrganizationBrandModule, ContentModule],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
