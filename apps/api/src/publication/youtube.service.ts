import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@synvaro/database';
import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { DatabaseService } from '../auth/database.service.js';
import { inspectMedia, MAX_FILE_BYTES } from '../media/inspect.js';
import { LocalMediaStorage } from '../media/storage.js';
import { decryptSocial, encryptSocial } from '../social/crypto.js';
import type { SocialCredential } from '../social/providers.js';
import {
  YouTubePublisher,
  YouTubePublishError,
  videoId,
} from '../social/youtube-publisher.js';

const missing = () => new NotFoundException('Publication not found');
const uploadScope = 'https://www.googleapis.com/auth/youtube.upload';
const readScope = 'https://www.googleapis.com/auth/youtube.readonly';
const chunkSize = 8 * 1024 * 1024; // multiple of Google's required 256 KiB
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
  youtubeTitle: true,
  youtubePrivacy: true,
  youtubeUploadedBytes: true,
  youtubeWidth: true,
  youtubeHeight: true,
  youtubeDurationMs: true,
  youtubeProcessingStatus: true,
  youtubeLastProbeAt: true,
  kind: true,
  mediaAssetId: true,
  mediaSha256: true,
  mediaSizeBytes: true,
  draftUpdatedAt: true,
  status: true,
  providerPostId: true,
  errorCode: true,
  createdAt: true,
  confirmedAt: true,
  completedAt: true,
} as const;
const shortHint = (
  width: number | null,
  height: number | null,
  duration: number | null,
) =>
  !!width && !!height && !!duration && width <= height && duration <= 180_000;

@Injectable()
export class YouTubePublicationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: LocalMediaStorage,
    private readonly publisher: YouTubePublisher,
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
    if (!row || row.platform !== 'YOUTUBE' || row.accountType !== 'CHANNEL')
      throw missing();
    return row;
  }
  private async source(userId: string, brandId: string, id: string) {
    const asset = await this.db.client.mediaAsset.findFirst({
      where: { id, brandId, brand: { organization: { ownerUserId: userId } } },
    });
    if (!asset) throw new NotFoundException('Media not found');
    if (
      asset.mimeType !== 'video/mp4' ||
      asset.sizeBytes < 1 ||
      asset.sizeBytes > MAX_FILE_BYTES
    )
      throw new BadRequestException('Select an MP4 video at most 20 MiB');
    try {
      const path = await this.storage.path(asset.storageKey);
      if ((await stat(path)).size !== asset.sizeBytes) throw new Error();
      const inspected = await inspectMedia(path);
      if (
        inspected.mimeType !== 'video/mp4' ||
        inspected.width !== asset.width ||
        inspected.height !== asset.height ||
        inspected.durationMs !== asset.durationMs
      )
        throw new Error();
      const digest = createHash('sha256');
      let size = 0;
      for await (const part of await this.storage.read(asset.storageKey)) {
        size += Buffer.byteLength(part);
        if (size > MAX_FILE_BYTES) throw new Error();
        digest.update(part);
      }
      if (size !== asset.sizeBytes) throw new Error();
      return {
        asset,
        hash: digest.digest('hex'),
        width: inspected.width!,
        height: inspected.height!,
        durationMs: inspected.durationMs!,
      };
    } catch {
      throw new ConflictException(
        'Source video is missing or invalid; review it again',
      );
    }
  }
  private async eligibility(
    account: Awaited<ReturnType<YouTubePublicationService['account']>>,
  ) {
    if (
      account.status !== 'CONNECTED' ||
      (account.accessExpiresAt && account.accessExpiresAt <= new Date())
    )
      return { eligible: false, reason: 'REAUTHORIZE' } as const;
    if (
      !account.scopes.includes(uploadScope) ||
      !account.scopes.includes(readScope)
    )
      return { eligible: false, reason: 'PUBLISH_PERMISSION_MISSING' } as const;
    if (
      !process.env.GOOGLE_OAUTH_CLIENT_ID ||
      !process.env.GOOGLE_OAUTH_CLIENT_SECRET
    )
      return { eligible: false, reason: 'NOT_CONFIGURED' } as const;
    try {
      const token = decryptSocial<SocialCredential>(
        account.credentialsEncrypted,
      ).accessToken;
      const matched = await this.publisher.readiness(account.externalId, token);
      return matched
        ? ({
            eligible: true,
            reason: null,
            productAccessVerified: false,
          } as const)
        : ({ eligible: false, reason: 'CHANNEL_MISMATCH' } as const);
    } catch (error) {
      return {
        eligible: false,
        reason:
          error instanceof YouTubePublishError &&
          error.category === 'PERMISSION'
            ? 'PRODUCT_ACCESS_REQUIRED'
            : 'REAUTHORIZE',
      } as const;
    }
  }
  async readiness(userId: string, contentId: string) {
    const content = await this.content(userId, contentId);
    const accounts = await this.db.client.socialAccount.findMany({
      where: {
        brandId: content.brandId,
        platform: 'YOUTUBE',
        accountType: 'CHANNEL',
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      channels: await Promise.all(
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
  private validateMetadata(title: string, description: string) {
    if (!title.trim() || [...title].length > 100 || /[<>]/.test(title))
      throw new BadRequestException(
        'YouTube title must contain 1–100 characters without angle brackets',
      );
    if (
      Buffer.byteLength(description, 'utf8') > 5000 ||
      /[<>]/.test(description)
    )
      throw new BadRequestException(
        'YouTube description must be at most 5000 UTF-8 bytes without angle brackets',
      );
  }
  async prepare(
    userId: string,
    contentId: string,
    accountId: string,
    mediaId: string,
    title: string,
    privacy: 'private' | 'unlisted' | 'public',
    requestId: string,
  ) {
    const content = await this.content(userId, contentId);
    this.validateMetadata(title, content.body);
    const account = await this.account(userId, content.brandId, accountId);
    const previous = await this.db.client.publication.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: safe,
    });
    if (previous) {
      if (
        previous.platform !== 'YOUTUBE' ||
        previous.contentId !== contentId ||
        previous.socialAccountId !== accountId ||
        previous.mediaAssetId !== mediaId ||
        previous.youtubeTitle !== title ||
        previous.youtubePrivacy !== privacy
      )
        throw new ConflictException('Request ID already used');
      return {
        publication: {
          ...previous,
          shortsEligible: shortHint(
            previous.youtubeWidth,
            previous.youtubeHeight,
            previous.youtubeDurationMs,
          ),
        },
      };
    }
    const source = await this.source(userId, content.brandId, mediaId);
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        `Reconnect YouTube with upload permission: ${ready.reason}`,
      );
    const active = await this.db.client.publication.count({
      where: {
        platform: 'YOUTUBE',
        contentId,
        socialAccountId: accountId,
        mediaAssetId: mediaId,
        mediaSha256: source.hash,
        textSnapshot: content.body,
        youtubeTitle: title,
        youtubePrivacy: privacy,
        status: { in: ['PUBLISHING', 'UNCERTAIN', 'PROCESSING'] },
      },
    });
    if (active)
      throw new ConflictException('A matching upload requires resolution');
    try {
      const publication = await this.db.client.publication.create({
        data: {
          userId,
          contentId,
          brandId: content.brandId,
          socialAccountId: accountId,
          requestId,
          platform: 'YOUTUBE',
          pageId: account.externalId,
          pageName: account.displayName,
          textSnapshot: content.body,
          youtubeTitle: title,
          youtubePrivacy: privacy,
          kind: 'VIDEO',
          mediaAssetId: mediaId,
          mediaSha256: source.hash,
          mediaMimeType: 'video/mp4',
          mediaSizeBytes: source.asset.sizeBytes,
          youtubeWidth: source.width,
          youtubeHeight: source.height,
          youtubeDurationMs: source.durationMs,
          draftUpdatedAt: content.updatedAt,
        },
        select: safe,
      });
      return {
        publication: {
          ...publication,
          shortsEligible: shortHint(
            source.width,
            source.height,
            source.durationMs,
          ),
        },
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
        platform: 'YOUTUBE',
        brand: { organization: { ownerUserId: userId } },
      },
      select: safe,
    });
    if (!row) throw missing();
    return row;
  }
  async read(userId: string, id: string) {
    // A slow but live PUT may exceed five minutes. Reading status must never
    // transfer ownership or make the same session resumable.
    const row = await this.owned(userId, id);
    return {
      publication: {
        ...row,
        shortsEligible: shortHint(
          row.youtubeWidth,
          row.youtubeHeight,
          row.youtubeDurationMs,
        ),
        watchUrl:
          ['PROCESSING', 'PUBLISHED'].includes(row.status) &&
          row.providerPostId &&
          videoId(row.providerPostId)
            ? `https://www.youtube.com/watch?v=${row.providerPostId}`
            : null,
      },
    };
  }
  async history(userId: string, contentId: string) {
    await this.content(userId, contentId);
    const rows = await this.db.client.publication.findMany({
      where: { userId, contentId, platform: 'YOUTUBE' },
      select: safe,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      publications: rows.map((row) => ({
        ...row,
        shortsEligible: shortHint(
          row.youtubeWidth,
          row.youtubeHeight,
          row.youtubeDurationMs,
        ),
        watchUrl:
          ['PROCESSING', 'PUBLISHED'].includes(row.status) &&
          row.providerPostId &&
          videoId(row.providerPostId)
            ? `https://www.youtube.com/watch?v=${row.providerPostId}`
            : null,
      })),
    };
  }
  private async confirmedSource(
    userId: string,
    row: Awaited<ReturnType<YouTubePublicationService['owned']>>,
  ) {
    if (!row.mediaAssetId) throw missing();
    const source = await this.source(userId, row.brandId, row.mediaAssetId);
    if (
      source.hash !== row.mediaSha256 ||
      source.asset.sizeBytes !== row.mediaSizeBytes ||
      source.width !== row.youtubeWidth ||
      source.height !== row.youtubeHeight ||
      source.durationMs !== row.youtubeDurationMs
    )
      throw new ConflictException('Source video changed. Review it again.');
    return source;
  }
  private async claim(
    userId: string,
    row: Awaited<ReturnType<YouTubePublicationService['owned']>>,
    resume: boolean,
  ) {
    const account = await this.account(
      userId,
      row.brandId,
      row.socialAccountId,
    );
    const sourceCheck = await this.confirmedSource(userId, row);
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(
        `Reconnect YouTube with upload permission: ${ready.reason}`,
      );
    const owner = randomUUID();
    const claimed = await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${row.contentId}::uuid FOR UPDATE`;
      const content = await tx.content.findUnique({
        where: { id: row.contentId },
      });
      if (
        !content ||
        content.updatedAt.getTime() !== row.draftUpdatedAt.getTime() ||
        content.body !== row.textSnapshot ||
        !row.youtubeTitle
      )
        throw new ConflictException(
          'Draft changed. Review saved metadata again.',
        );
      const other = await tx.publication.count({
        where: {
          platform: 'YOUTUBE',
          contentId: row.contentId,
          socialAccountId: row.socialAccountId,
          mediaAssetId: row.mediaAssetId,
          mediaSha256: row.mediaSha256,
          textSnapshot: row.textSnapshot,
          youtubeTitle: row.youtubeTitle,
          youtubePrivacy: row.youtubePrivacy,
          id: { not: row.id },
          status: { in: ['PUBLISHING', 'UNCERTAIN', 'PROCESSING'] },
        },
      });
      if (other)
        throw new ConflictException('A matching upload requires resolution');
      await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE id = ${row.socialAccountId}::uuid FOR UPDATE`;
      const grant = await tx.socialAccount.findUnique({
        where: { id: row.socialAccountId },
      });
      if (
        !grant ||
        grant.status !== 'CONNECTED' ||
        grant.brandId !== row.brandId ||
        grant.externalId !== row.pageId ||
        !grant.scopes.includes(uploadScope) ||
        !grant.scopes.includes(readScope) ||
        (grant.accessExpiresAt && grant.accessExpiresAt <= new Date())
      )
        throw new ConflictException('YouTube authorization changed');
      const source = await tx.mediaAsset.findUnique({
        where: { id: row.mediaAssetId! },
      });
      if (
        !source ||
        source.brandId !== row.brandId ||
        source.sizeBytes !== row.mediaSizeBytes ||
        source.mimeType !== 'video/mp4'
      )
        throw new ConflictException('Source video changed. Review it again.');
      const updated = await tx.publication.updateMany({
        where: {
          id: row.id,
          status: resume ? 'UNCERTAIN' : 'READY',
          providerPostId: null,
          youtubeTransferOwner: null,
        },
        data: {
          status: 'PUBLISHING',
          confirmedAt: new Date(),
          youtubeTransferOwner: owner,
          // Diagnostic only. Expiry never grants automatic takeover: an HTTP
          // PUT may still be in flight when this timestamp passes.
          youtubeTransferLeaseUntil: new Date(Date.now() + 300_000),
        },
      });
      return updated.count === 1
        ? decryptSocial<SocialCredential>(grant.credentialsEncrypted)
            .accessToken
        : null;
    });
    return {
      claimed: !!claimed,
      token: claimed ?? '',
      source: sourceCheck,
      owner,
    };
  }
  private async assertOwner(id: string, owner: string) {
    const current = await this.db.client.publication.findUnique({
      where: { id },
      select: {
        youtubeTransferOwner: true,
        status: true,
        providerPostId: true,
      },
    });
    if (
      current?.youtubeTransferOwner !== owner ||
      current.status !== 'PUBLISHING' ||
      current.providerPostId
    )
      throw new ConflictException('Upload ownership changed');
  }
  private async ownedUpdate(
    id: string,
    owner: string,
    data: Prisma.PublicationUpdateManyMutationInput,
  ) {
    const result = await this.db.client.publication.updateMany({
      where: { id, youtubeTransferOwner: owner, status: 'PUBLISHING' },
      data,
    });
    if (result.count !== 1)
      throw new ConflictException('Upload ownership changed');
  }
  private async settle(
    id: string,
    video: string,
    token: string,
    channel: string,
    privacy: string,
    owner?: string,
  ) {
    const where = { id, youtubeTransferOwner: owner ?? null };
    const publication = await this.db.client.publication.findUniqueOrThrow({
      where: { id },
      select: { mediaSizeBytes: true },
    });
    // Commit the provider ID and release the write owner before the read-only
    // verification call. A crash here must leave a checkable, non-resumable row.
    const persisted = owner
      ? await this.db.client.publication.updateMany({
          where: { ...where, status: 'PUBLISHING', providerPostId: null },
          data: {
            providerPostId: video,
            youtubeUploadedBytes: publication.mediaSizeBytes ?? 0,
            youtubeLastProbeAt: new Date(),
            status: 'UNCERTAIN',
            errorCode: 'VERIFICATION_PENDING',
            youtubeTransferOwner: null,
            youtubeTransferLeaseUntil: null,
          },
        })
      : await this.db.client.publication.updateMany({
          where: {
            ...where,
            providerPostId: video,
            status: { in: ['PUBLISHING', 'UNCERTAIN', 'PROCESSING'] },
          },
          data: {
            youtubeLastProbeAt: new Date(),
            status: 'UNCERTAIN',
            errorCode: 'VERIFICATION_PENDING',
          },
        });
    if (persisted.count !== 1)
      throw new ConflictException('Upload ownership changed');
    let processing: 'succeeded' | 'processing' | 'failed';
    try {
      processing = await this.publisher.verify(video, channel, privacy, token);
    } catch (error) {
      await this.db.client.publication.updateMany({
        where: {
          id,
          providerPostId: video,
          status: 'UNCERTAIN',
          youtubeTransferOwner: null,
        },
        data: {
          errorCode:
            error instanceof YouTubePublishError ? error.category : 'NETWORK',
        },
      });
      throw error;
    }
    const updated = await this.db.client.publication.updateMany({
      where: {
        id,
        youtubeTransferOwner: null,
        providerPostId: video,
        status: 'UNCERTAIN',
      },
      data: {
        providerPostId: video,
        youtubeUploadedBytes: publication.mediaSizeBytes ?? 0,
        youtubeProcessingStatus: processing.toUpperCase(),
        status:
          processing === 'succeeded'
            ? 'PUBLISHED'
            : processing === 'failed'
              ? 'FAILED'
              : 'PROCESSING',
        errorCode: processing === 'failed' ? 'PROCESSING_FAILED' : null,
        completedAt: processing === 'processing' ? null : new Date(),
        youtubeTransferOwner: null,
        youtubeTransferLeaseUntil: null,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('Upload ownership changed');
  }
  private async transfer(
    id: string,
    session: string,
    token: string,
    source: Awaited<ReturnType<YouTubePublicationService['source']>>,
    channel: string,
    privacy: string,
    offset: number,
    owner: string,
  ) {
    const size = source.asset.sizeBytes;
    while (offset < size) {
      await this.assertOwner(id, owner);
      const end = Math.min(offset + chunkSize, size) - 1;
      const stream = await this.storage.read(
        source.asset.storageKey,
        offset,
        end,
      );
      try {
        const result = await this.publisher.upload(
          session,
          token,
          stream,
          offset,
          end,
          size,
        );
        if (result.kind === 'COMPLETE') {
          await this.settle(id, result.videoId, token, channel, privacy, owner);
          return;
        }
        if (result.offset <= offset || result.offset > end + 1)
          throw new YouTubePublishError('MALFORMED', true);
        offset = result.offset;
        await this.ownedUpdate(id, owner, { youtubeUploadedBytes: offset });
      } finally {
        stream.destroy();
      }
    }
    // A final 308 with all bytes acknowledged is not proof of a video ID.
    throw new YouTubePublishError('MALFORMED', true);
  }
  private async execute(
    userId: string,
    row: Awaited<ReturnType<YouTubePublicationService['owned']>>,
    resume: boolean,
  ) {
    const { claimed, token, source, owner } = await this.claim(
      userId,
      row,
      resume,
    );
    if (!claimed) return this.read(userId, row.id);
    let sessionKnown = resume;
    try {
      let session: string;
      let offset = 0;
      if (resume) {
        await this.assertOwner(row.id, owner);
        const current = await this.db.client.publication.findUniqueOrThrow({
          where: { id: row.id },
        });
        if (!current.youtubeSessionEncrypted)
          throw new ConflictException(
            'Upload session is unknown; operator evidence required',
          );
        session = decryptSocial<{ uri: string }>(
          current.youtubeSessionEncrypted,
        ).uri;
        await this.assertOwner(row.id, owner);
        const progress = await this.publisher.probe(
          session,
          token,
          source.asset.sizeBytes,
        );
        await this.ownedUpdate(row.id, owner, {
          youtubeLastProbeAt: new Date(),
        });
        if (progress.kind === 'COMPLETE') {
          await this.settle(
            row.id,
            progress.videoId,
            token,
            row.pageId,
            row.youtubePrivacy!,
            owner,
          );
          return this.read(userId, row.id);
        }
        offset = progress.offset;
        await this.ownedUpdate(row.id, owner, { youtubeUploadedBytes: offset });
      } else {
        await this.assertOwner(row.id, owner);
        session = await this.publisher.initiate(
          token,
          {
            title: row.youtubeTitle!,
            description: row.textSnapshot,
            privacy: row.youtubePrivacy!,
          },
          source.asset.sizeBytes,
        );
        await this.ownedUpdate(row.id, owner, {
          youtubeSessionEncrypted: encryptSocial({ uri: session }),
        });
        sessionKnown = true;
      }
      await this.assertOwner(row.id, owner);
      await this.transfer(
        row.id,
        session,
        token,
        source,
        row.pageId,
        row.youtubePrivacy!,
        offset,
        owner,
      );
    } catch (error) {
      const failure =
        error instanceof YouTubePublishError
          ? error
          : new YouTubePublishError('NETWORK', true);
      await this.db.client.publication.updateMany({
        where: {
          id: row.id,
          status: 'PUBLISHING',
          youtubeTransferOwner: owner,
        },
        data: {
          status: !failure.uncertain && !sessionKnown ? 'FAILED' : 'UNCERTAIN',
          errorCode: failure.category,
          youtubeTransferOwner: null,
          youtubeTransferLeaseUntil: null,
        },
      });
    }
    return this.read(userId, row.id);
  }
  async confirm(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.status !== 'READY') return this.read(userId, id);
    return this.execute(userId, row, false);
  }
  async resume(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.status !== 'UNCERTAIN') return this.read(userId, id);
    const current = await this.db.client.publication.findUniqueOrThrow({
      where: { id },
    });
    if (current.providerPostId || current.youtubeTransferOwner)
      return this.read(userId, id);
    if (!current.youtubeSessionEncrypted)
      throw new ConflictException(
        'Upload session is unknown; operator evidence required',
      );
    return this.execute(userId, row, true);
  }
  async check(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (
      !row.providerPostId ||
      !videoId(row.providerPostId) ||
      !['PUBLISHING', 'PROCESSING', 'UNCERTAIN'].includes(row.status)
    )
      return this.read(userId, id);
    const current = await this.db.client.publication.findUniqueOrThrow({
      where: { id },
    });
    if (current.youtubeTransferOwner) return this.read(userId, id);
    const account = await this.account(
      userId,
      row.brandId,
      row.socialAccountId,
    );
    const ready = await this.eligibility(account);
    if (!ready.eligible)
      throw new ConflictException(`Reconnect YouTube: ${ready.reason}`);
    const token = decryptSocial<SocialCredential>(
      account.credentialsEncrypted,
    ).accessToken;
    try {
      await this.settle(
        id,
        row.providerPostId,
        token,
        row.pageId,
        row.youtubePrivacy!,
      );
    } catch (error) {
      if (error instanceof YouTubePublishError)
        throw new ConflictException(
          `YouTube status unavailable: ${error.category}`,
        );
      throw error;
    }
    return this.read(userId, id);
  }
}
