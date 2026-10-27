import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
import { LocalMediaStorage } from '../media/storage.js';
import { mediaSelect } from '../media/media.service.js';
import {
  renderReel,
  verifySource,
  type ReelScene,
  type RenderSource,
} from './render.js';

const missing = () => new NotFoundException('Reel render not found');
const safeSelect = {
  id: true,
  contentId: true,
  scenes: true,
  narrationAssetId: true,
  status: true,
  durationMs: true,
  errorCode: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  previewExpiresAt: true,
  mediaAssetId: true,
} as const;
@Injectable()
export class ReelService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(ReelService.name);
  now = () => new Date();
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: LocalMediaStorage,
  ) {}
  async onModuleInit() {
    // This first version runs one API process on one host. An interrupted local
    // FFmpeg process is terminal; it is never silently re-run after a restart.
    await this.db.client.reelRender.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        errorCode: 'RENDER_INTERRUPTED',
        completedAt: this.now(),
      },
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, 3000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async owned(userId: string, id: string) {
    const row = await this.db.client.reelRender.findFirst({
      where: {
        id,
        userId,
        content: { brand: { organization: { ownerUserId: userId } } },
      },
      select: { ...safeSelect, previewKey: true },
    });
    if (!row) throw missing();
    return row;
  }
  async start(
    userId: string,
    contentId: string,
    requestId: string,
    scenes: ReelScene[],
    narrationAssetId?: string,
  ) {
    try {
      const row = await this.db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const content = await tx.content.findFirst({
          where: {
            id: contentId,
            brand: { organization: { ownerUserId: userId } },
          },
          select: { id: true, brandId: true },
        });
        if (!content) throw new NotFoundException('Content not found');
        await this.storage.path(randomUUID(), true);
        const ids = [
          ...new Set([
            ...scenes.map((s) => s.mediaAssetId),
            ...(narrationAssetId ? [narrationAssetId] : []),
          ]),
        ];
        const assets = await tx.mediaAsset.findMany({
          where: { id: { in: ids }, brandId: content.brandId },
          select: {
            id: true,
            mimeType: true,
            durationMs: true,
            sizeBytes: true,
          },
        });
        if (assets.length !== ids.length)
          throw new NotFoundException('Media not found');
        const byId = new Map(assets.map((a) => [a.id, a]));
        let seconds = 0;
        for (const scene of scenes) {
          const asset = byId.get(scene.mediaAssetId)!;
          if (asset.sizeBytes > 20 * 1024 * 1024)
            throw new BadRequestException('Source too large');
          if (asset.mimeType.startsWith('image/')) {
            if (
              !['image/jpeg', 'image/png', 'image/webp'].includes(
                asset.mimeType,
              ) ||
              scene.videoStartSec !== undefined ||
              scene.videoDurationSec !== undefined ||
              scene.imageDurationSec === undefined
            )
              throw new BadRequestException('Invalid image scene');
            seconds += scene.imageDurationSec;
          } else if (asset.mimeType === 'video/mp4') {
            if (
              scene.imageDurationSec !== undefined ||
              scene.videoStartSec === undefined ||
              scene.videoDurationSec === undefined ||
              !asset.durationMs ||
              (scene.videoStartSec + scene.videoDurationSec) * 1000 >
                asset.durationMs + 50
            )
              throw new BadRequestException('Invalid video trim');
            seconds += scene.videoDurationSec;
          } else throw new BadRequestException('Unsupported scene media');
        }
        if (seconds > 60)
          throw new BadRequestException('Reel exceeds 60 seconds');
        if (
          narrationAssetId &&
          byId.get(narrationAssetId)?.mimeType !== 'audio/mpeg'
        )
          throw new BadRequestException('Narration must be MP3');
        if (
          await tx.reelRender.findFirst({
            where: { userId, status: { in: ['QUEUED', 'RUNNING'] } },
            select: { id: true },
          })
        )
          throw new ConflictException('Finish the active Reel render first');
        if (
          await tx.reelRender.findUnique({
            where: { userId_requestId: { userId, requestId } },
            select: { id: true },
          })
        )
          throw new ConflictException('This render was already submitted');
        return tx.reelRender.create({
          data: {
            userId,
            contentId,
            requestId,
            scenes: scenes as unknown as Prisma.InputJsonValue,
            narrationAssetId,
            durationMs: seconds * 1000,
          },
          select: safeSelect,
        });
      });
      void this.tick();
      return { ...row, previewAvailable: false };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException('Render already active or submitted');
      throw error;
    }
  }
  async latest(userId: string, contentId: string) {
    const content = await this.db.client.content.findFirst({
      where: {
        id: contentId,
        brand: { organization: { ownerUserId: userId } },
      },
      select: { id: true },
    });
    if (!content) throw new NotFoundException('Content not found');
    const row = await this.db.client.reelRender.findFirst({
      where: { contentId, userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return { render: row ? await this.result(userId, row.id) : null };
  }
  async result(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const { previewKey, ...safe } = row;
    return {
      ...safe,
      previewAvailable:
        !!previewKey &&
        row.status === 'SUCCEEDED' &&
        !!row.previewExpiresAt &&
        row.previewExpiresAt > this.now(),
    };
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.sweep();
      const queued = await this.db.client.reelRender.findFirst({
        where: { status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!queued) return;
      const claim = await this.db.client.reelRender.updateMany({
        where: { id: queued.id, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: this.now() },
      });
      if (claim.count) await this.execute(queued.id);
    } catch {
      this.logger.warn('Reel worker will retry.');
    } finally {
      this.busy = false;
    }
  }
  private async execute(id: string) {
    let key: string | null = null;
    let dir: string | null = null;
    try {
      const row = await this.db.client.reelRender.findUniqueOrThrow({
        where: { id },
        include: { content: { select: { brandId: true } } },
      });
      const scenes = row.scenes as ReelScene[];
      const ids = [
        ...new Set([
          ...scenes.map((s) => s.mediaAssetId),
          ...(row.narrationAssetId ? [row.narrationAssetId] : []),
        ]),
      ];
      const assets = await this.db.client.mediaAsset.findMany({
        where: { id: { in: ids }, brandId: row.content.brandId },
      });
      if (assets.length !== ids.length) throw new Error('SOURCE_MISSING');
      const byId = new Map(assets.map((a) => [a.id, a]));
      const sources: RenderSource[] = [];
      for (const scene of scenes) {
        const asset = byId.get(scene.mediaAssetId)!;
        const path = await this.storage.path(asset.storageKey);
        const inspected = await verifySource(path, asset.mimeType);
        if (
          asset.mimeType === 'video/mp4' &&
          (!inspected.durationMs ||
            (scene.videoStartSec! + scene.videoDurationSec!) * 1000 >
              inspected.durationMs + 50)
        )
          throw new Error('SOURCE_INVALID');
        sources.push({
          ...scene,
          path,
          mimeType: asset.mimeType,
          durationMs: inspected.durationMs,
        });
      }
      const narration = row.narrationAssetId
        ? byId.get(row.narrationAssetId)!
        : null;
      const narrationPath = narration
        ? await this.storage.path(narration.storageKey)
        : null;
      if (narrationPath) await verifySource(narrationPath, 'audio/mpeg');
      key = randomUUID();
      dir = await mkdtemp(
        join(dirname(await this.storage.path(key)), '.reel-'),
      );
      const { output, details } = await renderReel(sources, narrationPath, dir);
      await this.storage.stage(key, createReadStream(output));
      await this.storage.publish(key);
      await this.db.client.reelRender.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          previewKey: key,
          previewExpiresAt: new Date(this.now().getTime() + 3_600_000),
          completedAt: this.now(),
          durationMs: details.durationMs!,
        },
      });
      key = null;
    } catch (error) {
      const code =
        error instanceof Error &&
        [
          'SOURCE_INVALID',
          'SOURCE_MISSING',
          'OUTPUT_TOO_LARGE',
          'OUTPUT_INVALID',
          'OVERLAY_TOO_LONG',
        ].includes(error.message)
          ? error.message
          : error &&
              typeof error === 'object' &&
              'killed' in error &&
              error.killed
            ? 'RENDER_TIMEOUT'
            : 'RENDER_FAILED';
      this.logger.warn(`reel=${id} category=${code}`);
      await this.db.client.reelRender.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: 'FAILED', errorCode: code, completedAt: this.now() },
      });
    } finally {
      if (key) await this.storage.remove(key).catch(() => {});
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async file(userId: string, id: string, range?: string) {
    const row = await this.owned(userId, id);
    if (
      !row.previewKey ||
      row.status !== 'SUCCEEDED' ||
      !row.previewExpiresAt ||
      row.previewExpiresAt <= this.now()
    )
      throw missing();
    const size = (await stat(await this.storage.path(row.previewKey))).size;
    let start = 0,
      end = size - 1,
      partial = false;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        throw new BadRequestException('Invalid range');
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= size
      )
        throw new BadRequestException('Invalid range');
      partial = true;
    }
    return {
      stream: await this.storage.read(row.previewKey, start, end),
      size,
      start,
      end,
      partial,
    };
  }
  async accept(userId: string, id: string) {
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const row = await tx.reelRender.findFirst({
        where: {
          id,
          userId,
          content: { brand: { organization: { ownerUserId: userId } } },
        },
        include: { content: { select: { brandId: true } } },
      });
      if (!row) throw missing();
      if (row.mediaAssetId)
        return tx.mediaAsset.findUniqueOrThrow({
          where: { id: row.mediaAssetId },
          select: mediaSelect,
        });
      if (
        row.status !== 'SUCCEEDED' ||
        !row.previewKey ||
        !row.previewExpiresAt ||
        row.previewExpiresAt <= this.now()
      )
        throw missing();
      const sizeBytes = (await stat(await this.storage.path(row.previewKey)))
        .size;
      const asset = await tx.mediaAsset.create({
        data: {
          brandId: row.content.brandId,
          storageKey: row.previewKey,
          originalFilename: `reel-${row.id}.mp4`,
          mimeType: 'video/mp4',
          sizeBytes,
          width: 1080,
          height: 1920,
          durationMs: row.durationMs,
          origin: 'REEL_ASSEMBLED',
        },
      });
      await tx.reelRender.update({
        where: { id },
        data: {
          mediaAssetId: asset.id,
          previewKey: null,
          previewExpiresAt: null,
        },
      });
      return tx.mediaAsset.findUniqueOrThrow({
        where: { id: asset.id },
        select: mediaSelect,
      });
    });
  }
  async discard(userId: string, id: string) {
    await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const row = await tx.reelRender.findFirst({
        where: {
          id,
          userId,
          content: { brand: { organization: { ownerUserId: userId } } },
        },
      });
      if (!row) throw missing();
      if (
        row.status === 'QUEUED' ||
        row.status === 'RUNNING' ||
        row.mediaAssetId
      )
        throw new ConflictException('Active or saved Reel cannot be discarded');
      if (row.previewKey) {
        await this.storage.remove(row.previewKey);
        await tx.reelRender.update({
          where: { id },
          data: { previewKey: null },
        });
      }
    });
    return this.result(userId, id);
  }
  async sweep() {
    const rows = await this.db.client.reelRender.findMany({
      where: {
        status: 'SUCCEEDED',
        mediaAssetId: null,
        previewKey: { not: null },
        previewExpiresAt: { lte: this.now() },
      },
      take: 20,
      select: { id: true, userId: true },
    });
    for (const row of rows) {
      await this.db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${row.userId}::uuid FOR UPDATE`;
        const current = await tx.reelRender.findUnique({
          where: { id: row.id },
        });
        if (
          current?.status !== 'SUCCEEDED' ||
          current.mediaAssetId ||
          !current.previewKey ||
          !current.previewExpiresAt ||
          current.previewExpiresAt > this.now()
        )
          return;
        await this.storage.remove(current.previewKey);
        await tx.reelRender.update({
          where: { id: row.id },
          data: { previewKey: null },
        });
      });
    }
  }
}
