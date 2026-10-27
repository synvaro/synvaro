import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { LocalMediaStorage } from '../media/storage.js';
import { ReelService } from '../reels/reel.service.js';

test(
  'REEL-001–008 real PostgreSQL and actual FFmpeg lifecycle',
  { timeout: 180000 },
  async () => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const oldRoot = process.env.MEDIA_STORAGE_ROOT;
    const root = await mkdtemp(join(tmpdir(), 'synvaro-reel-test-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    let base = '';
    const users: { id: string; cookie: string }[] = [];
    const prefix = `reel-${randomUUID()}`;
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
    const ids: string[] = [];
    let contentId: string;
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (let n = 0; n < 2; n++) {
        const email = `${prefix}-${n}@example.test`,
          password = `Test-only-${randomUUID()}`;
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
      const own = await db.organization.create({
        data: { ownerUserId: users[0]!.id, name: prefix, slug: prefix },
      });
      const other = await db.organization.create({
        data: {
          ownerUserId: users[1]!.id,
          name: `${prefix}-other`,
          slug: `${prefix}-other`,
        },
      });
      const brand = await db.brand.create({
        data: { organizationId: own.id, name: 'Reel test', slug: 'reel' },
      });
      const foreign = await db.brand.create({
        data: { organizationId: other.id, name: 'Foreign', slug: 'foreign' },
      });
      contentId = (
        await db.content.create({
          data: {
            brandId: brand.id,
            title: 'Saved Reel draft',
            body: 'Original body',
          },
        })
      ).id;
      const dir = await mkdtemp(join(root, 'fixtures-'));
      const image = join(dir, 'source.png'),
        video = join(dir, 'source.mp4'),
        audio = join(dir, 'voice.mp3');
      await sharp({
        create: { width: 320, height: 240, channels: 3, background: '#448866' },
      })
        .png()
        .toFile(image);
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x240:r=24:d=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        video,
      ]);
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        audio,
      ]);
      const storage = app.get(LocalMediaStorage);
      async function asset(path: string, mimeType: string, brandId = brand.id) {
        const key = randomUUID();
        await storage.stage(key, createReadStream(path));
        await storage.publish(key);
        const bytes = await readFile(path);
        const a = await db.mediaAsset.create({
          data: {
            brandId,
            storageKey: key,
            originalFilename: path.split('/').at(-1)!,
            mimeType,
            sizeBytes: bytes.length,
            durationMs:
              mimeType === 'video/mp4'
                ? 2000
                : mimeType === 'audio/mpeg'
                  ? 1000
                  : null,
          },
        });
        ids.push(a.id);
        return { a, bytes };
      }
      const img = await asset(image, 'image/png'),
        clip = await asset(video, 'video/mp4'),
        voice = await asset(audio, 'audio/mpeg'),
        far = await asset(image, 'image/png', foreign.id);
      const body = {
        requestId: randomUUID(),
        scenes: [
          {
            mediaAssetId: img.a.id,
            imageDurationSec: 1,
            text: 'Merhaba Türkiye',
            placement: 'top',
          },
          {
            mediaAssetId: clip.a.id,
            videoStartSec: 0,
            videoDurationSec: 1,
            text: 'Hafta sonu',
            placement: 'bottom',
          },
        ],
        narrationAssetId: voice.a.id,
      };
      assert.equal(
        (await call(`/contents/${contentId}/reels`, 'POST', body, '')).status,
        401,
      );
      assert.equal(
        (
          await call(
            `/contents/${contentId}/reels`,
            'POST',
            body,
            users[0]!.cookie,
            'https://foreign.example',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(`/contents/${contentId}/reels`, 'POST', {
            ...body,
            scenes: [{ mediaAssetId: far.a.id, imageDurationSec: 1 }],
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(`/contents/${contentId}/reels`, 'POST', {
            ...body,
            scenes: [
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
              { mediaAssetId: img.a.id, imageDurationSec: 10 },
            ],
          })
        ).status,
        400,
      );
      const started = await call(`/contents/${contentId}/reels`, 'POST', body);
      assert.equal(started.status, 201);
      const job = await started.json();
      assert.ok(['QUEUED', 'RUNNING'].includes(job.status));
      assert.equal(
        (await call(`/contents/${contentId}/reels`, 'POST', body)).status,
        409,
      );
      assert.equal(
        (
          await call(`/contents/${contentId}/reels`, 'POST', {
            ...body,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      async function complete(id: string) {
        for (let i = 0; i < 60; i++) {
          const data = await (await call(`/reels/${id}`)).json();
          if (['SUCCEEDED', 'FAILED'].includes(data.status)) return data;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error('Render did not complete');
      }
      const done = await complete(job.id);
      assert.equal(done.status, 'SUCCEEDED', done.errorCode);
      assert.equal(done.durationMs, 2000);
      assert.equal(done.previewAvailable, true);
      assert.equal(
        (await call(`/reels/${job.id}`, 'GET', undefined, users[1]!.cookie))
          .status,
        404,
      );
      assert.equal(
        (
          await call(
            `/reels/${job.id}/file`,
            'GET',
            undefined,
            users[1]!.cookie,
          )
        ).status,
        404,
      );
      const file = await call(`/reels/${job.id}/file`);
      assert.equal(file.status, 200);
      const output = Buffer.from(await file.arrayBuffer());
      assert.ok(output.length > 1000 && output.length < 20 * 1024 * 1024);
      const renderedPath = join(dir, 'verified.mp4');
      await writeFile(renderedPath, output);
      const probe = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_name,codec_type,width,height,r_frame_rate:format=duration',
            '-of',
            'json',
            renderedPath,
          ],
          { encoding: 'utf8' },
        ),
      );
      assert.ok(
        probe.streams.some(
          (stream: {
            codec_type: string;
            codec_name: string;
            width?: number;
            height?: number;
            r_frame_rate?: string;
          }) =>
            stream.codec_type === 'video' &&
            stream.codec_name === 'h264' &&
            stream.width === 1080 &&
            stream.height === 1920 &&
            stream.r_frame_rate === '30/1',
        ),
      );
      assert.ok(
        probe.streams.some(
          (stream: { codec_type: string; codec_name: string }) =>
            stream.codec_type === 'audio' && stream.codec_name === 'aac',
        ),
      );
      const accepted = await call(`/reels/${job.id}/accept`, 'POST', {});
      assert.equal(accepted.status, 201);
      const saved = await accepted.json();
      assert.equal(saved.origin, 'REEL_ASSEMBLED');
      assert.equal(saved.reelOutput.id, job.id);
      assert.equal(
        (
          await call(`/contents/${contentId}/media`, 'POST', {
            mediaAssetId: saved.id,
          })
        ).status,
        201,
      );
      assert.deepEqual(
        Buffer.from(
          await (await call(`/media/${saved.id}/file`)).arrayBuffer(),
        ),
        output,
      );
      assert.deepEqual(await readFile(image), img.bytes);
      assert.deepEqual(await readFile(video), clip.bytes);
      assert.deepEqual(await readFile(audio), voice.bytes);
      assert.equal(
        (await db.content.findUniqueOrThrow({ where: { id: contentId } })).body,
        'Original body',
      );
      assert.equal(
        await db.aiGeneration.count({ where: { userId: users[0]!.id } }),
        0,
      );
      const service = app.get(ReelService);
      const imageOnly = await call(`/contents/${contentId}/reels`, 'POST', {
        requestId: randomUUID(),
        scenes: [{ mediaAssetId: img.a.id, imageDurationSec: 1 }],
      });
      assert.equal(imageOnly.status, 201);
      const imageJob = await imageOnly.json();
      assert.equal((await complete(imageJob.id)).status, 'SUCCEEDED');
      assert.equal(
        (await call(`/reels/${imageJob.id}`, 'DELETE', {})).status,
        200,
      );
      assert.equal((await call(`/reels/${imageJob.id}/file`)).status, 404);

      const videoOnly = await call(`/contents/${contentId}/reels`, 'POST', {
        requestId: randomUUID(),
        scenes: [
          {
            mediaAssetId: clip.a.id,
            videoStartSec: 0,
            videoDurationSec: 1,
          },
        ],
      });
      assert.equal(videoOnly.status, 201);
      const videoJob = await videoOnly.json();
      assert.equal((await complete(videoJob.id)).status, 'SUCCEEDED');
      const videoFile = await call(`/reels/${videoJob.id}/file`);
      await writeFile(
        join(dir, 'video-only.mp4'),
        Buffer.from(await videoFile.arrayBuffer()),
      );
      const videoProbe = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type:format=duration',
            '-of',
            'json',
            join(dir, 'video-only.mp4'),
          ],
          { encoding: 'utf8' },
        ),
      );
      assert.equal(
        videoProbe.streams.some(
          (stream: { codec_type: string }) => stream.codec_type === 'audio',
        ),
        false,
      );
      assert.ok(Number(videoProbe.format.duration) <= 1.1);

      const invalid = await call(`/contents/${contentId}/reels`, 'POST', {
        requestId: randomUUID(),
        scenes: [
          { mediaAssetId: clip.a.id, videoStartSec: 1.5, videoDurationSec: 1 },
        ],
      });
      assert.equal(invalid.status, 400);
      const corruptPath = join(dir, 'corrupt.png');
      await writeFile(corruptPath, 'This is not a PNG');
      const corrupt = await asset(corruptPath, 'image/png');
      const failedRequest = await call(`/contents/${contentId}/reels`, 'POST', {
        requestId: randomUUID(),
        scenes: [{ mediaAssetId: corrupt.a.id, imageDurationSec: 1 }],
      });
      assert.equal(failedRequest.status, 201);
      const failedJob = await complete((await failedRequest.json()).id);
      assert.equal(failedJob.status, 'FAILED');
      assert.equal(failedJob.previewAvailable, false);
      const broken = await db.reelRender.create({
        data: {
          userId: users[0]!.id,
          contentId,
          requestId: randomUUID(),
          scenes: [],
          durationMs: 1000,
          status: 'RUNNING',
        },
      });
      service.onModuleDestroy();
      await service.onModuleInit();
      assert.equal(
        (await db.reelRender.findUniqueOrThrow({ where: { id: broken.id } }))
          .errorCode,
        'RENDER_INTERRUPTED',
      );
      service.now = () => new Date(Date.now() + 3_600_001);
      await service.sweep();
      assert.equal((await call(`/media/${saved.id}/file`)).status, 200);
      assert.equal((await call(`/reels/${videoJob.id}/file`)).status, 404);
    } finally {
      await app.close();
      const ownerIds = users.map((u) => u.id);
      await db.reelRender.deleteMany({ where: { userId: { in: ownerIds } } });
      await db.contentMedia.deleteMany({
        where: {
          content: {
            brand: { organization: { ownerUserId: { in: ownerIds } } },
          },
        },
      });
      await db.mediaAsset.deleteMany({ where: { id: { in: ids } } });
      await db.mediaAsset.deleteMany({
        where: {
          origin: 'REEL_ASSEMBLED',
          brand: { organization: { ownerUserId: { in: ownerIds } } },
        },
      });
      await db.content.deleteMany({
        where: { brand: { organization: { ownerUserId: { in: ownerIds } } } },
      });
      await db.brand.deleteMany({
        where: { organization: { ownerUserId: { in: ownerIds } } },
      });
      await db.organization.deleteMany({
        where: { ownerUserId: { in: ownerIds } },
      });
      await db.user.deleteMany({ where: { id: { in: ownerIds } } });
      await db.$disconnect();
      if (oldRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT;
      else process.env.MEDIA_STORAGE_ROOT = oldRoot;
      await rm(root, { recursive: true, force: true });
    }
  },
);
