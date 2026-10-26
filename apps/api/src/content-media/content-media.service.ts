import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
import { mediaSelect } from '../media/media.service.js';
const missing = () => new NotFoundException('Content media not found');
@Injectable()
export class ContentMediaService {
  constructor(private readonly db: DatabaseService) {}
  private rows(tx: Prisma.TransactionClient, contentId: string) {
    return tx.contentMedia.findMany({
      where: { contentId },
      select: {
        contentId: true,
        mediaAssetId: true,
        position: true,
        createdAt: true,
        asset: { select: mediaSelect },
      },
      orderBy: [{ position: 'asc' }, { mediaAssetId: 'asc' }],
    });
  }
  async list(ownerUserId: string, contentId: string) {
    return this.db.client.$transaction(async (tx) => {
      const content = await tx.content.findFirst({
        where: { id: contentId, brand: { organization: { ownerUserId } } },
        select: { id: true },
      });
      if (!content) throw missing();
      return this.rows(tx, contentId);
    });
  }
  private change(
    ownerUserId: string,
    contentId: string,
    action: (tx: Prisma.TransactionClient, brandId: string) => Promise<void>,
  ) {
    return this.db.client.$transaction(async (tx) => {
      // Every attachment mutation takes the same parent lock before reading membership.
      const parents = await tx.$queryRaw<{ brandId: string }[]>`
        SELECT c."brandId" FROM "Content" c
        JOIN "Brand" b ON b.id = c."brandId"
        JOIN "Organization" o ON o.id = b."organizationId"
        WHERE c.id = ${contentId}::uuid AND o."ownerUserId" = ${ownerUserId}::uuid
        FOR UPDATE OF c`;
      if (!parents[0]) throw missing();
      await action(tx, parents[0].brandId);
      return this.rows(tx, contentId);
    });
  }
  attach(ownerUserId: string, contentId: string, mediaAssetId: string) {
    return this.change(ownerUserId, contentId, async (tx, brandId) => {
      if (
        !(await tx.mediaAsset.findFirst({
          where: { id: mediaAssetId, brandId },
          select: { id: true },
        }))
      )
        throw missing();
      if (
        await tx.contentMedia.findUnique({
          where: { contentId_mediaAssetId: { contentId, mediaAssetId } },
        })
      )
        throw new ConflictException('Media is already attached');
      const position = await tx.contentMedia.count({ where: { contentId } });
      await tx.contentMedia.create({
        data: { contentId, mediaAssetId, position },
      });
    });
  }
  reorder(ownerUserId: string, contentId: string, ids: string[]) {
    return this.change(ownerUserId, contentId, async (tx) => {
      const current = await tx.contentMedia.findMany({
        where: { contentId },
        select: { mediaAssetId: true },
      });
      const members = new Set(current.map((row) => row.mediaAssetId));
      if (ids.some((id) => !members.has(id))) throw missing();
      if (ids.length !== members.size)
        throw new ConflictException(
          'Attachments changed. Reload the attached media list and try again.',
        );
      for (const [position, mediaAssetId] of ids.entries())
        await tx.contentMedia.update({
          where: { contentId_mediaAssetId: { contentId, mediaAssetId } },
          data: { position },
        });
    });
  }
  detach(ownerUserId: string, contentId: string, mediaAssetId: string) {
    return this.change(ownerUserId, contentId, async (tx) => {
      const deleted = await tx.contentMedia.deleteMany({
        where: { contentId, mediaAssetId },
      });
      if (!deleted.count) throw missing();
      const remaining = await this.rows(tx, contentId);
      for (const [position, row] of remaining.entries())
        await tx.contentMedia.update({
          where: {
            contentId_mediaAssetId: {
              contentId,
              mediaAssetId: row.mediaAssetId,
            },
          },
          data: { position },
        });
    });
  }
}
