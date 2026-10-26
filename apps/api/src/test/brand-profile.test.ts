import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';

test(
  'BRP-001: profile lifecycle and isolation through real HTTP/PostgreSQL',
  { timeout: 30000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const prefix = `profile-${randomUUID()}`;
    const password = `Test-only-${randomUUID()}`;
    let base = '';
    const users: { id: string; cookie: string }[] = [];
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
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (let i = 0; i < 2; i++) {
        const email = `${prefix}-${i}@example.test`;
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
        assert.equal(login.status, 200);
        users.push({
          id: (await login.json()).user.id,
          cookie: login.headers.get('set-cookie')!.split(';')[0]!,
        });
      }
      const org = await db.organization.create({
        data: { ownerUserId: users[0]!.id, name: 'Profile test', slug: prefix },
      });
      const brand = await db.brand.create({
        data: {
          organizationId: org.id,
          name: 'Profile brand',
          slug: 'profile-brand',
          description: 'Short summary stays separate',
        },
      });
      const path = `/brands/${brand.id}/profile`;
      await t.test(
        'BRP-001-A1/A2: explicit empty state, partial creation, one profile and public projection',
        async () => {
          assert.deepEqual(await (await call(path)).json(), { profile: null });
          const created = await call(path, 'PUT', {
            description: '  Detailed context  ',
            defaultLanguage: 'tr-tr',
          });
          assert.equal(created.status, 200);
          const { profile } = await created.json();
          assert.equal(profile.brandId, brand.id);
          assert.equal(profile.description, 'Detailed context');
          assert.equal(profile.defaultLanguage, 'tr-TR');
          assert.equal(profile.targetAudience, '');
          assert.equal(profile.contentGuidelines, '');
          assert.deepEqual(await (await call(path)).json(), { profile });
          assert.deepEqual(
            Object.keys(profile).sort(),
            [
              'id',
              'brandId',
              'description',
              'targetAudience',
              'toneOfVoice',
              'defaultLanguage',
              'contentGuidelines',
              'createdAt',
              'updatedAt',
            ].sort(),
          );
        },
      );
      await t.test(
        'BRP-001-A3: independent changes preserve omitted fields, clear values, repeated PUT stays one record',
        async () => {
          for (const change of [
            { targetAudience: 'Business owners' },
            { toneOfVoice: 'Warm and factual' },
            { contentGuidelines: 'Never invent offers' },
            { defaultLanguage: 'zh-hant' },
          ]) {
            assert.equal((await call(path, 'PUT', change)).status, 200);
          }
          const stored = await db.brandProfile.findUniqueOrThrow({
            where: { brandId: brand.id },
          });
          assert.equal(stored.description, 'Detailed context');
          assert.equal(stored.targetAudience, 'Business owners');
          assert.equal(stored.toneOfVoice, 'Warm and factual');
          assert.equal(stored.contentGuidelines, 'Never invent offers');
          assert.equal(stored.defaultLanguage, 'zh-Hant');
          for (let i = 0; i < 2; i++)
            assert.equal(
              (
                await call(path, 'PUT', {
                  targetAudience: '',
                  defaultLanguage: null,
                })
              ).status,
              200,
            );
          assert.equal(
            await db.brandProfile.count({ where: { brandId: brand.id } }),
            1,
          );
          const cleared = (await (await call(path)).json()).profile;
          assert.equal(cleared.targetAudience, '');
          assert.equal(cleared.defaultLanguage, null);
          assert.equal(cleared.description, stored.description);
          assert.equal(
            (await db.brand.findUniqueOrThrow({ where: { id: brand.id } }))
              .description,
            'Short summary stays separate',
          );
        },
      );
      await t.test(
        'BRP-001-A4: unknown and foreign brands return identical 404 for read and write',
        async () => {
          const before = await db.brandProfile.findUniqueOrThrow({
            where: { brandId: brand.id },
          });
          for (const method of ['GET', 'PUT']) {
            const body =
              method === 'PUT' ? { description: 'Forbidden' } : undefined;
            const foreign = await call(path, method, body, users[1]!.cookie);
            const missing = await call(
              `/brands/${randomUUID()}/profile`,
              method,
              body,
              users[1]!.cookie,
            );
            assert.equal(foreign.status, 404);
            assert.equal(missing.status, 404);
            assert.deepEqual(await foreign.json(), await missing.json());
          }
          const emptyBrand = await db.brand.create({
            data: {
              organizationId: org.id,
              name: 'No profile',
              slug: 'no-profile',
            },
          });
          assert.equal(
            (
              await call(
                `/brands/${emptyBrand.id}/profile`,
                'PUT',
                { description: 'Forbidden create' },
                users[1]!.cookie,
              )
            ).status,
            404,
          );
          assert.equal(
            await db.brandProfile.count({ where: { brandId: emptyBrand.id } }),
            0,
          );
          assert.deepEqual(
            await db.brandProfile.findUnique({ where: { brandId: brand.id } }),
            before,
          );
        },
      );
      await t.test(
        'BRP-001-A5/A6: invalid input, anonymous requests and CSRF rejected without mutation',
        async () => {
          const before = await db.brandProfile.findUniqueOrThrow({
            where: { brandId: brand.id },
          });
          for (const body of [
            {},
            { ownerUserId: users[1]!.id },
            { brandId: brand.id },
            { organizationId: org.id },
            { defaultLanguage: 'en_US' },
            { defaultLanguage: 'not a language' },
            { defaultLanguage: 'en--US' },
            { defaultLanguage: '' },
            { defaultLanguage: 'x'.repeat(101) },
            { description: null },
            { toneOfVoice: 42 },
            ...[
              'description',
              'targetAudience',
              'toneOfVoice',
              'contentGuidelines',
            ].map((key) => ({ [key]: 'x'.repeat(4001) })),
          ]) {
            assert.equal(
              (await call(path, 'PUT', body)).status,
              400,
              JSON.stringify(body).slice(0, 100),
            );
          }
          for (const method of ['GET', 'PUT'])
            assert.equal(
              (
                await call(
                  path,
                  method,
                  method === 'PUT' ? { description: 'Anonymous' } : undefined,
                  '',
                )
              ).status,
              401,
            );
          assert.equal(
            (
              await call(
                path,
                'PUT',
                { description: 'CSRF' },
                users[0]!.cookie,
                'https://evil.example',
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                path,
                'PUT',
                { description: 'Missing origin' },
                users[0]!.cookie,
                '',
              )
            ).status,
            403,
          );
          assert.equal((await call('/brands/not-a-uuid/profile')).status, 400);
          assert.deepEqual(
            await db.brandProfile.findUnique({ where: { brandId: brand.id } }),
            before,
          );
        },
      );
      await t.test(
        'BRP-001-A5: bounded multilingual full profile exceeds old 8kb limit and persists',
        async () => {
          const text = '文'.repeat(4000);
          const body = {
            description: text,
            targetAudience: text,
            toneOfVoice: text,
            contentGuidelines: text,
          };
          assert.equal((await call(path, 'PUT', body)).status, 200);
          assert.equal(
            (await (await call(path)).json()).profile.description,
            text,
          );
          assert.equal(
            (await call(path, 'PUT', { description: 'x'.repeat(66000) }))
              .status,
            413,
          );
        },
      );
      await t.test(
        'BRP-001-A7: OpenAPI declares protected GET/PUT and bounded inputs',
        async () => {
          const doc = await (await call('/openapi.json')).json();
          const operations = doc.paths['/brands/{id}/profile'];
          for (const method of ['get', 'put']) {
            assert.ok(operations[method].security);
            assert.ok(operations[method].responses['200']);
            assert.ok(operations[method].responses['404']);
          }
          assert.equal(
            operations.put.requestBody.content['application/json'].schema
              .properties.description.maxLength,
            4000,
          );
        },
      );
    } finally {
      await app.close();
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
