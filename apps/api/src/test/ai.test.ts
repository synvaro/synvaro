import { GoogleTextProvider } from '../ai/google-text-provider.js';
import { GoogleFailure } from '../ai/google-failure.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { AiService, DEFAULTS } from '../ai/ai.service.js';
import { MODEL, OpenAITextProvider } from '../ai/text-provider.js';
import type { TextRequest, TextResult } from '../ai/text-provider.js';

test(
  'AIG-001–005: HTTP / real PostgreSQL / deterministic provider',
  { timeout: 30000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const service = app.get(AiService);
    let now = new Date('2026-10-26T16:00:00Z');
    service.now = () => now;
    const googleProvider = app.get(GoogleTextProvider);
    let googleCalls = 0;
    googleProvider.configured = () => true;
    googleProvider.count = async () => 100;
    googleProvider.generate = async (req) => {
      googleCalls++;
      return {
        text: 'Hypothetical Gemini suggestion',
        model: req.model,
        inputTokens: 100,
        outputTokens: 50,
      };
    };
    const provider = app.get(OpenAITextProvider);
    let configured = true,
      calls = 0,
      count = 100;
    let observed: TextRequest | undefined;
    let behavior: () => Promise<TextResult> = async () => ({
      text: 'Hypothetical suggestion, not a released capability.',
      model: MODEL,
      inputTokens: 100,
      outputTokens: 50,
    });
    provider.configured = () => configured;
    provider.count = async (request) => {
      observed = request;
      return count;
    };
    provider.generate = async (request) => {
      observed = request;
      calls++;
      return behavior();
    };
    const prefix = `ai-${randomUUID()}`;
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
    const preferences = (changes = {}) =>
      call('/ai/preferences', 'PUT', {
        ...DEFAULTS,
        enabled: true,
        ...changes,
      });
    let contentId = '';
    const generate = (changes = {}, cookie?: string, id = contentId) =>
      call(
        `/contents/${id}/ai-generations`,
        'POST',
        { requestId: randomUUID(), confirmed: true, ...changes },
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
      const org = await db.organization.create({
        data: { ownerUserId: users[0]!.id, name: prefix, slug: prefix },
      });
      const brand = await db.brand.create({
        data: {
          organizationId: org.id,
          name: 'Qos Workspace',
          slug: 'qos',
          description: 'Short summary',
          profile: {
            create: {
              description: 'Hypothetical brand context',
              defaultLanguage: 'tr-TR',
              toneOfVoice: 'Warm and factual',
              targetAudience: 'Small business teams',
              contentGuidelines: 'No released feature claims',
            },
          },
        },
      });
      const content = await db.content.create({
        data: {
          brandId: brand.id,
          title: 'Hypothetical idea',
          body: 'Original body',
        },
      });
      contentId = content.id;
      await t.test(
        'AIP-001/003/004: authenticated catalog, strict model selection and persisted compatibility',
        async () => {
          assert.equal(
            (await call('/ai/models', 'GET', undefined, '')).status,
            401,
          );
          const response = await call('/ai/models');
          assert.equal(response.status, 200);
          assert.equal(
            response.headers.get('cache-control'),
            'private, no-store',
          );
          const catalog = await response.json();
          assert.equal(
            catalog.models.filter(
              (m: { implemented: boolean }) => m.implemented,
            ).length,
            3,
          );
          assert.ok(!JSON.stringify(catalog).includes('API_KEY'));
          const before = await db.aiPreference.findUnique({
            where: { userId: users[0]!.id },
          });
          const records = await db.aiGeneration.count({
            where: { userId: users[0]!.id },
          });
          for (const change of [
            { model: 'gemini-unknown' },
            { model: 'gpt-image-2.5-flare' },
            { imageModel: MODEL },
            { imageModel: 'gemini-nano-banana-2.1' },
            { provider: 'google' },
            { capability: 'VIDEO_GENERATION' },
          ])
            assert.equal((await preferences(change)).status, 400);
          assert.equal(
            (await generate({ model: 'gemini-3.8-flash' })).status,
            400,
          );
          assert.equal((await generate({ provider: 'google' })).status, 400);
          assert.deepEqual(
            await db.aiPreference.findUnique({
              where: { userId: users[0]!.id },
            }),
            before,
          );
          assert.equal(
            await db.aiGeneration.count({ where: { userId: users[0]!.id } }),
            records,
          );
          assert.equal(calls, 0);
        },
      );
      await t.test(
        'AIG-001-A1 / AIG-004-A1: conservative defaults, disabled, missing key, confirmation and strict preferences',
        async () => {
          const initial = await (await call('/ai/preferences')).json();
          assert.deepEqual(initial.preferences, DEFAULTS);
          assert.equal((await generate()).status, 409);
          assert.equal((await preferences()).status, 200);
          configured = false;
          assert.equal(
            (await (await call('/ai/preferences')).json()).available,
            false,
          );
          assert.equal((await generate()).status, 503);
          configured = true;
          assert.equal((await generate({ confirmed: false })).status, 409);
          for (const change of [
            { model: 'unsupported' },
            { maxOutputTokens: 2049 },
            { maxOutputTokens: 127 },
            { monthlyBudgetUsd: -1 },
            { monthlyBudgetUsd: 0.001 },
            { apiKey: 'not-a-key' },
            { userId: users[1]!.id },
          ])
            assert.equal((await preferences(change)).status, 400);
          assert.equal(calls, 0);
        },
      );
      await t.test(
        'AIG-002-A1 / AIG-003-A1 / AIG-005-A1: context, usage, preview never writes Content, explicit PATCH',
        async () => {
          const response = await generate({
            instruction: 'Write a hypothetical example',
          });
          assert.equal(response.status, 201);
          const result = await response.json();
          assert.equal(result.estimatedCostUsd, 0.000038);
          const context = JSON.parse(observed!.context);
          assert.equal(context.brand.profile.defaultLanguage, 'tr-TR');
          assert.equal(context.brand.profile.toneOfVoice, 'Warm and factual');
          assert.equal(context.brand.description, 'Short summary');
          assert.equal(context.draft.body, 'Original body');
          assert.equal(context.request, 'Write a hypothetical example');
          assert.ok(!observed!.context.includes(users[0]!.id));
          assert.ok(!observed!.context.includes('password'));
          assert.deepEqual(
            await db.content.findUnique({ where: { id: contentId } }),
            content,
          );
          const record = await db.aiGeneration.findUniqueOrThrow({
            where: { id: result.generationId },
          });
          assert.equal(record.status, 'SUCCEEDED');
          assert.equal(record.userId, users[0]!.id);
          assert.equal(record.contentId, contentId);
          assert.equal(record.outputTokens, 50);
          assert.equal(record.budgetChargeMicros, 38);
          assert.ok(!JSON.stringify(record).includes(result.text));
          assert.equal(
            (
              await call(`/contents/${contentId}`, 'PATCH', {
                body: result.text,
              })
            ).status,
            200,
          );
          assert.equal(
            (await (await call(`/contents/${contentId}`)).json()).content.body,
            result.text,
          );
        },
      );
      await t.test(
        'AIG-005-A2: foreign/unknown IDs, authentication, CSRF, unsupported input',
        async () => {
          const a = await generate({}, users[1]!.cookie),
            b = await generate({}, users[1]!.cookie, randomUUID());
          assert.equal(a.status, 404);
          assert.equal(b.status, 404);
          assert.deepEqual(await a.json(), await b.json());
          assert.equal((await generate({}, '')).status, 401);
          assert.equal(
            (await call('/ai/preferences', 'GET', undefined, '')).status,
            401,
          );
          for (const path of [
            '/ai/preferences',
            `/contents/${contentId}/ai-generations`,
          ])
            assert.equal(
              (
                await call(
                  path,
                  path.includes('preferences') ? 'PUT' : 'POST',
                  {},
                  users[0]!.cookie,
                  'https://evil.example',
                )
              ).status,
              403,
            );
          for (const input of [
            { instruction: 'x'.repeat(1001) },
            { ownerUserId: users[1]!.id },
            { model: MODEL },
            { requestId: 'bad' },
          ])
            assert.equal((await generate(input)).status, 400);
          const noProfile = await db.brand.create({
            data: {
              organizationId: org.id,
              name: 'ISIS Türkiye',
              slug: 'isis',
            },
          });
          const other = await db.content.create({
            data: { brandId: noProfile.id, title: 'No profile' },
          });
          assert.equal((await generate({}, undefined, other.id)).status, 409);
          assert.equal(
            (
              await (
                await call(
                  '/ai/preferences',
                  'GET',
                  undefined,
                  users[1]!.cookie,
                )
              ).json()
            ).usage.requests,
            0,
          );
        },
      );
      await t.test(
        'AIG-004-A2: zero budget, concurrency, no duplicate retry, preference lock, monthly reset',
        async () => {
          assert.equal(
            (await preferences({ monthlyBudgetUsd: 0 })).status,
            200,
          );
          const before = calls;
          assert.equal((await generate()).status, 409);
          assert.equal(calls, before);
          await preferences({ monthlyBudgetUsd: 0.01, maxOutputTokens: 2048 });
          count = 16000;
          let release!: () => void;
          let started!: () => void;
          const entered = new Promise<void>((resolve) => {
            started = resolve;
          });
          const wait = new Promise<void>((resolve) => {
            release = resolve;
          });
          behavior = async () => {
            started();
            await wait;
            return {
              text: 'Concurrent hypothetical text',
              model: MODEL,
              inputTokens: 16000,
              outputTokens: 2048,
            };
          };
          const requestId = randomUUID();
          const first = generate({ requestId });
          await entered;
          assert.equal((await generate()).status, 409);
          assert.equal((await preferences()).status, 409);
          release();
          assert.equal((await first).status, 201);
          assert.equal((await generate({ requestId })).status, 409);
          behavior = async () => ({
            text: 'Hypothetical bounded text',
            model: MODEL,
            inputTokens: 16000,
            outputTokens: 2048,
          });
          assert.equal((await generate()).status, 201);
          assert.equal((await generate()).status, 201);
          assert.equal((await generate()).status, 409);
          now = new Date('2026-11-01T00:00:00Z');
          assert.equal((await generate()).status, 201);
          now = new Date('2026-11-26T00:00:00Z');
          assert.equal((await generate()).status, 503);
          now = new Date('2026-10-26T16:00:00Z');
        },
      );
      await t.test(
        'AIG-005-A1 / AIG-004-A2: timeout, failures, missing usage retain reservation; budget fails closed',
        async () => {
          await preferences();
          count = 100;
          for (const name of ['APIConnectionTimeoutError', 'ProviderError']) {
            behavior = async () => {
              const error = new Error('SECRET_PROVIDER_ERROR');
              error.name = name;
              throw error;
            };
            const before = calls;
            const response = await generate();
            assert.equal(response.status, 503);
            assert.ok(!(await response.text()).includes('SECRET'));
            assert.equal(calls, before + 1);
          }
          const failed = await db.aiGeneration.findMany({
            where: { userId: users[0]!.id, errorCode: 'PROVIDER_FAILED' },
          });
          assert.equal(failed.length, 2);
          assert.ok(
            failed.every(
              (row) => row.costUncertain && row.budgetChargeMicros > 0,
            ),
          );
          await preferences({ monthlyBudgetUsd: 100 });
          assert.equal((await generate()).status, 409);
          await preferences();
          behavior = async () => ({
            text: 'No usage hypothetical text',
            model: MODEL,
          });
          const result = await (await generate()).json();
          assert.equal(result.usage, null);
          assert.equal(result.costUncertain, true);
          assert.ok(result.reservedOrChargedUsd > 0);
          count = 16385;
          const before = calls;
          assert.equal((await generate()).status, 400);
          assert.equal(calls, before);
          count = 100;
          const record = await db.aiGeneration.create({
            data: {
              userId: users[0]!.id,
              contentId,
              requestId: randomUUID(),
              model: MODEL,
              maxOutputTokens: 512,
              status: 'RUNNING',
              budgetChargeMicros: 100,
            },
          });
          assert.equal((await generate()).status, 409);
          await db.aiGeneration.delete({ where: { id: record.id } });
        },
      );
      await t.test(
        'AIP-004: catalog leaves existing preferences and uncertain spending untouched',
        async () => {
          const where = { userId: users[0]!.id };
          const prefsBefore = await db.aiPreference.findUnique({ where });
          const ledgerBefore = await db.aiGeneration.findMany({
            where,
            orderBy: { id: 'asc' },
          });
          assert.ok(
            ledgerBefore.some(
              (r) => r.costUncertain && r.budgetChargeMicros > 0,
            ),
          );
          await call('/ai/models');
          assert.deepEqual(
            await db.aiPreference.findUnique({ where }),
            prefsBefore,
          );
          assert.deepEqual(
            await db.aiGeneration.findMany({ where, orderBy: { id: 'asc' } }),
            ledgerBefore,
          );
        },
      );
      await t.test(
        'AIG-G001: Google selection, shared budget, attribution, isolation and no overwrite',
        async () => {
          await db.aiGeneration.deleteMany({ where: { userId: users[0]!.id } });
          const original = await db.content.findUniqueOrThrow({
            where: { id: contentId },
          });
          await db.aiGeneration.create({
            data: {
              userId: users[0]!.id,
              contentId,
              requestId: randomUUID(),
              model: MODEL,
              provider: 'openai',
              maxOutputTokens: 512,
              status: 'SUCCEEDED',
              budgetChargeMicros: 990000,
              createdAt: now,
            },
          });
          assert.equal(
            (
              await preferences({
                model: 'gemini-3.8-flash',
                monthlyBudgetUsd: 1,
                maxOutputTokens: 2048,
              })
            ).status,
            200,
          );
          assert.equal((await generate()).status, 409);
          assert.equal(googleCalls, 0);
          assert.equal(
            (
              await preferences({
                model: 'gemini-3.8-flash',
                monthlyBudgetUsd: null,
              })
            ).status,
            200,
          );
          assert.equal((await generate({}, users[1]!.cookie)).status, 404);
          const requestId = randomUUID();
          const response = await generate({ requestId });
          assert.equal(response.status, 201);
          const result = await response.json();
          assert.equal(result.text, 'Hypothetical Gemini suggestion');
          assert.equal(result.estimatedCostUsd, 0.000525);
          assert.equal(googleCalls, 1);
          assert.equal((await generate({ requestId })).status, 409);
          const row = await db.aiGeneration.findUniqueOrThrow({
            where: { id: result.generationId },
          });
          assert.equal(row.provider, 'google');
          assert.equal(row.model, 'gemini-3.8-flash');
          assert.equal(row.budgetChargeMicros, 525);
          assert.deepEqual(
            await db.content.findUniqueOrThrow({ where: { id: contentId } }),
            original,
          );
          let signalEntered!: () => void;
          let releaseGeneration!: () => void;
          const entered = new Promise<void>((resolve) => {
            signalEntered = resolve;
          });
          const release = new Promise<void>((resolve) => {
            releaseGeneration = resolve;
          });
          googleProvider.generate = async (request) => {
            signalEntered();
            await release;
            return {
              text: 'Hypothetical',
              model: request.model,
              inputTokens: 100,
              outputTokens: 50,
            };
          };
          const first = generate();
          await entered;
          assert.equal((await generate()).status, 409);
          releaseGeneration();
          assert.equal((await first).status, 201);
          googleProvider.generate = async () => {
            throw new GoogleFailure('TIMEOUT', 'generate', 60_001);
          };
          const failed = await generate();
          assert.equal(failed.status, 503);
          const failedBody = await failed.text();
          assert.ok(!failedBody.includes('SECRET'));
          assert.ok(!failedBody.includes('GOOGLE_TIMEOUT'));
          const uncertain = await db.aiGeneration.findFirst({
            where: {
              userId: users[0]!.id,
              provider: 'google',
              costUncertain: true,
            },
          });
          assert.equal(uncertain?.errorCode, 'GOOGLE_TIMEOUT');
          assert.ok((uncertain?.budgetChargeMicros ?? 0) > 0);
          assert.ok(uncertain && uncertain.budgetChargeMicros > 0);
          assert.equal(
            (await preferences({ model: MODEL, monthlyBudgetUsd: 100 })).status,
            200,
          );
          assert.equal((await generate()).status, 409);
        },
      );
      await t.test('AIG-001–005: OpenAPI protected routes', async () => {
        const doc = await (await call('/openapi.json')).json();
        for (const [path, method] of [
          ['/ai/preferences', 'get'],
          ['/ai/models', 'get'],
          ['/ai/preferences', 'put'],
          ['/contents/{id}/ai-generations', 'post'],
        ])
          assert.ok(doc.paths[path!]![method!].security);
      });
    } finally {
      await app.close();
      await db.aiGeneration.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
