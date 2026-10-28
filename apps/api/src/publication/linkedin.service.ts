import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@synvaro/database';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DatabaseService } from '../auth/database.service.js';
import { LocalMediaStorage } from '../media/storage.js';
import { decryptSocial } from '../social/crypto.js';
import type { SocialCredential } from '../social/providers.js';
import {
  LinkedInPublisher,
  LinkedInPublishError,
  escapeLinkedInText,
} from '../social/linkedin-publisher.js';

const missing = () => new NotFoundException('Publication not found');
const safe = {
  id: true,
  requestId: true,
  contentId: true,
  brandId: true,
  socialAccountId: true,
  platform: true,
  pageId: true,
  pageName: true,
  textSnapshot: true,
  kind: true,
  mediaAssetId: true,
  mediaSha256: true,
  mediaMimeType: true,
  mediaSizeBytes: true,
  draftUpdatedAt: true,
  status: true,
  providerImageUrn: true,
  imageUploadStage: true,
  providerPostId: true,
  errorCode: true,
  reconciledAt: true,
  createdAt: true,
  confirmedAt: true,
  completedAt: true,
} as const;
const maxImage = 10_000_000;
const maxText = 2800; // Conservative local cap; provider may reject a smaller account-specific limit.

@Injectable()
export class LinkedInPublicationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: LocalMediaStorage,
    private readonly publisher: LinkedInPublisher,
  ) {}
  private async content(userId: string, id: string) {
    const row = await this.db.client.content.findFirst({
      where: { id, brand: { organization: { ownerUserId: userId } } },
    });
    if (!row) throw new NotFoundException('Content not found');
    return row;
  }
  private async account(userId: string, brandId: string, id: string) {
    const row = await this.db.client.socialAccount.findFirst({
      where: { id, brandId, brand: { organization: { ownerUserId: userId } } },
    });
    if (!row || row.platform !== 'LINKEDIN' || row.accountType !== 'MEMBER')
      throw missing();
    return row;
  }
  private async photo(userId: string, brandId: string, id: string) {
    const asset = await this.db.client.mediaAsset.findFirst({
      where: { id, brandId, brand: { organization: { ownerUserId: userId } } },
    });
    if (!asset) throw new NotFoundException('Media not found');
    if (
      !['image/jpeg', 'image/png'].includes(asset.mimeType) ||
      asset.sizeBytes < 1 ||
      asset.sizeBytes > maxImage
    )
      throw new BadRequestException(
        'LinkedIn image must be JPEG or PNG, at most 10 MB',
      );
    let bytes: Buffer;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of await this.storage.read(asset.storageKey)) {
        const part = Buffer.from(chunk);
        size += part.length;
        if (size > maxImage) throw new Error();
        chunks.push(part);
      }
      bytes = Buffer.concat(chunks);
      if (bytes.length !== asset.sizeBytes) throw new Error();
      const image = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: 16_000_000,
        animated: false,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !==
          (asset.mimeType === 'image/jpeg' ? 'jpeg' : 'png') ||
        metadata.width !== asset.width ||
        metadata.height !== asset.height ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error();
      await image.stats();
    } catch {
      throw new ConflictException(
        'Source image is missing or invalid; review media again',
      );
    }
    return {
      asset,
      bytes,
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  private async eligibility(
    account: Awaited<ReturnType<LinkedInPublicationService['account']>>,
  ) {
    if (
      account.status !== 'CONNECTED' ||
      (account.accessExpiresAt && account.accessExpiresAt <= new Date())
    )
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    if (!account.scopes.includes('w_member_social'))
      return { eligible: false, reason: 'PUBLISH_PERMISSION_MISSING' } as const;
    if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET)
      return { eligible: false, reason: 'NOT_CONFIGURED' } as const;
    try {
      const token = decryptSocial<SocialCredential>(
        account.credentialsEncrypted,
      ).accessToken;
      return this.publisher.readiness(account.externalId, token);
    } catch {
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    }
  }
  async readiness(userId: string, contentId: string) {
    const content = await this.content(userId, contentId);
    const accounts = await this.db.client.socialAccount.findMany({
      where: {
        brandId: content.brandId,
        platform: 'LINKEDIN',
        accountType: 'MEMBER',
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      members: await Promise.all(
        accounts.map(async (account) => ({
          id: account.id,
          displayName: account.displayName,
          externalId: account.externalId,
          status: account.status,
          ...(await this.eligibility(account)),
        })),
      ),
    };
  }
  async prepare(
    userId: string,
    contentId: string,
    socialAccountId: string,
    requestId: string,
    mediaAssetId?: string,
  ) {
    const content = await this.content(userId, contentId);
    if (
      !content.body.trim() ||
      content.body.length > maxText ||
      escapeLinkedInText(content.body).length > maxText
    )
      throw new BadRequestException(`Save text of 1 to ${maxText} characters`);
    const account = await this.account(
      userId,
      content.brandId,
      socialAccountId,
    );
    const previous = await this.db.client.publication.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: safe,
    });
    if (previous) {
      if (
        previous.platform !== 'LINKEDIN' ||
        previous.contentId !== contentId ||
        previous.socialAccountId !== socialAccountId ||
        previous.mediaAssetId !== (mediaAssetId ?? null)
      )
        throw new ConflictException('Request ID already used');
      return { publication: previous };
    }
    const photo = mediaAssetId
      ? await this.photo(userId, content.brandId, mediaAssetId)
      : null;
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        `Reconnect LinkedIn with publishing permission: ${ready.reason}`,
      );
    const active = await this.db.client.publication.count({
      where: {
        platform: 'LINKEDIN',
        contentId,
        socialAccountId,
        textSnapshot: content.body,
        kind: photo ? 'IMAGE' : 'TEXT',
        mediaAssetId: photo?.asset.id ?? null,
        mediaSha256: photo?.hash ?? null,
        status: { in: ['PUBLISHING', 'UNCERTAIN'] },
      },
    });
    if (active)
      throw new ConflictException(
        'A publication for this snapshot requires resolution',
      );
    try {
      return {
        publication: await this.db.client.publication.create({
          data: {
            userId,
            contentId,
            brandId: content.brandId,
            socialAccountId,
            requestId,
            platform: 'LINKEDIN',
            pageId: account.externalId,
            pageName: account.displayName,
            textSnapshot: content.body,
            kind: photo ? 'IMAGE' : 'TEXT',
            mediaAssetId: photo?.asset.id,
            mediaSha256: photo?.hash,
            mediaMimeType: photo?.asset.mimeType,
            mediaSizeBytes: photo?.asset.sizeBytes,
            draftUpdatedAt: content.updatedAt,
          },
          select: safe,
        }),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Request ID already used');
      throw error;
    }
  }
  private async owned(userId: string, id: string) {
    const row = await this.db.client.publication.findFirst({
      where: {
        id,
        userId,
        platform: 'LINKEDIN',
        brand: { organization: { ownerUserId: userId } },
      },
      select: safe,
    });
    if (!row) throw missing();
    return row;
  }
  async read(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (
      row.status === 'PUBLISHING' &&
      row.confirmedAt &&
      Date.now() - row.confirmedAt.getTime() > 120_000
    ) {
      await this.db.client.publication.updateMany({
        where: { id, status: 'PUBLISHING' },
        data: {
          status: 'UNCERTAIN',
          errorCode: 'INTERRUPTED',
          completedAt: new Date(),
        },
      });
      return { publication: await this.owned(userId, id) };
    }
    return { publication: row };
  }
  async history(userId: string, contentId: string) {
    await this.content(userId, contentId);
    return {
      publications: await this.db.client.publication.findMany({
        where: { userId, contentId, platform: 'LINKEDIN' },
        select: safe,
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    };
  }
  async confirm(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.status !== 'READY') return { publication: row };
    const account = await this.account(
      userId,
      row.brandId,
      row.socialAccountId,
    );
    const photo = row.mediaAssetId
      ? await this.photo(userId, row.brandId, row.mediaAssetId)
      : null;
    if (
      row.kind === 'IMAGE' &&
      (!photo ||
        photo.hash !== row.mediaSha256 ||
        photo.asset.mimeType !== row.mediaMimeType ||
        photo.asset.sizeBytes !== row.mediaSizeBytes)
    )
      throw new ConflictException('Source image changed. Review it again.');
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        `Reconnect LinkedIn with publishing permission: ${ready.reason}`,
      );
    let token = '';
    const claimed = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${row.contentId}::uuid FOR UPDATE`;
      const fresh = await tx.content.findUnique({
        where: { id: row.contentId },
      });
      if (
        !fresh ||
        fresh.updatedAt.getTime() !== row.draftUpdatedAt.getTime() ||
        fresh.body !== row.textSnapshot
      )
        throw new ConflictException(
          'Draft changed. Review the saved text again.',
        );
      const other = await tx.publication.count({
        where: {
          platform: 'LINKEDIN',
          contentId: row.contentId,
          socialAccountId: row.socialAccountId,
          textSnapshot: row.textSnapshot,
          kind: row.kind,
          mediaAssetId: row.mediaAssetId,
          mediaSha256: row.mediaSha256,
          id: { not: id },
          status: { in: ['PUBLISHING', 'UNCERTAIN'] },
        },
      });
      if (other)
        throw new ConflictException(
          'A publication for this snapshot requires resolution',
        );
      await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE id = ${row.socialAccountId}::uuid FOR UPDATE`;
      const grant = await tx.socialAccount.findUnique({
        where: { id: row.socialAccountId },
      });
      if (
        !grant ||
        grant.status !== 'CONNECTED' ||
        grant.brandId !== row.brandId ||
        grant.externalId !== row.pageId ||
        !grant.scopes.includes('w_member_social') ||
        (grant.accessExpiresAt && grant.accessExpiresAt <= new Date())
      )
        throw new ConflictException('LinkedIn member authorization changed');
      if (photo) {
        const asset = await tx.mediaAsset.findUnique({
          where: { id: photo.asset.id },
        });
        if (
          !asset ||
          asset.brandId !== row.brandId ||
          asset.storageKey !== photo.asset.storageKey ||
          asset.sizeBytes !== row.mediaSizeBytes ||
          asset.mimeType !== row.mediaMimeType
        )
          throw new ConflictException('Source image changed. Review it again.');
      }
      const updated = await tx.publication.updateMany({
        where: { id, status: 'READY' },
        data: { status: 'PUBLISHING', confirmedAt: new Date() },
      });
      if (updated.count !== 1) return false;
      token = decryptSocial<SocialCredential>(
        grant.credentialsEncrypted,
      ).accessToken;
      return true;
    });
    if (!claimed) return this.read(userId, id);
    const author = `urn:li:person:${row.pageId}`;
    try {
      let image: string | undefined;
      if (photo) {
        const initialized = await this.publisher.initializeImage(author, token);
        image = initialized.urn;
        await this.db.client.publication.update({
          where: { id },
          data: {
            providerImageUrn: image,
            imageUploadStage: 'INITIALIZED',
          },
        });
        await this.publisher.uploadImage(
          initialized.url,
          token,
          photo.bytes,
          photo.asset.mimeType as 'image/jpeg' | 'image/png',
        );
        await this.db.client.publication.update({
          where: { id },
          data: { imageUploadStage: 'UPLOADED' },
        });
        await this.publisher.imageReady(image, token, author);
        await this.db.client.publication.update({
          where: { id },
          data: { imageUploadStage: 'AVAILABLE' },
        });
      }
      const postId = await this.publisher.publish(
        author,
        token,
        row.textSnapshot,
        image,
      );
      await this.db.client.publication.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          providerPostId: postId,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const failure =
        error instanceof LinkedInPublishError
          ? error
          : new LinkedInPublishError('NETWORK', true);
      await this.db.client.publication.updateMany({
        where: { id, status: 'PUBLISHING' },
        data: {
          status: failure.uncertain ? 'UNCERTAIN' : 'FAILED',
          errorCode: failure.code,
          completedAt: new Date(),
        },
      });
    }
    return this.read(userId, id);
  }
}
