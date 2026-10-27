import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { AiService, DEFAULTS } from '../ai/ai.service.js';
import { SpeechService } from '../ai/speech.service.js';
import {
  ElevenLabsProvider,
  ElevenFailure,
  SPEECH_MODEL,
} from '../ai/elevenlabs-provider.js';

test(
  'VOC-001–006: private voice lifecycle on real PostgreSQL with deterministic provider',
  { timeout: 60000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const root = await mkdtemp(join(tmpdir(), 'synvaro-voice-test-'));
    const previousRoot = process.env.MEDIA_STORAGE_ROOT;
    process.env.MEDIA_STORAGE_ROOT = root;
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const speech = app.get(SpeechService);
    const ai = app.get(AiService);
    let now = new Date('2026-10-27T17:00:00Z');
    speech.now = () => now;
    ai.now = () => now;
    const provider = app.get(ElevenLabsProvider);
    let configured = true,
      calls = 0;
    const voiceId = 'JBFqnCBsd6RMkjVDRZzb';
    const mp3 = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.5',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { maxBuffer: 1024 * 1024 },
    );
    provider.configured = () => configured;
    provider.voices = async () => [
      { id: voiceId, name: 'Premade test', languages: ['tr'] },
    ];
    let output = async () => ({
      bytes: mp3,
      mimeType: 'audio/mpeg',
      model: SPEECH_MODEL,
      characterCost: 14,
      providerGenerationId: 'test-tts-1',
    });
    provider.generate = async () => {
      calls++;
      return output();
    };
    const prefix = `voice-${randomUUID()}`;
    const users: { id: string; cookie: string }[] = [];
    let base = '',
      contentId = '',
      foreignContent = '',
      otherBrandContent = '';
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
    const preferences = (changes = {}) =>
      call('/ai/preferences', 'PUT', {
        ...DEFAULTS,
        speechEnabled: true,
        ...changes,
      });
    const generate = (changes = {}, cookie?: string, id = contentId) =>
      call(
        `/contents/${id}/speech-generations`,
        'POST',
        {
          requestId: randomUUID(),
          model: SPEECH_MODEL,
          voiceId,
          text: 'Merhaba dünya, bu yalnızca varsayımsal bir testtir.',
          confirmed: true,
          ...changes,
        },
        cookie,
      );
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
      const ownerOrg = await db.organization.create({
        data: {
          ownerUserId: users[0]!.id,
          name: prefix,
          slug: prefix,
        },
      });
      const foreignOrg = await db.organization.create({
        data: {
          ownerUserId: users[1]!.id,
          name: `${prefix}-foreign`,
          slug: `${prefix}-foreign`,
        },
      });
      const brand = await db.brand.create({
        data: {
          organizationId: ownerOrg.id,
          name: 'Hypothetical voice brand',
          slug: 'voice',
        },
      });
      const otherBrand = await db.brand.create({
        data: {
          organizationId: ownerOrg.id,
          name: 'Other',
          slug: 'other',
        },
      });
      const foreignBrand = await db.brand.create({
        data: {
          organizationId: foreignOrg.id,
          name: 'Foreign',
          slug: 'foreign',
        },
      });
      contentId = (
        await db.content.create({
          data: {
            brandId: brand.id,
            title: 'Saved title',
            body: 'Saved draft body',
          },
        })
      ).id;
      otherBrandContent = (
        await db.content.create({
          data: {
            brandId: otherBrand.id,
            title: 'Other draft',
          },
        })
      ).id;
      foreignContent = (
        await db.content.create({
          data: {
            brandId: foreignBrand.id,
            title: 'Foreign draft',
          },
        })
      ).id;

      await t.test(
        'VOC-002/005/006: catalog, preferences, auth, voice and selected budget block before paid call',
        async () => {
          assert.equal(
            (await call('/ai/voices', 'GET', undefined, '')).status,
            401,
          );
          assert.equal((await call('/ai/voices')).status, 200);
          assert.equal((await generate()).status, 409);
          configured = false;
          assert.equal((await generate()).status, 503);
          configured = true;
          await preferences({ monthlyBudgetUsd: 1 });
          assert.equal((await generate()).status, 409);
          await preferences();
          assert.equal((await generate({ confirmed: false })).status, 409);
          assert.equal(
            (await generate({ voiceId: 'abcdefghijklmnopqrst' })).status,
            400,
          );
          assert.equal((await generate({ model: 'wrong' })).status, 400);
          assert.equal(
            (await generate({ text: 'x'.repeat(2001) })).status,
            400,
          );
          assert.equal((await generate({}, '')).status, 401);
          assert.equal(
            (
              await call(
                `/contents/${contentId}/speech-generations`,
                'POST',
                {
                  requestId: randomUUID(),
                  model: SPEECH_MODEL,
                  voiceId,
                  text: 'Safe test narration',
                  confirmed: true,
                },
                users[0]!.cookie,
                'https://evil.example',
              )
            ).status,
            403,
          );
          assert.equal(
            (await generate({}, undefined, foreignContent)).status,
            404,
          );
          assert.equal((await generate({}, users[1]!.cookie)).status, 404);
          assert.equal((await generate({}, undefined, contentId)).status, 201);
          assert.equal(calls, 1);
        },
      );
      const first = await db.aiGeneration.findFirstOrThrow({
        where: {
          userId: users[0]!.id,
          kind: 'SPEECH',
          status: 'SUCCEEDED',
        },
      });
      await t.test(
        'VOC-001/003: Turkish preview is private and draft text is unchanged',
        async () => {
          assert.equal(first.provider, 'elevenlabs');
          assert.equal(first.model, SPEECH_MODEL);
          assert.equal(first.providerCharacterCost, 14);
          assert.equal(first.estimatedCostMicros, null);
          assert.equal(first.costUncertain, true);
          assert.equal(
            first.narrationCharacters,
            [...'Merhaba dünya, bu yalnızca varsayımsal bir testtir.'].length,
          );
          assert.equal(
            (
              await call(
                `/speech-generations/${first.id}/file`,
                'GET',
                undefined,
                '',
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await call(
                `/speech-generations/${first.id}/file`,
                'GET',
                undefined,
                users[1]!.cookie,
              )
            ).status,
            404,
          );
          const preview = await call(`/speech-generations/${first.id}/file`);
          assert.equal(preview.headers.get('content-type'), 'audio/mpeg');
          assert.deepEqual(Buffer.from(await preview.arrayBuffer()), mp3);
          assert.deepEqual(
            await db.content.findUniqueOrThrow({
              where: { id: contentId },
              select: { title: true, body: true },
            }),
            { title: 'Saved title', body: 'Saved draft body' },
          );
          assert.equal(
            (await generate({ requestId: first.requestId })).status,
            409,
          );
          assert.equal((await generate()).status, 409);
        },
      );
      await t.test(
        'VOC-004: save new audio, attach same brand, reject cross brand',
        async () => {
          const saved = await call(
            `/speech-generations/${first.id}/accept`,
            'POST',
            {},
          );
          assert.equal(saved.status, 201);
          const asset = await saved.json();
          assert.equal(asset.origin, 'AI_VOICE');
          assert.equal(asset.mimeType, 'audio/mpeg');
          assert.equal(asset.generation.voiceId, voiceId);
          assert.ok(asset.durationMs > 0);
          assert.deepEqual(
            Buffer.from(
              await (await call(`/media/${asset.id}/file`)).arrayBuffer(),
            ),
            mp3,
          );
          assert.equal(
            (
              await call(`/contents/${contentId}/media`, 'POST', {
                mediaAssetId: asset.id,
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await call(`/contents/${otherBrandContent}/media`, 'POST', {
                mediaAssetId: asset.id,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await call(`/contents/${foreignContent}/media`, 'POST', {
                mediaAssetId: asset.id,
              })
            ).status,
            404,
          );
          assert.equal(
            (await call(`/speech-generations/${first.id}/accept`, 'POST', {}))
              .status,
            201,
          );
          assert.equal(
            (await call(`/speech-generations/${first.id}/file`)).status,
            404,
          );
        },
      );
      await t.test(
        'VOC-003/005: discard, expiry, malformed audio, failure and one active request',
        async () => {
          let response = await generate();
          assert.equal(response.status, 201);
          let row = await response.json();
          assert.equal(
            (await call(`/speech-generations/${row.id}`, 'DELETE', {})).status,
            200,
          );
          assert.equal(
            (await call(`/speech-generations/${row.id}/file`)).status,
            404,
          );
          response = await generate();
          row = await response.json();
          now = new Date(now.getTime() + 3_600_001);
          assert.equal(
            (await call(`/speech-generations/${row.id}/file`)).status,
            404,
          );
          await speech.sweep();
          assert.equal(
            (await db.aiGeneration.findUniqueOrThrow({ where: { id: row.id } }))
              .previewKey,
            null,
          );
          output = async () => ({
            bytes: Buffer.from('not mp3'),
            mimeType: 'audio/mpeg',
            model: SPEECH_MODEL,
            characterCost: 14,
            providerGenerationId: 'bad',
          });
          assert.equal((await generate()).status, 503);
          output = async () => {
            throw new ElevenFailure('RATE_LIMIT', 429);
          };
          assert.equal((await generate()).status, 503);
          const failure = await db.aiGeneration.findFirstOrThrow({
            where: {
              userId: users[0]!.id,
              kind: 'SPEECH',
              errorCode: 'ELEVEN_RATE_LIMIT',
            },
          });
          assert.equal(failure.costUncertain, true);
          assert.equal(failure.estimatedCostMicros, null);
          output = async () => ({
            bytes: mp3,
            mimeType: 'audio/mpeg',
            model: SPEECH_MODEL,
            characterCost: 14,
            providerGenerationId: 'ok',
          });
          let release!: () => void;
          let entered!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const started = new Promise<void>((resolve) => {
            entered = resolve;
          });
          provider.generate = async () => {
            calls++;
            entered();
            await gate;
            return output();
          };
          const pending = generate();
          await started;
          assert.equal((await generate()).status, 409);
          release();
          const done = await pending;
          assert.equal(done.status, 201);
          const last = await done.json();
          await call(`/speech-generations/${last.id}`, 'DELETE', {});
        },
      );
      assert.equal(
        (await call(`/contents/${contentId}/speech-generations/latest`)).status,
        200,
      );
    } finally {
      await app.close();
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      if (previousRoot === undefined) delete process.env.MEDIA_STORAGE_ROOT;
      else process.env.MEDIA_STORAGE_ROOT = previousRoot;
    }
  },
);
