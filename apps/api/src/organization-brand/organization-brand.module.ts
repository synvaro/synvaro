import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationController } from './organization.controller.js';
import { BrandController } from './brand.controller.js';
import { OrganizationBrandService } from './organization-brand.service.js';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationController, BrandController],
  providers: [OrganizationBrandService],
})
export class OrganizationBrandModule {}
