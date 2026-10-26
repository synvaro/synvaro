import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
import { nameSlug } from './validation.js';

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} as const;
const brandSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class OrganizationBrandService {
  constructor(private readonly db: DatabaseService) {}
  async createOrganization(
    ownerUserId: string,
    input: { name: string; slug?: string },
  ) {
    try {
      return await this.db.client.organization.create({
        data: {
          ownerUserId,
          name: input.name,
          slug: input.slug ?? nameSlug(input.name, 'organization'),
        },
        select: organizationSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Organization already exists or slug is unavailable',
        );
      }
      throw error;
    }
  }
  organization(ownerUserId: string) {
    return this.db.client.organization.findUnique({
      where: { ownerUserId },
      select: organizationSelect,
    });
  }
  async createBrand(
    ownerUserId: string,
    input: { name: string; slug?: string; description?: string | null },
  ) {
    const organization = await this.organization(ownerUserId);
    if (!organization)
      throw new ConflictException('Create an organization first');
    try {
      return await this.db.client.brand.create({
        data: {
          organizationId: organization.id,
          name: input.name,
          slug: input.slug ?? nameSlug(input.name, 'brand'),
          description: input.description || null,
        },
        select: brandSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Brand slug already exists in your organization',
        );
      }
      throw error;
    }
  }
  brands(ownerUserId: string) {
    return this.db.client.brand.findMany({
      where: { organization: { ownerUserId } },
      select: brandSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async updateBrand(
    ownerUserId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ) {
    try {
      // Ownership is part of the write predicate, never only a prior authorization check.
      return await this.db.client.brand.update({
        where: { id, organization: { ownerUserId } },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description || null }
            : {}),
        },
        select: brandSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException('Brand not found');
      throw error;
    }
  }
}
