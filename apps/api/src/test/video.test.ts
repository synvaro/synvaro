import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { AiService, DEFAULTS } from '../ai/ai.service.js';
import { VideoService } from '../ai/video.service.js';
import {
  GoogleVideoProvider,
  VIDEO_MODEL,
} from '../ai/google-video-provider.js';
import type { VideoObservation } from '../ai/providers/contracts.js';
import { LocalMediaStorage } from '../media/storage.js';
import { OpenAITextProvider } from '../ai/text-provider.js';

test(
  'VID-001–006: real PostgreSQL video lifecycle, ownership, budget and private files',
  { timeout: 120000 },
  async () => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const oldRoot = process.env.MEDIA_STORAGE_ROOT;
    const root = await mkdtemp(join(tmpdir(), 'synvaro-video-test-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const service = app.get(VideoService);
    const ai = app.get(AiService);
    const provider = app.get(GoogleVideoProvider);
    provider.configured = () => true;
    let now = new Date('2026-10-27T21:00:00Z');
    service.now = () => now;
    ai.now = () => now;
    const fixture = join(root, 'fixture.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=720x1280:r=24:d=3',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        fixture,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    const mp4 = await readFile(fixture);
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#225588' },
    })
      .png()
      .toBuffer();
    let starts = 0,
      polls = 0,
      prompt = '',
      sourceLength = 0;
    let mode: 'normal' | 'invalid' | 'no-usage' | 'delayed' = 'normal';
    provider.start = async (request) => {
      starts++;
      prompt = request.prompt;
      sourceLength = request.source?.bytes.length ?? 0;
      return { status: 'RUNNING', operationId: `mock-video-${starts}` };
    };
    provider.retrieve = async (id): Promise<VideoObservation> => {
      polls++;
      assert.match(id, /^mock-video-/);
      if (mode === 'delayed') return { status: 'RUNNING', operationId: id };
      if (mode === 'invalid')
        return {
          status: 'SUCCEEDED',
          operationId: id,
          bytes: Buffer.from('not an MP4'),
        };
      if (mode === 'no-usage')
        return { status: 'SUCCEEDED', operationId: id, bytes: mp4 };
      if (polls % 2 === 1) return { status: 'RUNNING', operationId: id };
      return {
        status: 'SUCCEEDED',
        operationId: id,
        bytes: mp4,
        inputTokens: 100,
        outputTokens: 18000,
        outputVideoTokens: 17000,
      };
    };
    const prefix = `vid-${randomUUID()}`;
    const users: { id: string; cookie: string }[] = [];
    let base = '';
    async function call(
      path: string,
      method = 'GET',
      body?: unknown,
      cookie = users[0]?.cookie ?? '',
      origin = config.origin,
    ) {
      return fetch(base + path, {
        method,
        headers: { cookie, origin, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    let contentId = '';
    let otherContentId: string, foreignContentId: string;
    let sourceId: string, foreignSourceId: string;
    const start = (changes = {}, id = contentId, cookie?: string) =>
      call(
        `/contents/${id}/video-generations`,
        'POST',
        {
          requestId: randomUUID(),
          instruction: 'A hypothetical warm breakfast scene',
          model: VIDEO_MODEL,
          duration: '3s',
          aspectRatio: '9:16',
          resolution: '720p',
          confirmed: true,
          ...changes,
        },
        cookie,
      );
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (let n = 0; n < 2; n++) {
        const email = `${prefix}-${n}@example.test`;
        const password = `Test-only-${randomUUID()}`;
        assert.equal(
          (await call('/auth/register', 'POST', { email, password }, ''))
            .status,
          201,
        );
        const login = await call(
          '/auth/login',
          'POST',
          { email, password },
          '',
        );
        users.push({
          id: (await login.json()).user.id,
          cookie: login.headers.get('set-cookie')!.split(';')[0]!,
        });
      }
      const ownOrg = await db.organization.create({
        data: {
          ownerUserId: users[0]!.id,
          name: prefix,
          slug: prefix,
        },
      });
      const otherOrg = await db.organization.create({
        data: {
          ownerUserId: users[1]!.id,
          name: `${prefix}-other`,
          slug: `${prefix}-other`,
        },
      });
      const brand = await db.brand.create({
        data: {
          organizationId: ownOrg.id,
          name: 'Hypothetical Turkish kitchen',
          slug: 'kitchen',
          profile: {
            create: {
              description: 'Conceptual scenes only',
              targetAudience: 'Adults',
              toneOfVoice: 'Warm',
              defaultLanguage: 'tr-TR',
              contentGuidelines: 'No product claims',
            },
          },
        },
      });
      const otherBrand = await db.brand.create({
        data: {
          organizationId: ownOrg.id,
          name: 'Other',
          slug: 'other',
        },
      });
      const foreignBrand = await db.brand.create({
        data: {
          organizationId: otherOrg.id,
          name: 'Foreign',
          slug: 'foreign',
        },
      });
      contentId = (
        await db.content.create({
          data: {
            brandId: brand.id,
            title: 'Saved video title',
            body: 'Saved video body',
          },
        })
      ).id;
      otherContentId = (
        await db.content.create({
          data: { brandId: otherBrand.id, title: 'Other', body: '' },
        })
      ).id;
      foreignContentId = (
        await db.content.create({
          data: { brandId: foreignBrand.id, title: 'Foreign', body: '' },
        })
      ).id;
      const storage = app.get(LocalMediaStorage);
      const sourceKey = randomUUID(),
        foreignKey = randomUUID();
      for (const key of [sourceKey, foreignKey]) {
        await storage.stage(key, Readable.from(png));
        await storage.publish(key);
      }
      sourceId = (
        await db.mediaAsset.create({
          data: {
            brandId: brand.id,
            storageKey: sourceKey,
            originalFilename: 'source.png',
            mimeType: 'image/png',
            sizeBytes: png.length,
            width: 64,
            height: 64,
          },
        })
      ).id;
      foreignSourceId = (
        await db.mediaAsset.create({
          data: {
            brandId: foreignBrand.id,
            storageKey: foreignKey,
            originalFilename: 'foreign.png',
            mimeType: 'image/png',
            sizeBytes: png.length,
            width: 64,
            height: 64,
          },
        })
      ).id;
      assert.equal((await start()).status, 409); // disabled
      assert.equal(
        (
          await call('/ai/preferences', 'PUT', {
            ...DEFAULTS,
            videoEnabled: true,
            monthlyBudgetUsd: 1,
          })
        ).status,
        200,
      );
      assert.equal((await start()).status, 409); // $1 fail closed, no provider call
      assert.equal(starts, 0);
      assert.equal(
        (await start({ sourceMediaAssetId: foreignSourceId })).status,
        409,
      );
      assert.equal(
        (
          await call('/ai/preferences', 'PUT', {
            ...DEFAULTS,
            videoEnabled: true,
          })
        ).status,
        200,
      );
      assert.equal((await start({ duration: '20s' })).status, 400);
      assert.equal(
        (await start({ sourceMediaAssetId: foreignSourceId })).status,
        404,
      );
      assert.equal((await start({}, foreignContentId)).status, 404);
      assert.equal((await start({}, contentId, '')).status, 401);
      assert.equal(
        (
          await call(
            `/contents/${contentId}/video-generations`,
            'POST',
            {
              requestId: randomUUID(),
              instruction: 'x',
              model: VIDEO_MODEL,
              duration: '3s',
              aspectRatio: '9:16',
              resolution: '720p',
              confirmed: true,
            },
            users[0]!.cookie,
            'https://foreign.example',
          )
        ).status,
        403,
      );
      const requestId = randomUUID();
      const started = await start({ requestId });
      assert.equal(started.status, 201);
      const initial = await started.json();
      assert.equal(initial.status, 'RUNNING');
      assert.equal(starts, 1);
      assert.match(prompt, /Hypothetical Turkish kitchen/);
      assert.match(prompt, /Conceptual scenes only/);
      assert.match(prompt, /Saved video title/);
      assert.equal((await start({ requestId })).status, 409);
      assert.equal((await start()).status, 409);
      assert.equal(starts, 1);
      assert.equal(
        (
          await call(
            `/video-generations/${initial.id}`,
            'GET',
            undefined,
            users[1]!.cookie,
          )
        ).status,
        404,
      );
      let observed = await (
        await call(`/video-generations/${initial.id}`)
      ).json();
      if (observed.status === 'RUNNING')
        observed = await (
          await call(`/video-generations/${initial.id}`)
        ).json();
      assert.equal(observed.status, 'SUCCEEDED');
      assert.equal(observed.previewAvailable, true);
      assert.equal(observed.estimatedCostUsd, 0.30665);
      assert.equal(observed.videoHasAudio, false);
      const file = await call(`/video-generations/${initial.id}/file`);
      assert.equal(file.status, 200);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4);
      const range = await fetch(
        base + `/video-generations/${initial.id}/file`,
        {
          headers: { cookie: users[0]!.cookie, range: 'bytes=0-15' },
        },
      );
      assert.equal(range.status, 206);
      assert.deepEqual(
        Buffer.from(await range.arrayBuffer()),
        mp4.subarray(0, 16),
      );
      assert.equal(
        (
          await call(
            `/video-generations/${initial.id}/file`,
            'GET',
            undefined,
            users[1]!.cookie,
          )
        ).status,
        404,
      );
      const asset = await (
        await call(`/video-generations/${initial.id}/accept`, 'POST', {})
      ).json();
      assert.equal(asset.origin, 'AI_VIDEO');
      assert.equal(asset.generation.sourceMediaAssetId, null);
      assert.equal(
        (
          await call(`/contents/${contentId}/media`, 'POST', {
            mediaAssetId: asset.id,
          })
        ).status,
        201,
      );
      assert.equal(
        (await db.content.findUniqueOrThrow({ where: { id: contentId } })).body,
        'Saved video body',
      );
      assert.equal((await call(`/media/${asset.id}/file`)).status, 200);
      const second = await start({ sourceMediaAssetId: sourceId });
      assert.equal(second.status, 201);
      assert.equal(sourceLength, png.length);
      const secondId = (await second.json()).id;
      observed = await (await call(`/video-generations/${secondId}`)).json();
      if (observed.status === 'RUNNING')
        observed = await (await call(`/video-generations/${secondId}`)).json();
      assert.equal(observed.status, 'SUCCEEDED');
      assert.equal(observed.sourceMediaAssetId, sourceId);
      assert.equal(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: sourceId } }))
          .storageKey,
        sourceKey,
      );
      assert.deepEqual(
        Buffer.from(
          await (await call(`/media/${sourceId}/file`)).arrayBuffer(),
        ),
        png,
      );
      assert.equal(
        (await call(`/video-generations/${secondId}`, 'DELETE', {})).status,
        200,
      );
      assert.equal(
        (await call(`/video-generations/${secondId}/file`)).status,
        404,
      );
      assert.equal(
        (await call(`/contents/${otherContentId}/video-generations/latest`))
          .status,
        200,
      );
      assert.equal(
        (await call(`/contents/${foreignContentId}/video-generations/latest`))
          .status,
        404,
      );
      const latest = await (
        await call(`/contents/${contentId}/video-generations/latest`)
      ).json();
      assert.equal(latest.generation.id, secondId);
      assert.equal(starts, 2);
      const textProvider = app.get(OpenAITextProvider);
      textProvider.configured = () => true;
      textProvider.count = async () => 100;
      textProvider.generate = async (request) => ({
        text: 'Hypothetical copy',
        model: request.model,
        inputTokens: 100,
        outputTokens: 50,
      });
      await db.aiGeneration.create({
        data: {
          userId: users[0]!.id,
          contentId,
          requestId: randomUUID(),
          kind: 'SPEECH',
          provider: 'elevenlabs',
          model: 'eleven_multilingual_v2',
          maxOutputTokens: 0,
          status: 'SUCCEEDED',
          costUncertain: true,
        },
      });
      assert.equal(
        (
          await call('/ai/preferences', 'PUT', {
            ...DEFAULTS,
            enabled: true,
            videoEnabled: true,
            monthlyBudgetUsd: 1,
          })
        ).status,
        200,
      );
      // Unknown provider credits remain in the ledger but cannot masquerade
      // as unknown USD and block an otherwise budgeted text request.
      assert.equal(
        (
          await call(`/contents/${contentId}/ai-generations`, 'POST', {
            requestId: randomUUID(),
            instruction: 'Hypothetical copy',
            confirmed: true,
          })
        ).status,
        201,
      );
      const unknownUsd = await db.aiGeneration.create({
        data: {
          userId: users[0]!.id,
          contentId,
          requestId: randomUUID(),
          kind: 'IMAGE',
          provider: 'google',
          model: 'gemini-nano-banana-2.1',
          maxOutputTokens: 0,
          status: 'FAILED',
          costUncertain: true,
        },
      });
      assert.equal(
        (
          await call(`/contents/${contentId}/ai-generations`, 'POST', {
            requestId: randomUUID(),
            instruction: 'Blocked by uncertain USD',
            confirmed: true,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await db.aiGeneration.findUniqueOrThrow({
            where: {
              id: unknownUsd.id,
            },
          })
        ).costUncertain,
        true,
      );
      assert.equal(
        (
          await call('/ai/preferences', 'PUT', {
            ...DEFAULTS,
            videoEnabled: true,
          })
        ).status,
        200,
      );
      mode = 'invalid';
      const invalidStart = await (await start()).json();
      const invalid = await (
        await call(`/video-generations/${invalidStart.id}`)
      ).json();
      assert.equal(invalid.status, 'FAILED');
      assert.equal(invalid.costUncertain, true);
      assert.equal(invalid.errorCode, 'VIDEO_OUTPUT_INVALID');
      assert.equal(
        (await call(`/video-generations/${invalid.id}/file`)).status,
        404,
      );
      mode = 'no-usage';
      const unknownStart = await (await start()).json();
      const unknown = await (
        await call(`/video-generations/${unknownStart.id}`)
      ).json();
      assert.equal(unknown.status, 'SUCCEEDED');
      assert.equal(unknown.estimatedCostUsd, null);
      assert.equal(unknown.costUncertain, true);
      now = new Date(now.getTime() + 3_600_001);
      await service.sweep();
      assert.equal(
        (await call(`/video-generations/${unknown.id}/file`)).status,
        404,
      );
      mode = 'delayed';
      const delayed = await (await start()).json();
      assert.equal(delayed.status, 'RUNNING');
      assert.equal(delayed.previewExpiresAt, null);
      const delayedOperation = await db.aiGeneration.findUniqueOrThrow({
        where: { id: delayed.id },
      });
      now = new Date(now.getTime() + 3_600_001);
      await service.sweep();
      const stillRunning = await (
        await call(`/video-generations/${delayed.id}`)
      ).json();
      assert.equal(stillRunning.status, 'RUNNING');
      assert.equal(stillRunning.previewExpiresAt, null);
      assert.equal(stillRunning.costUncertain, true);
      assert.equal(
        stillRunning.providerGenerationId,
        delayedOperation.providerGenerationId,
      );
      mode = 'normal';
      let recovered = await (
        await call(`/video-generations/${delayed.id}`)
      ).json();
      if (recovered.status === 'RUNNING')
        recovered = await (
          await call(`/video-generations/${delayed.id}`)
        ).json();
      assert.equal(recovered.status, 'SUCCEEDED');
      assert.equal(recovered.previewAvailable, true);
      assert.ok(new Date(recovered.previewExpiresAt).getTime() > now.getTime());
      assert.equal(
        (await call(`/video-generations/${delayed.id}`, 'DELETE', {})).status,
        200,
      );
      const beforeConcurrent = starts;
      let releaseStart: (() => void) | undefined;
      const pendingStart = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      const originalStart = provider.start;
      provider.start = async (request) => {
        await pendingStart;
        return originalStart(request);
      };
      const firstConcurrent = start();
      const secondConcurrent = start();
      releaseStart?.();
      const concurrentStatuses = await Promise.all([
        firstConcurrent.then((response) => response.status),
        secondConcurrent.then((response) => response.status),
      ]);
      assert.deepEqual(concurrentStatuses.sort(), [201, 409]);
      assert.equal(starts, beforeConcurrent + 1);
    } finally {
      await app.close();
      await db.aiGeneration.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await db.contentMedia.deleteMany({
        where: {
          content: {
            brand: {
              organization: {
                ownerUserId: { in: users.map((u) => u.id) },
              },
            },
          },
        },
      });
      await db.mediaAsset.deleteMany({
        where: {
          brand: {
            organization: {
              ownerUserId: { in: users.map((u) => u.id) },
            },
          },
        },
      });
      await db.content.deleteMany({
        where: {
          brand: {
            organization: {
              ownerUserId: { in: users.map((u) => u.id) },
            },
          },
        },
      });
      await db.brand.deleteMany({
        where: {
          organization: {
            ownerUserId: { in: users.map((u) => u.id) },
          },
        },
      });
      await db.organization.deleteMany({
        where: { ownerUserId: { in: users.map((u) => u.id) } },
      });
      await db.user.deleteMany({
        where: { id: { in: users.map((u) => u.id) } },
      });
      await db.$disconnect();
      if (oldRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT;
      else process.env.MEDIA_STORAGE_ROOT = oldRoot;
      await rm(root, { recursive: true, force: true });
    }
  },
);
