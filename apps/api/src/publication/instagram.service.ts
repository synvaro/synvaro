import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@synvaro/database';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { DatabaseService } from '../auth/database.service.js';
import { LocalMediaStorage } from '../media/storage.js';
import { decryptSocial } from '../social/crypto.js';
import {
  InstagramPublisher,
  InstagramPublishError,
} from '../social/instagram-publisher.js';
import type { SocialCredential } from '../social/providers.js';

const absent = () => new NotFoundException('Publication not found');
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
  providerContainerId: true,
  containerStatus: true,
  deliveryExpiresAt: true,
  providerPostId: true,
  errorCode: true,
  createdAt: true,
  confirmedAt: true,
  completedAt: true,
} as const;
const maxBytes = 8_000_000;
const deliveryMinutes = 30;
@Injectable()
export class InstagramPublicationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly publisher: InstagramPublisher,
    private readonly storage: LocalMediaStorage,
  ) {}
  private async content(userId: string, id: string) {
    const content = await this.db.client.content.findFirst({
      where: { id, brand: { organization: { ownerUserId: userId } } },
    });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }
  private async owned(userId: string, id: string) {
    const row = await this.db.client.publication.findFirst({
      where: {
        id,
        userId,
        platform: 'INSTAGRAM',
        brand: { organization: { ownerUserId: userId } },
      },
      select: safe,
    });
    if (!row) throw absent();
    return row;
  }
  private async account(userId: string, brandId: string, id: string) {
    const row = await this.db.client.socialAccount.findFirst({
      where: {
        id,
        brandId,
        platform: 'INSTAGRAM',
        accountType: 'PROFESSIONAL',
        brand: { organization: { ownerUserId: userId } },
      },
    });
    if (!row) throw absent();
    return row;
  }
  private async image(userId: string, brandId: string, id: string) {
    const asset = await this.db.client.mediaAsset.findFirst({
      where: { id, brandId, brand: { organization: { ownerUserId: userId } } },
    });
    if (!asset) throw new NotFoundException('Media not found');
    if (
      asset.mimeType !== 'image/jpeg' ||
      asset.sizeBytes < 1 ||
      asset.sizeBytes > maxBytes
    )
      throw new BadRequestException('Instagram requires a JPEG at most 8 MB');
    let bytes: Buffer;
    try {
      const parts: Buffer[] = [];
      let length = 0;
      for await (const chunk of await this.storage.read(asset.storageKey)) {
        const part = Buffer.from(chunk);
        length += part.length;
        if (length > maxBytes) throw new Error('size');
        parts.push(part);
      }
      bytes = Buffer.concat(parts);
      if (length !== asset.sizeBytes) throw new Error('size');
      const image = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: 16_000_000,
        animated: false,
      });
      const meta = await image.metadata();
      if (
        meta.format !== 'jpeg' ||
        meta.width !== asset.width ||
        meta.height !== asset.height ||
        !meta.width ||
        !meta.height ||
        (meta.pages ?? 1) !== 1 ||
        meta.width / meta.height < 0.8 ||
        meta.width / meta.height > 1.91
      )
        throw new Error('image');
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
  private credential(account: { credentialsEncrypted: string }) {
    try {
      return decryptSocial<SocialCredential>(account.credentialsEncrypted);
    } catch {
      return null;
    }
  }
  private async eligibility(
    account: Awaited<ReturnType<InstagramPublicationService['account']>>,
  ) {
    if (
      account.status !== 'CONNECTED' ||
      (account.accessExpiresAt && account.accessExpiresAt <= new Date())
    )
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    const credential = this.credential(account);
    return credential
      ? this.publisher.readiness(
          account.externalId,
          credential.userToken ?? '',
          credential.accessToken,
          credential.pageId,
        )
      : ({ eligible: false, reason: 'REAUTHORIZE' } as const);
  }
  private deliveryConfig() {
    const origin = process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN;
    const secret = process.env.INSTAGRAM_DELIVERY_SIGNING_KEY;
    try {
      if (
        !origin ||
        !secret ||
        !/^[A-Za-z0-9+/]{43}=$/.test(secret) ||
        Buffer.from(secret, 'base64').length !== 32 ||
        Buffer.from(secret, 'base64').toString('base64') !== secret
      )
        throw new Error();
      const url = new URL(origin);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        !url.hostname.includes('.')
      )
        throw new Error();
      return { origin: url.origin, secret: Buffer.from(secret, 'base64') };
    } catch {
      throw new ServiceUnavailableException(
        'Private Instagram image delivery is not configured with public HTTPS',
      );
    }
  }
  private signature(id: string, sha: string, expiry: number, secret: Buffer) {
    return createHmac('sha256', secret)
      .update(`${id}.${sha}.${expiry}`)
      .digest('base64url');
  }
  async readiness(userId: string, contentId: string) {
    const content = await this.content(userId, contentId);
    let delivery = true;
    try {
      this.deliveryConfig();
    } catch {
      delivery = false;
    }
    const accounts = await this.db.client.socialAccount.findMany({
      where: {
        brandId: content.brandId,
        platform: 'INSTAGRAM',
        accountType: 'PROFESSIONAL',
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      deliveryConfigured: delivery,
      accounts: await Promise.all(
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
    accountId: string,
    requestId: string,
    mediaId: string,
  ) {
    const content = await this.content(userId, contentId);
    if (!content.body.trim() || content.body.length > 2200)
      throw new BadRequestException('Save a caption of 1 to 2200 characters');
    const account = await this.account(userId, content.brandId, accountId);
    const old = await this.db.client.publication.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: safe,
    });
    if (old) {
      if (
        old.platform !== 'INSTAGRAM' ||
        old.contentId !== contentId ||
        old.socialAccountId !== accountId ||
        old.mediaAssetId !== mediaId
      )
        throw new ConflictException('Request ID already used');
      return { publication: old };
    }
    this.deliveryConfig();
    const photo = await this.image(userId, content.brandId, mediaId);
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        `Reconnect Instagram with publishing permission: ${ready.reason}`,
      );
    const active = await this.db.client.publication.count({
      where: {
        platform: 'INSTAGRAM',
        contentId,
        socialAccountId: accountId,
        textSnapshot: content.body,
        mediaAssetId: mediaId,
        mediaSha256: photo.hash,
        status: { in: ['PROCESSING', 'PUBLISHING', 'UNCERTAIN'] },
      },
    });
    if (active)
      throw new ConflictException(
        'A publication for this snapshot requires resolution',
      );
    try {
      const publication = await this.db.client.publication.create({
        data: {
          userId,
          requestId,
          contentId,
          brandId: content.brandId,
          socialAccountId: accountId,
          platform: 'INSTAGRAM',
          pageId: account.externalId,
          pageName: account.displayName,
          textSnapshot: content.body,
          kind: 'IMAGE',
          mediaAssetId: mediaId,
          mediaSha256: photo.hash,
          mediaMimeType: 'image/jpeg',
          mediaSizeBytes: photo.asset.sizeBytes,
          draftUpdatedAt: content.updatedAt,
        },
        select: safe,
      });
      return { publication };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Request ID already used');
      throw error;
    }
  }
  async history(userId: string, contentId: string) {
    await this.content(userId, contentId);
    return {
      publications: await this.db.client.publication.findMany({
        where: { userId, contentId, platform: 'INSTAGRAM' },
        select: safe,
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    };
  }
  async read(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (
      row.status === 'PROCESSING' &&
      !row.providerContainerId &&
      row.confirmedAt &&
      Date.now() - row.confirmedAt.getTime() > 45_000
    ) {
      await this.db.client.publication.updateMany({
        where: { id, status: 'PROCESSING', providerContainerId: null },
        data: {
          status: 'UNCERTAIN',
          errorCode: 'INTERRUPTED',
          completedAt: new Date(),
        },
      });
      return { publication: await this.owned(userId, id) };
    }
    if (
      row.status === 'PUBLISHING' &&
      row.confirmedAt &&
      Date.now() - row.confirmedAt.getTime() > 45_000
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
  async confirm(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.status !== 'READY') return { publication: row };
    const account = await this.account(
      userId,
      row.brandId,
      row.socialAccountId,
    );
    const photo = await this.image(userId, row.brandId, row.mediaAssetId!);
    if (
      photo.hash !== row.mediaSha256 ||
      photo.asset.sizeBytes !== row.mediaSizeBytes
    )
      throw new ConflictException('Source image changed. Review it again.');
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        `Reconnect Instagram with publishing permission: ${ready.reason}`,
      );
    const config = this.deliveryConfig();
    const expiry = Math.floor(Date.now() / 1000) + deliveryMinutes * 60;
    const claimed = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${row.contentId}::uuid FOR UPDATE`;
      const draft = await tx.content.findUnique({
        where: { id: row.contentId },
      });
      if (
        !draft ||
        draft.updatedAt.getTime() !== row.draftUpdatedAt.getTime() ||
        draft.body !== row.textSnapshot
      )
        throw new ConflictException(
          'Draft changed. Review saved caption again.',
        );
      await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE id = ${row.socialAccountId}::uuid FOR UPDATE`;
      const grant = await tx.socialAccount.findUnique({
        where: { id: row.socialAccountId },
      });
      const source = await tx.mediaAsset.findUnique({
        where: { id: row.mediaAssetId! },
      });
      if (
        !grant ||
        grant.status !== 'CONNECTED' ||
        grant.brandId !== row.brandId ||
        grant.externalId !== row.pageId ||
        !source ||
        source.brandId !== row.brandId ||
        source.storageKey !== photo.asset.storageKey ||
        source.sizeBytes !== row.mediaSizeBytes
      )
        throw new ConflictException('Account or image changed. Review again.');
      const other = await tx.publication.count({
        where: {
          id: { not: id },
          platform: 'INSTAGRAM',
          contentId: row.contentId,
          socialAccountId: row.socialAccountId,
          textSnapshot: row.textSnapshot,
          mediaAssetId: row.mediaAssetId,
          mediaSha256: row.mediaSha256,
          status: { in: ['PROCESSING', 'PUBLISHING', 'UNCERTAIN'] },
        },
      });
      if (other)
        throw new ConflictException(
          'A publication for this snapshot requires resolution',
        );
      return (
        (
          await tx.publication.updateMany({
            where: { id, status: 'READY' },
            data: {
              status: 'PROCESSING',
              confirmedAt: new Date(),
              deliveryExpiresAt: new Date(expiry * 1000),
            },
          })
        ).count === 1
      );
    });
    if (!claimed) return this.read(userId, id);
    const token = this.credential(account)?.accessToken;
    if (!token) {
      await this.db.client.publication.updateMany({
        where: { id, status: 'PROCESSING' },
        data: { status: 'FAILED', errorCode: 'AUTH', completedAt: new Date() },
      });
      return this.read(userId, id);
    }
    const signature = this.signature(
      id,
      row.mediaSha256!,
      expiry,
      config.secret,
    );
    try {
      const containerId = await this.publisher.createContainer(
        row.pageId,
        token,
        `${config.origin}/instagram-delivery/${id}/${expiry}/${signature}`,
        row.textSnapshot,
      );
      await this.db.client.publication.updateMany({
        where: { id, status: 'PROCESSING' },
        data: {
          providerContainerId: containerId,
          containerStatus: 'IN_PROGRESS',
        },
      });
    } catch (error) {
      const failure =
        error instanceof InstagramPublishError
          ? error
          : new InstagramPublishError('NETWORK', true);
      await this.db.client.publication.updateMany({
        where: { id, status: 'PROCESSING' },
        data: {
          status: failure.uncertain ? 'UNCERTAIN' : 'FAILED',
          errorCode: failure.code,
          completedAt: new Date(),
        },
      });
    }
    return this.read(userId, id);
  }
  async check(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.status !== 'PROCESSING' || !row.providerContainerId)
      return { publication: row };
    const account = await this.account(
      userId,
      row.brandId,
      row.socialAccountId,
    );
    const token = this.credential(account)?.accessToken;
    if (!token || account.status !== 'CONNECTED')
      throw new ConflictException('Reconnect Instagram');
    try {
      const status = await this.publisher.containerStatus(
        row.providerContainerId,
        token,
      );
      await this.db.client.publication.updateMany({
        where: { id, status: 'PROCESSING' },
        data: {
          containerStatus: status,
          ...(status === 'ERROR' || status === 'EXPIRED'
            ? { status: 'FAILED', errorCode: status, completedAt: new Date() }
            : {}),
        },
      });
    } catch {
      /* Read-only status failure leaves the durable container intact. */
    }
    return this.read(userId, id);
  }
  async publish(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.status !== 'PROCESSING' || !row.providerContainerId)
      return { publication: row };
    const draft = await this.content(userId, row.contentId);
    if (
      draft.updatedAt.getTime() !== row.draftUpdatedAt.getTime() ||
      draft.body !== row.textSnapshot
    )
      throw new ConflictException('Draft changed. Review saved caption again.');
    const account = await this.account(
      userId,
      row.brandId,
      row.socialAccountId,
    );
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        'Reconnect Instagram with publishing permission',
      );
    const token = this.credential(account)?.accessToken;
    if (!token) throw new ConflictException('Reconnect Instagram');
    const status = await this.publisher.containerStatus(
      row.providerContainerId,
      token,
    );
    if (status !== 'FINISHED') {
      await this.db.client.publication.updateMany({
        where: { id, status: 'PROCESSING' },
        data: {
          containerStatus: status,
          ...(status === 'ERROR' || status === 'EXPIRED'
            ? { status: 'FAILED', errorCode: status, completedAt: new Date() }
            : {}),
        },
      });
      return this.read(userId, id);
    }
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
          'Draft changed. Review saved caption again.',
        );
      return (
        (
          await tx.publication.updateMany({
            where: {
              id,
              status: 'PROCESSING',
              providerContainerId: row.providerContainerId,
            },
            data: {
              status: 'PUBLISHING',
              containerStatus: 'FINISHED',
              confirmedAt: new Date(),
            },
          })
        ).count === 1
      );
    });
    if (!claimed) return this.read(userId, id);
    try {
      const postId = await this.publisher.publish(
        row.pageId,
        row.providerContainerId,
        token,
      );
      await this.db.client.publication.updateMany({
        where: { id, status: 'PUBLISHING' },
        data: {
          status: 'PUBLISHED',
          providerPostId: postId,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const failure =
        error instanceof InstagramPublishError
          ? error
          : new InstagramPublishError('NETWORK', true);
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
  async delivery(id: string, expiry: number, signature: string) {
    const row = await this.db.client.publication.findFirst({
      where: { id, platform: 'INSTAGRAM', status: 'PROCESSING' },
      select: { ...safe, userId: true },
    });
    if (
      !row ||
      !row.mediaAssetId ||
      !row.mediaSha256 ||
      !row.deliveryExpiresAt ||
      row.deliveryExpiresAt.getTime() !== expiry * 1000 ||
      expiry < Math.floor(Date.now() / 1000)
    )
      throw absent();
    const config = this.deliveryConfig();
    const expected = Buffer.from(
      this.signature(id, row.mediaSha256, expiry, config.secret),
    );
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw absent();
    const photo = await this.image(row.userId, row.brandId, row.mediaAssetId);
    if (
      photo.hash !== row.mediaSha256 ||
      photo.asset.sizeBytes !== row.mediaSizeBytes
    )
      throw absent();
    return photo.bytes;
  }
}
