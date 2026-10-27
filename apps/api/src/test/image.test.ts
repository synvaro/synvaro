import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { LocalMediaStorage } from '../media/storage.js';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { AiService, DEFAULTS } from '../ai/ai.service.js';
import { ImageService } from '../ai/image.service.js';
import {
  OpenAIImageProvider,
  IMAGE_MODEL,
  IMAGE_SIZES,
  IMAGE_QUALITIES,
  IMAGE_COST_NOTICE,
  type ImageRequest,
  type ImageResult,
} from '../ai/image-provider.js';
import { OpenAITextProvider } from '../ai/text-provider.js';

test(
  'IMG-001–007: real PostgreSQL, private files, deterministic image provider',
  { timeout: 60000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const oldRoot = process.env.MEDIA_STORAGE_ROOT;
    const root = await mkdtemp(join(tmpdir(), 'synvaro-image-test-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    const db = createDatabase(config.databaseUrl),
      app = await createApp();
    const service = app.get(ImageService);
    let now = new Date('2026-10-26T16:00:00Z');
    service.now = () => now;
    app.get(AiService).now = () => now;
    const provider = app.get(OpenAIImageProvider);
    let configured = true,
      calls = 0,
      observed: ImageRequest | undefined;
    provider.configured = () => configured;
    const png = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#225588' },
    })
      .png()
      .toBuffer();
    const normal = async (): Promise<ImageResult> => ({
      bytes: png,
      inputTextTokens: 100,
      inputImageTokens: 0,
      outputTokens: 200,
    });
    let behavior = normal;
    provider.generate = async (r) => {
      calls++;
      observed = r;
      now = new Date(now.getTime() + 1);
      return behavior();
    };
    app.get(OpenAITextProvider).configured = () => true;
    app.get(OpenAITextProvider).count = async () => 100;
    const prefix = `img-${randomUUID()}`,
      users: { id: string; cookie: string }[] = [];
    let base = '',
      contentId = '',
      brandId = '',
      otherContent = '';
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
    const prefs = (changes = {}) =>
      call('/ai/preferences', 'PUT', {
        ...DEFAULTS,
        enabled: true,
        imageEnabled: true,
        ...changes,
      });
    const generate = (changes = {}, cookie?: string, id = contentId) =>
      call(
        `/contents/${id}/image-generations`,
        'POST',
        {
          requestId: randomUUID(),
          instruction: 'Hypothetical atmospheric illustration',
          confirmed: true,
          ...changes,
        },
        cookie,
      );
    const discard = (id: string) =>
      call(`/image-generations/${id}`, 'DELETE', {});
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (let i = 0; i < 2; i++) {
        const email = `${prefix}-${i}@example.test`,
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
      const org = await db.organization.create({
        data: { ownerUserId: users[0]!.id, name: prefix, slug: prefix },
      });
      const brand = await db.brand.create({
        data: {
          organizationId: org.id,
          name: 'Hypothetical kitchen',
          slug: 'kitchen',
          description: 'Short context',
          profile: {
            create: {
              description: 'Conceptual only',
              defaultLanguage: 'tr-TR',
              toneOfVoice: 'Warm',
              targetAudience: 'Adults',
              contentGuidelines: 'No invented claims',
            },
          },
        },
      });
      brandId = brand.id;
      const content = await db.content.create({
        data: { brandId, title: 'Breakfast concept', body: 'Original draft' },
      });
      contentId = content.id;
      const other = await db.brand.create({
        data: { organizationId: org.id, name: 'Other brand', slug: 'other' },
      });
      otherContent = (
        await db.content.create({
          data: { brandId: other.id, title: 'Other draft' },
        })
      ).id;
      await t.test(
        'IMG-002/006: defaults, missing configuration, strict settings, confirmation and selected budget block before payment',
        async () => {
          assert.deepEqual(
            await (
              await call(`/contents/${contentId}/image-generations/latest`)
            ).json(),
            { generation: null },
          );
          assert.equal((await generate()).status, 409);
          await prefs();
          configured = false;
          assert.equal((await generate()).status, 503);
          configured = true;
          assert.equal((await generate({ confirmed: false })).status, 409);
          for (const change of [
            { imageModel: 'unsupported' },
            { imageSize: 'auto' },
            { imageQuality: 'max' },
            { ownerUserId: users[1]!.id },
          ])
            assert.equal((await prefs(change)).status, 400);
          for (const budget of [0, 1, 100]) {
            await prefs({ monthlyBudgetUsd: budget });
            assert.equal((await generate()).status, 409);
          }
          assert.equal(calls, 0);
          await prefs();
          // Legacy text-only preference writes preserve image settings.
          const legacy = {
            enabled: true,
            model: DEFAULTS.model,
            maxOutputTokens: 512,
            monthlyBudgetUsd: null,
            confirmPaid: true,
          };
          await call('/ai/preferences', 'PUT', legacy);
          assert.equal(
            (await (await call('/ai/preferences')).json()).preferences
              .imageEnabled,
            true,
          );
        },
      );
      await t.test(
        'IMG-002/006 PR #17: all nine settings preserve shared USD 1 budget under concurrent requests',
        async () => {
          // A prior settled text charge is a fixture, not paid provider evidence.
          await db.aiGeneration.create({
            data: {
              userId: users[0]!.id,
              contentId,
              requestId: randomUUID(),
              kind: 'TEXT',
              model: DEFAULTS.model,
              maxOutputTokens: 512,
              status: 'SUCCEEDED',
              inputTokens: 100,
              outputTokens: 50,
              estimatedCostMicros: 38,
              budgetChargeMicros: 38,
              createdAt: now,
              completedAt: now,
            },
          });
          const ledger = await db.aiGeneration.findMany({
            where: { userId: users[0]!.id },
            orderBy: { id: 'asc' },
          });
          const callsBefore = calls;
          for (const imageSize of IMAGE_SIZES)
            for (const imageQuality of IMAGE_QUALITIES) {
              assert.equal(
                (
                  await prefs({
                    monthlyBudgetUsd: 1,
                    imageSize,
                    imageQuality,
                    confirmPaid: false,
                  })
                ).status,
                200,
              );
              const before = await db.aiPreference.findUniqueOrThrow({
                where: { userId: users[0]!.id },
              });
              const responses = await Promise.all([generate(), generate()]);
              for (const response of responses) {
                assert.equal(
                  response.status,
                  409,
                  `${imageSize}/${imageQuality}`,
                );
                assert.equal(
                  (await response.json()).message,
                  IMAGE_COST_NOTICE,
                );
              }
              assert.deepEqual(
                await db.aiPreference.findUnique({
                  where: { userId: users[0]!.id },
                }),
                before,
              );
              assert.equal(before.monthlyBudgetMicros, 1000000n);
            }
          assert.equal(calls, callsBefore);
          assert.deepEqual(
            await db.aiGeneration.findMany({
              where: { userId: users[0]!.id },
              orderBy: { id: 'asc' },
            }),
            ledger,
          );
          const settings = await (await call('/ai/preferences')).json();
          assert.equal(settings.preferences.monthlyBudgetUsd, 1);
          assert.equal(settings.usage.chargedOrReservedUsd, 0.000038);
          assert.equal(settings.image.costBoundAvailable, false);
          assert.equal(settings.image.costNotice, IMAGE_COST_NOTICE);
          await prefs();
        },
      );
      let savedId = '';
      await t.test(
        'IMG-001/003/004/005: context, protected bytes, provenance, idempotent save, attach without copying or text changes',
        async () => {
          const response = await generate();
          assert.equal(response.status, 201);
          const result = await response.json();
          assert.equal(result.estimatedCostUsd, 0.0065);
          assert.equal(result.costUncertain, false);
          assert.ok(observed!.prompt.includes('tr-TR'));
          assert.ok(observed!.prompt.includes('Warm'));
          assert.ok(observed!.prompt.includes('untrusted'));
          assert.ok(!observed!.prompt.includes(users[0]!.id));
          assert.equal(observed!.model, IMAGE_MODEL);
          assert.ok(!JSON.stringify(result).includes('previewKey'));
          const record = await db.aiGeneration.findUniqueOrThrow({
            where: { id: result.id },
          });
          assert.ok(
            !JSON.stringify(record).includes('Hypothetical atmospheric'),
          );
          const file = await call(`/image-generations/${result.id}/file`);
          assert.equal(file.status, 200);
          assert.equal(file.headers.get('content-type'), 'image/png');
          assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
          assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
          assert.equal((await generate()).status, 409);
          const saved = await call(
            `/image-generations/${result.id}/accept`,
            'POST',
            {},
          );
          assert.equal(saved.status, 201);
          const asset = await saved.json();
          savedId = asset.id;
          assert.equal(asset.origin, 'AI_GENERATED');
          assert.equal(asset.brandId, brandId);
          assert.equal(asset.generation.id, result.id);
          assert.equal(asset.generation.model, IMAGE_MODEL);
          const concurrentSaves = await Promise.all([
            call(`/image-generations/${result.id}/accept`, 'POST', {}),
            call(`/image-generations/${result.id}/accept`, 'POST', {}),
          ]);
          for (const response of concurrentSaves) {
            assert.equal(response.status, 201);
            assert.equal((await response.json()).id, savedId);
          }

          assert.equal(
            (
              await (
                await call(`/image-generations/${result.id}/accept`, 'POST', {})
              ).json()
            ).id,
            savedId,
          );
          assert.equal((await discard(result.id)).status, 409);
          assert.deepEqual(await readdir(root), [record.previewKey]);
          assert.equal(
            (
              await call(`/contents/${contentId}/media`, 'POST', {
                mediaAssetId: savedId,
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await call(`/contents/${otherContent}/media`, 'POST', {
                mediaAssetId: savedId,
              })
            ).status,
            404,
          );
          const file2 = await call(`/media/${savedId}/file`);
          assert.deepEqual(Buffer.from(await file2.arrayBuffer()), png);
          assert.equal(
            (await (await call(`/media/${savedId}`)).json()).asset.generation
              .id,
            result.id,
          );
          assert.deepEqual(
            await db.content.findUnique({ where: { id: contentId } }),
            content,
          );
          assert.equal((await readdir(root)).length, 1);
        },
      );
      await t.test(
        'IMG-007: authentication, CSRF, unknown/foreign drafts and preview/save/discard isolation',
        async () => {
          const before = calls;
          assert.equal((await generate({}, '')).status, 401);
          for (const id of [contentId, randomUUID()])
            assert.equal(
              (await generate({}, users[1]!.cookie, id)).status,
              404,
            );
          assert.equal(
            (await generate({}, undefined, otherContent)).status,
            409,
          );
          for (const bad of [
            { instruction: '' },
            { instruction: 'x'.repeat(1001) },
            { brandId },
            { model: IMAGE_MODEL },
          ])
            assert.equal((await generate(bad)).status, 400);
          assert.equal(calls, before);
          const r = await (await generate()).json();
          for (const suffix of ['', '/file', '/accept']) {
            const method = suffix === '/accept' ? 'POST' : 'GET';
            const a = await call(
              `/image-generations/${r.id}${suffix}`,
              method,
              method === 'POST' ? {} : undefined,
              users[1]!.cookie,
            );
            const b = await call(
              `/image-generations/${randomUUID()}${suffix}`,
              method,
              method === 'POST' ? {} : undefined,
              users[1]!.cookie,
            );
            assert.equal(a.status, 404);
            assert.deepEqual(await a.json(), await b.json());
            assert.equal(
              (
                await call(
                  `/image-generations/${r.id}${suffix}`,
                  method,
                  method === 'POST' ? {} : undefined,
                  '',
                )
              ).status,
              401,
            );
          }
          assert.equal(
            (
              await call(
                `/image-generations/${r.id}`,
                'DELETE',
                {},
                users[1]!.cookie,
              )
            ).status,
            404,
          );
          for (const [path, method] of [
            [`/contents/${contentId}/image-generations`, 'POST'],
            [`/image-generations/${r.id}/accept`, 'POST'],
            [`/image-generations/${r.id}`, 'DELETE'],
          ])
            assert.equal(
              (
                await call(
                  path!,
                  method!,
                  {},
                  users[0]!.cookie,
                  'https://evil.example',
                )
              ).status,
              403,
            );
          await discard(r.id);
          assert.equal(
            (await call(`/image-generations/${r.id}/file`)).status,
            404,
          );
          assert.equal((await readdir(root)).length, 1);
        },
      );
      await t.test(
        'IMG-006: concurrency, duplicate protection, shared text/settings lock, recovery without retries',
        async () => {
          let release!: () => void, started!: () => void;
          const entered = new Promise<void>((r) => {
              started = r;
            }),
            wait = new Promise<void>((r) => {
              release = r;
            });
          behavior = async () => {
            started();
            await wait;
            return normal();
          };
          const requestId = randomUUID(),
            first = generate({ requestId });
          await entered;
          assert.equal((await generate()).status, 409);
          assert.equal((await prefs()).status, 409);
          assert.equal(
            (
              await call(`/contents/${contentId}/ai-generations`, 'POST', {
                requestId: randomUUID(),
                confirmed: true,
              })
            ).status,
            409,
          );
          release();
          const response = await first;
          assert.equal(response.status, 201);
          const r = await response.json();
          const before = calls;
          assert.equal(
            (
              await (
                await call(`/contents/${contentId}/image-generations/latest`)
              ).json()
            ).generation.id,
            r.id,
          );
          assert.equal(calls, before);
          await discard(r.id);
          assert.equal((await generate({ requestId })).status, 409);
          behavior = normal;
        },
      );
      await t.test(
        'IMG-006/007: invalid output, timeout and failure compensation, missing usage, expired pricing',
        async () => {
          for (const bytes of [
            Buffer.from('not PNG'),
            await sharp({
              create: { width: 32, height: 32, channels: 3, background: 'red' },
            })
              .png()
              .toBuffer(),
            Buffer.alloc(20 * 1024 * 1024 + 1),
          ]) {
            behavior = async () => ({ ...(await normal()), bytes });
            assert.equal((await generate()).status, 503);
            assert.equal((await readdir(root)).length, 1);
          }
          for (const name of ['APIConnectionTimeoutError', 'ProviderError']) {
            behavior = async () => {
              const e = new Error('SECRET_RAW_PROVIDER_ERROR');
              e.name = name;
              throw e;
            };
            const before = calls,
              r = await generate();
            assert.equal(r.status, 503);
            assert.ok(!(await r.text()).includes('SECRET'));
            assert.equal(calls, before + 1);
          }
          behavior = async () => ({ bytes: png });
          const r = await (await generate()).json();
          assert.equal(r.costUncertain, true);
          assert.equal(r.estimatedCostUsd, null);
          await discard(r.id);
          await prefs({ monthlyBudgetUsd: 1 });
          assert.equal(
            (
              await call(`/contents/${contentId}/ai-generations`, 'POST', {
                requestId: randomUUID(),
                confirmed: true,
              })
            ).status,
            409,
          );
          await prefs();
          behavior = normal;
          now = new Date('2026-11-26');
          assert.equal((await generate()).status, 503);
          now = new Date('2026-10-26T16:00:00Z');
        },
      );
      await t.test(
        'IMG-003/007: expiry blocks access and acceptance; cleanup preserves accepted files and charge evidence',
        async () => {
          const r = await (await generate()).json();
          now = new Date(now.getTime() + 3600001);
          assert.equal(
            (await call(`/image-generations/${r.id}/file`)).status,
            404,
          );
          assert.equal(
            (await call(`/image-generations/${r.id}/accept`, 'POST', {}))
              .status,
            404,
          );
          await service.sweep();
          assert.equal((await readdir(root)).length, 1);
          const record = await db.aiGeneration.findUniqueOrThrow({
            where: { id: r.id },
          });
          assert.equal(record.previewKey, null);
          assert.equal(record.estimatedCostMicros, 6500);
          assert.equal((await call(`/media/${savedId}/file`)).status, 200);
          const storage = app.get(LocalMediaStorage),
            key = randomUUID();
          await storage.stage(key, Readable.from(png));
          const interrupted = await db.aiGeneration.create({
            data: {
              userId: users[0]!.id,
              contentId,
              requestId: randomUUID(),
              kind: 'IMAGE',
              model: IMAGE_MODEL,
              maxOutputTokens: 0,
              status: 'RUNNING',
              costUncertain: true,
              previewKey: key,
              previewExpiresAt: new Date(now.getTime() - 1),
            },
          });
          const remove = storage.remove.bind(storage);
          storage.remove = async () => {
            throw new Error('test-only storage failure');
          };
          await service.sweep();
          assert.equal(
            (
              await db.aiGeneration.findUniqueOrThrow({
                where: { id: interrupted.id },
              })
            ).previewKey,
            key,
          );
          storage.remove = remove;
          await service.sweep();
          const retained = await db.aiGeneration.findUniqueOrThrow({
            where: { id: interrupted.id },
          });
          assert.equal(retained.previewKey, null);
          assert.equal(retained.status, 'RUNNING');
          assert.equal(retained.costUncertain, true);
          assert.equal((await generate()).status, 409);
          assert.equal((await readdir(root)).length, 1);

          const doc = await (await call('/openapi.json')).json();
          for (const path of [
            '/contents/{id}/image-generations',
            '/contents/{id}/image-generations/latest',
            '/image-generations/{id}',
            '/image-generations/{id}/file',
            '/image-generations/{id}/accept',
          ])
            assert.ok(doc.paths[path]);
        },
      );
    } finally {
      await app.close();
      await db.aiGeneration.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await db.contentMedia.deleteMany({
        where: {
          content: {
            brand: {
              organization: { ownerUserId: { in: users.map((u) => u.id) } },
            },
          },
        },
      });
      await db.mediaAsset.deleteMany({
        where: {
          brand: {
            organization: { ownerUserId: { in: users.map((u) => u.id) } },
          },
        },
      });
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      if (oldRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT;
      else process.env.MEDIA_STORAGE_ROOT = oldRoot;
    }
  },
);
