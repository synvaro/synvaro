import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Prisma } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
import { LocalMediaStorage } from '../media/storage.js';
import { inspectGeneratedAudio } from '../media/inspect.js';
import { mediaSelect } from '../media/media.service.js';
import {
  ElevenLabsProvider,
  ElevenFailure,
  MAX_AUDIO_BYTES,
  MAX_NARRATION,
  SPEECH_FORMAT,
  SPEECH_MODEL,
} from './elevenlabs-provider.js';

const missing = () => new NotFoundException('Voice generation not found');
@Injectable()
export class SpeechService implements OnModuleInit, OnModuleDestroy {
  now = () => new Date();
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(SpeechService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: LocalMediaStorage,
    private readonly provider: ElevenLabsProvider,
  ) {}
  onModuleInit() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  }
  private owned(userId: string, id: string) {
    return {
      id,
      userId,
      kind: 'SPEECH' as const,
      content: { brand: { organization: { ownerUserId: userId } } },
    };
  }
  async voices() {
    if (!this.provider.configured())
      throw new ServiceUnavailableException('Voice provider is not configured');
    try {
      return { voices: await this.provider.voices() };
    } catch {
      throw new ServiceUnavailableException('Voice list unavailable');
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
    const row = await this.db.client.aiGeneration.findFirst({
      where: { userId, contentId, kind: 'SPEECH' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return { generation: row ? await this.result(userId, row.id) : null };
  }
  async result(userId: string, id: string) {
    const row = await this.db.client.aiGeneration.findFirst({
      where: this.owned(userId, id),
      select: {
        id: true,
        contentId: true,
        status: true,
        provider: true,
        model: true,
        voiceId: true,
        narrationCharacters: true,
        providerCharacterCost: true,
        providerGenerationId: true,
        estimatedCostMicros: true,
        costUncertain: true,
        errorCode: true,
        createdAt: true,
        previewKey: true,
        previewExpiresAt: true,
        mediaAssetId: true,
      },
    });
    if (!row) throw missing();
    const { previewKey, ...safe } = row;
    return {
      ...safe,
      previewAvailable:
        !!previewKey &&
        row.status === 'SUCCEEDED' &&
        !!row.previewExpiresAt &&
        row.previewExpiresAt > this.now(),
      estimatedCostUsd:
        row.estimatedCostMicros === null ? null : row.estimatedCostMicros / 1e6,
    };
  }
  async generate(
    userId: string,
    contentId: string,
    input: {
      requestId: string;
      text: string;
      voiceId: string;
      model: string;
      confirmed: boolean;
    },
  ) {
    const text = input.text.trim();
    const length = [...text].length;
    if (
      length < 1 ||
      length > MAX_NARRATION ||
      Buffer.byteLength(text) > 12_000 ||
      input.model !== SPEECH_MODEL
    )
      throw new BadRequestException('Unsupported model or narration length');
    if (
      !(await this.db.client.content.findFirst({
        where: {
          id: contentId,
          brand: { organization: { ownerUserId: userId } },
        },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Content not found');
    if (!this.provider.configured()) throw new ServiceUnavailableException();
    // Validate against the account's current premade voices before any paid call.
    const options = await this.voices();
    if (!options.voices.some((voice) => voice.id === input.voiceId))
      throw new BadRequestException('Select an available premade voice');
    const admitted = await this.db.client.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const content = await tx.content.findFirst({
        where: {
          id: contentId,
          brand: { organization: { ownerUserId: userId } },
        },
        select: { id: true },
      });
      if (!content) throw new NotFoundException('Content not found');
      const p = await tx.aiPreference.findUnique({ where: { userId } });
      if (!p?.speechEnabled)
        throw new ConflictException(
          'Enable voice generation in AI preferences first',
        );
      if (p.monthlyBudgetMicros !== null)
        throw new ConflictException(
          'Voice generation is blocked with a selected USD budget because provider credits cannot be reliably converted to USD',
        );
      if (!input.confirmed)
        throw new ConflictException('Confirm this paid voice generation first');
      if (
        await tx.aiGeneration.findFirst({
          where: {
            userId,
            OR: [
              { status: { in: ['COUNTING', 'PENDING', 'RUNNING'] } },
              {
                kind: 'SPEECH',
                previewKey: { not: null },
                previewExpiresAt: { gt: this.now() },
              },
            ],
          },
        })
      )
        throw new ConflictException(
          'Finish the active generation or save/discard the preview first',
        );
      if (
        await tx.aiGeneration.findUnique({
          where: { userId_requestId: { userId, requestId: input.requestId } },
        })
      )
        throw new ConflictException('This request was already submitted');
      const key = randomUUID();
      await this.storage.path(key, true);
      const row = await tx.aiGeneration.create({
        data: {
          userId,
          contentId,
          requestId: input.requestId,
          kind: 'SPEECH',
          provider: 'elevenlabs',
          model: SPEECH_MODEL,
          voiceId: input.voiceId,
          narrationCharacters: length,
          maxOutputTokens: 0,
          status: 'RUNNING',
          costUncertain: true,
          previewKey: key,
          previewExpiresAt: new Date(this.now().getTime() + 3_600_000),
        },
        select: { id: true },
      });
      return { row, key };
    });
    const start = Date.now();
    try {
      const output = await this.provider.generate({
        model: SPEECH_MODEL,
        text,
        voiceId: input.voiceId,
        format: SPEECH_FORMAT,
      });
      if (
        output.model !== SPEECH_MODEL ||
        output.mimeType !== 'audio/mpeg' ||
        output.bytes.length > MAX_AUDIO_BYTES ||
        output.bytes.length < 128
      )
        throw new ElevenFailure('MALFORMED_RESPONSE');
      await this.storage.stage(admitted.key, Readable.from(output.bytes));
      await inspectGeneratedAudio(await this.storage.path(admitted.key, true));
      await this.storage.publish(admitted.key);
      await this.db.client.aiGeneration.update({
        where: { id: admitted.row.id },
        data: {
          status: 'SUCCEEDED',
          providerGenerationId: output.providerGenerationId,
          providerCharacterCost:
            Number.isSafeInteger(output.characterCost) &&
            output.characterCost! >= 0
              ? output.characterCost
              : null,
          estimatedCostMicros: null,
          costUncertain: true,
          completedAt: this.now(),
        },
      });
      return this.result(userId, admitted.row.id);
    } catch (error) {
      let removed = false;
      try {
        await this.storage.remove(admitted.key);
        removed = true;
      } catch {
        /* retry cleanup */
      }
      const category =
        error instanceof ElevenFailure ? error.category : 'MALFORMED_RESPONSE';
      this.logger.warn(
        `provider=elevenlabs model=${SPEECH_MODEL} generation=${admitted.row.id} phase=generate elapsedMs=${Date.now() - start} category=${category}${error instanceof ElevenFailure && error.status ? ` status=${error.status}` : ''}`,
      );
      await this.db.client.aiGeneration.update({
        where: { id: admitted.row.id },
        data: {
          status: 'FAILED',
          errorCode: `ELEVEN_${category}`,
          completedAt: this.now(),
          ...(removed ? { previewKey: null } : {}),
        },
      });
      throw new ServiceUnavailableException(
        'Voice provider unavailable. Charge may be uncertain',
      );
    }
  }
  async file(userId: string, id: string) {
    const row = await this.db.client.aiGeneration.findFirst({
      where: this.owned(userId, id),
    });
    if (
      !row?.previewKey ||
      row.status !== 'SUCCEEDED' ||
      !row.previewExpiresAt ||
      row.previewExpiresAt <= this.now()
    )
      throw missing();
    try {
      return await this.storage.read(row.previewKey);
    } catch {
      throw missing();
    }
  }
  async accept(userId: string, id: string) {
    return this.db.client.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const row = await tx.aiGeneration.findFirst({
        where: this.owned(userId, id),
        include: { content: { select: { brandId: true } } },
      });
      if (!row) throw missing();
      if (row.mediaAssetId)
        return tx.mediaAsset.findUniqueOrThrow({
          where: { id: row.mediaAssetId },
          select: mediaSelect,
        });
      if (
        !row.previewKey ||
        row.status !== 'SUCCEEDED' ||
        !row.previewExpiresAt ||
        row.previewExpiresAt <= this.now()
      )
        throw missing();
      const details = await inspectGeneratedAudio(
        await this.storage.path(row.previewKey),
      );
      const asset = await tx.mediaAsset.create({
        data: {
          ...details,
          brandId: row.content.brandId,
          storageKey: row.previewKey,
          originalFilename: `ai-voice-${row.id}.mp3`,
          origin: 'AI_VOICE',
        },
      });
      await tx.aiGeneration.update({
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
      await this.lock(tx, userId);
      const row = await tx.aiGeneration.findFirst({
        where: this.owned(userId, id),
      });
      if (!row) throw missing();
      if (row.mediaAssetId || row.status === 'RUNNING')
        throw new ConflictException(
          'Saved or active audio cannot be discarded',
        );
      if (row.previewKey) {
        await this.storage.remove(row.previewKey);
        await tx.aiGeneration.update({
          where: { id },
          data: { previewKey: null },
        });
      }
    });
    return this.result(userId, id);
  }
  async sweep() {
    const expired = await this.db.client.aiGeneration.findMany({
      where: {
        kind: 'SPEECH',
        previewKey: { not: null },
        previewExpiresAt: { lte: this.now() },
        mediaAssetId: null,
      },
      orderBy: { previewExpiresAt: 'asc' },
      take: 50,
      select: { id: true, userId: true },
    });
    for (const item of expired) {
      try {
        await this.db.client.$transaction(async (tx) => {
          await this.lock(tx, item.userId);
          const row = await tx.aiGeneration.findUniqueOrThrow({
            where: { id: item.id },
          });
          if (
            row.previewKey &&
            !row.mediaAssetId &&
            row.previewExpiresAt &&
            row.previewExpiresAt <= this.now()
          ) {
            await this.storage.remove(row.previewKey);
            await tx.aiGeneration.update({
              where: { id: row.id },
              data: { previewKey: null },
            });
          }
        });
      } catch {
        this.logger.warn('Voice preview cleanup will retry');
      }
    }
  }
}
