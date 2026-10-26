import { ApiProperty } from '@nestjs/swagger';

export class OrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, maxLength: 120 }) name!: string;
  @ApiProperty({ type: String, maxLength: 80 }) slug!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
export class OrganizationResponseDto {
  @ApiProperty({ type: OrganizationDto, nullable: true })
  organization!: OrganizationDto | null;
}
export class BrandDto extends OrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 }) description!:
    string | null;
}
export class BrandResponseDto {
  @ApiProperty({ type: BrandDto }) brand!: BrandDto;
}
export class BrandsResponseDto {
  @ApiProperty({ type: [BrandDto] }) brands!: BrandDto[];
}
const name = { type: 'string', minLength: 1, maxLength: 120 };
const slug = {
  type: 'string',
  minLength: 1,
  maxLength: 80,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  description:
    'Optional on create; generated from name when omitted. Immutable after creation.',
};
const description = { type: 'string', maxLength: 2000, nullable: true };
export const organizationBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['name'],
  properties: { name, slug },
};
export const brandBody = {
  ...organizationBody,
  properties: { name, slug, description },
};
export const brandUpdateBody = {
  type: 'object' as const,
  additionalProperties: false,
  minProperties: 1,
  properties: { name, description },
};
