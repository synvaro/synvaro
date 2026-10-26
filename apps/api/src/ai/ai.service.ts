import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@synvaro/database';
import { DatabaseService } from '../auth/database.service.js';
import { MODEL, OpenAITextProvider } from './text-provider.js';
import {
  IMAGE_MODEL,
  IMAGE_SIZES,
  IMAGE_QUALITIES,
  IMAGE_COST_NOTICE,
  IMAGE_PRICING_EXPIRES,
} from './image-provider.js';
export interface Preferences {
  imageEnabled?: boolean;
  imageModel?: string;
  imageSize?: string;
  imageQuality?: string;
  enabled: boolean;
  model: string;
  maxOutputTokens: number;
  monthlyBudgetUsd: number | null;
  confirmPaid: boolean;
}
export const DEFAULTS: Preferences = {
  imageEnabled: false,
  imageModel: IMAGE_MODEL,
  imageSize: IMAGE_SIZES[0],
  imageQuality: IMAGE_QUALITIES[0],
  enabled: false,
  model: MODEL,
  maxOutputTokens: 512,
  monthlyBudgetUsd: null,
  confirmPaid: true,
};
// USD micro-units; input includes the published 1.25x cache-write premium.
export const estimate = (input: number, output: number) =>
  Math.ceil(input / 8 + output / 2);
const PRICING_EXPIRES = new Date('2026-11-25T00:00:00Z');
@Injectable()
export class AiService {
  now = () => new Date();
  constructor(
    private readonly db: DatabaseService,
    private readonly provider: OpenAITextProvider,
  ) {}
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  }
  private async active(tx: Prisma.TransactionClient, userId: string) {
    return tx.aiGeneration.findFirst({
      where: { userId, status: { in: ['COUNTING', 'RUNNING'] } },
    });
  }
  private month(now: Date) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  private async summary(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ) {
    const rows = await tx.aiGeneration.aggregate({
      where: { userId, createdAt: { gte: this.month(now) } },
      _sum: { budgetChargeMicros: true },
      _count: true,
    });
    return {
      month: this.month(now).toISOString().slice(0, 7),
      chargedOrReservedUsd: (rows._sum.budgetChargeMicros ?? 0) / 1e6,
      requests: rows._count,
      uncertainRequests: await tx.aiGeneration.count({
        where: { userId, costUncertain: true },
      }),
      activeRequest: !!(await this.active(tx, userId)),
    };
  }
  async preferences(userId: string) {
    const p = await this.db.client.aiPreference.findUnique({
      where: { userId },
    });
    return {
      preferences: p
        ? {
            imageEnabled: p.imageEnabled,
            imageModel: p.imageModel,
            imageSize: p.imageSize,
            imageQuality: p.imageQuality,
            enabled: p.enabled,
            model: p.model,
            maxOutputTokens: p.maxOutputTokens,
            monthlyBudgetUsd:
              p.monthlyBudgetMicros === null
                ? null
                : Number(p.monthlyBudgetMicros) / 1e6,
            confirmPaid: p.confirmPaid,
          }
        : DEFAULTS,
      available: this.provider.configured() && this.now() < PRICING_EXPIRES,
      unavailableReason: !this.provider.configured()
        ? 'AI is unavailable: the server API key is not configured.'
        : this.now() >= PRICING_EXPIRES
          ? 'AI is unavailable: model pricing needs maintenance review.'
          : null,
      image: {
        models: [IMAGE_MODEL],
        sizes: IMAGE_SIZES,
        qualities: IMAGE_QUALITIES,
        available:
          this.provider.configured() &&
          !!process.env.MEDIA_STORAGE_ROOT &&
          this.now() < IMAGE_PRICING_EXPIRES,
        costBoundAvailable: false,
        costNotice: IMAGE_COST_NOTICE,
      },
      models: [MODEL],
      pricing: {
        version: '2026-10-26',
        expiresAt: PRICING_EXPIRES.toISOString(),
        inputUsdPerMillion: 0.125,
        outputUsdPerMillion: 0.5,
      },
      usage: await this.summary(this.db.client, userId, this.now()),
      budgetNotice:
        'Estimated spending ceiling for this account in SYNVARO, not a provider billing cap. Failures may retain their full reservation. External key usage, taxes and pricing changes are not covered.',
    };
  }
  async update(userId: string, input: Preferences) {
    await this.db.client.$transaction(async (tx) => {
      await this.lock(tx, userId);
      if (await this.active(tx, userId))
        throw new ConflictException(
          'Wait for the current generation before changing preferences.',
        );
      const { monthlyBudgetUsd, ...rest } = input;
      const data = {
        ...rest,
        monthlyBudgetMicros:
          monthlyBudgetUsd === null
            ? null
            : BigInt(Math.round(monthlyBudgetUsd * 1e6)),
      };
      await tx.aiPreference.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    });
    return this.preferences(userId);
  }
  async generate(
    userId: string,
    contentId: string,
    input: { requestId: string; instruction?: string; confirmed?: boolean },
  ) {
    const admitted = await this.db.client.$transaction(async (tx) => {
      await this.lock(tx, userId);
      // Ownership is part of the database predicate before any context is returned.
      const content = await tx.content.findFirst({
        where: {
          id: contentId,
          brand: { organization: { ownerUserId: userId } },
        },
        select: {
          title: true,
          body: true,
          brand: {
            select: {
              name: true,
              description: true,
              profile: {
                select: {
                  description: true,
                  targetAudience: true,
                  toneOfVoice: true,
                  defaultLanguage: true,
                  contentGuidelines: true,
                },
              },
            },
          },
          media: {
            orderBy: [{ position: 'asc' }, { mediaAssetId: 'asc' }],
            select: {
              asset: {
                select: {
                  originalFilename: true,
                  mimeType: true,
                  width: true,
                  height: true,
                  durationMs: true,
                },
              },
            },
          },
        },
      });
      if (!content) throw new NotFoundException('Content not found');
      const p = await tx.aiPreference.findUnique({ where: { userId } });
      if (!p?.enabled)
        throw new ConflictException(
          'Enable AI generation in preferences first.',
        );
      if (!this.provider.configured() || this.now() >= PRICING_EXPIRES)
        throw new ServiceUnavailableException();
      if (!content.brand.profile)
        throw new ConflictException(
          'Create a Brand Profile before generating.',
        );
      if (p.confirmPaid && input.confirmed !== true)
        throw new ConflictException('Confirm this paid generation first.');
      if (await this.active(tx, userId))
        throw new ConflictException('A generation is already in progress.');
      if (
        await tx.aiGeneration.findUnique({
          where: { userId_requestId: { userId, requestId: input.requestId } },
        })
      )
        throw new ConflictException(
          'This generation request has already been submitted.',
        );
      const context = JSON.stringify({
        draft: { title: content.title, body: content.body },
        brand: content.brand,
        mediaMetadata: content.media.map((m) => m.asset),
        request: input.instruction ?? '',
      });
      if (Buffer.byteLength(context) > 65536)
        throw new BadRequestException(
          'Brand context is too large. Shorten the draft or profile.',
        );
      const record = await tx.aiGeneration.create({
        data: {
          userId,
          contentId,
          requestId: input.requestId,
          model: p.model,
          maxOutputTokens: p.maxOutputTokens,
          status: 'COUNTING',
          createdAt: this.now(),
        },
      });
      return {
        record,
        request: {
          context,
          model: p.model,
          maxOutputTokens: p.maxOutputTokens,
        },
      };
    });
    const { record, request } = admitted;
    let count: number;
    try {
      count = await this.provider.count(request);
      if (!Number.isSafeInteger(count) || count < 1 || count > 16384)
        throw new Error('Context token limit');
    } catch {
      await this.db.client.aiGeneration.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          errorCode: 'INPUT_COUNT_FAILED',
          completedAt: this.now(),
        },
      });
      throw new BadRequestException(
        'Unable to validate the input token count. No generation was sent. Shorten the context or try later.',
      );
    }
    const reserve = estimate(count, request.maxOutputTokens);
    const allowed = await this.db.client.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const p = await tx.aiPreference.findUniqueOrThrow({ where: { userId } });
      const aggregate = await tx.aiGeneration.aggregate({
        where: {
          userId,
          createdAt: {
            gte: this.month(record.createdAt),
            lt: new Date(
              Date.UTC(
                record.createdAt.getUTCFullYear(),
                record.createdAt.getUTCMonth() + 1,
                1,
              ),
            ),
          },
        },
        _sum: { budgetChargeMicros: true },
      });
      const uncertain = await tx.aiGeneration.findFirst({
        where: { userId, costUncertain: true },
      });
      if (
        p.monthlyBudgetMicros !== null &&
        (uncertain ||
          BigInt((aggregate._sum.budgetChargeMicros ?? 0) + reserve) >
            p.monthlyBudgetMicros)
      ) {
        await tx.aiGeneration.update({
          where: { id: record.id },
          data: {
            status: 'BLOCKED',
            inputTokens: count,
            errorCode: uncertain ? 'COST_UNCERTAIN' : 'BUDGET_LIMIT',
            completedAt: this.now(),
          },
        });
        return false;
      }
      await tx.aiGeneration.update({
        where: { id: record.id },
        data: {
          status: 'RUNNING',
          inputTokens: count,
          budgetChargeMicros: reserve,
        },
      });
      return true;
    });
    if (!allowed)
      throw new ConflictException(
        'Estimated budget is insufficient or a prior uncertain charge needs operator reconciliation.',
      );
    try {
      const result = await this.provider.generate(request);
      if (
        !result.text.trim() ||
        result.text.length > 20000 ||
        result.model !== request.model
      )
        throw new Error('Invalid provider result');
      const validUsage =
        Number.isSafeInteger(result.inputTokens) &&
        Number.isSafeInteger(result.outputTokens) &&
        result.inputTokens! >= 0 &&
        result.outputTokens! >= 0 &&
        result.inputTokens! < 1e7 &&
        result.outputTokens! < 1e7;
      const cost = validUsage
        ? estimate(result.inputTokens!, result.outputTokens!)
        : null;
      const uncertain = cost === null || cost > reserve;
      await this.db.client.aiGeneration.update({
        where: { id: record.id },
        data: {
          status: 'SUCCEEDED',
          inputTokens: validUsage ? result.inputTokens : null,
          outputTokens: validUsage ? result.outputTokens : null,
          estimatedCostMicros: cost,
          budgetChargeMicros: cost ?? reserve,
          costUncertain: uncertain,
          completedAt: this.now(),
        },
      });
      return {
        generationId: record.id,
        text: result.text,
        model: result.model,
        usage: validUsage
          ? {
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            }
          : null,
        estimatedCostUsd: cost === null ? null : cost / 1e6,
        reservedOrChargedUsd: (cost ?? reserve) / 1e6,
        costUncertain: uncertain,
      };
    } catch {
      await this.db.client.aiGeneration.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          errorCode: 'PROVIDER_FAILED',
          costUncertain: true,
          completedAt: this.now(),
        },
      });
      throw new ServiceUnavailableException();
    }
  }
}
