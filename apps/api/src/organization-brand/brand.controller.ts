import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthRequest } from '../auth/auth.guard.js';
import { OrganizationBrandService } from './organization-brand.service.js';
import {
  brandId,
  brandInput,
  brandUpdateInput,
  validate,
} from './validation.js';
import {
  brandBody,
  brandUpdateBody,
  BrandResponseDto,
  BrandsResponseDto,
} from './openapi.js';

@ApiTags('brands')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiForbiddenResponse({ description: 'Mutation Origin rejected' })
@Controller('brands')
export class BrandController {
  constructor(private readonly service: OrganizationBrandService) {}
  @Post()
  @ApiBody({ schema: brandBody })
  @ApiCreatedResponse({ type: BrandResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid fields or client-supplied ownership',
  })
  @ApiConflictResponse({
    description: 'Organization required or duplicate brand slug',
  })
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    return {
      brand: await this.service.createBrand(
        req.user!.id,
        validate(brandInput, body),
      ),
    };
  }
  @Get()
  @ApiOkResponse({
    type: BrandsResponseDto,
    description: 'Only the current owner brands, empty list if none',
  })
  async list(@Req() req: AuthRequest) {
    return { brands: await this.service.brands(req.user!.id) };
  }
  @Patch(':id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: brandUpdateBody })
  @ApiOkResponse({ type: BrandResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid ID, empty patch or unsupported fields',
  })
  @ApiNotFoundResponse({
    description: 'Unknown or foreign brand; same response',
  })
  async update(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      brand: await this.service.updateBrand(
        req.user!.id,
        brandId(id),
        validate(brandUpdateInput, body),
      ),
    };
  }
}
