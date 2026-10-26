import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
const summary = {
  id: true,
  brandId: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
@Injectable()
export class ContentService {
  constructor(private readonly db: DatabaseService) {}
  async create(
    ownerUserId: string,
    input: { brandId: string; title: string; body?: string },
  ) {
    try {
      return await this.db.client.content.create({
        data: {
          title: input.title,
          body: input.body ?? '',
          // Scoped relation connect enforces ownership as part of creation.
          brand: {
            connect: { id: input.brandId, organization: { ownerUserId } },
          },
        },
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
  async list(ownerUserId: string, brandId: string) {
    const brand = await this.db.client.brand.findFirst({
      where: { id: brandId, organization: { ownerUserId } },
      select: { id: true },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return this.db.client.content.findMany({
      where: { brandId, brand: { organization: { ownerUserId } } },
      select: summary,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }
  async read(ownerUserId: string, id: string) {
    const content = await this.db.client.content.findFirst({
      where: { id, brand: { organization: { ownerUserId } } },
    });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }
  async update(
    ownerUserId: string,
    id: string,
    input: { title?: string; body?: string },
  ) {
    try {
      return await this.db.client.content.update({
        where: { id, brand: { organization: { ownerUserId } } },
        data: input,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException('Content not found');
      throw error;
    }
  }
}
