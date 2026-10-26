import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthRequest } from '../auth/auth.guard.js';
import { OrganizationBrandService } from './organization-brand.service.js';
import { organizationInput, validate } from './validation.js';
import { organizationBody, OrganizationResponseDto } from './openapi.js';

@ApiTags('organizations')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiForbiddenResponse({ description: 'Mutation Origin rejected' })
@Controller('organizations')
export class OrganizationController {
  constructor(private readonly service: OrganizationBrandService) {}
  @Post()
  @ApiBody({ schema: organizationBody })
  @ApiCreatedResponse({ type: OrganizationResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid input or client-supplied ownership',
  })
  @ApiConflictResponse({
    description: 'Owner already has an organization or slug is unavailable',
  })
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    return {
      organization: await this.service.createOrganization(
        req.user!.id,
        validate(organizationInput, body),
      ),
    };
  }
  @Get('me')
  @ApiOkResponse({
    type: OrganizationResponseDto,
    description: 'Current owner organization, or explicit null',
  })
  async me(@Req() req: AuthRequest) {
    return { organization: await this.service.organization(req.user!.id) };
  }
}
