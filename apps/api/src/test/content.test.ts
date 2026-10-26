import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import type { Content } from '@synvaro/contracts';

test(
  'CNT-001–004: real HTTP/PostgreSQL draft lifecycle and isolation',
  { timeout: 30000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const prefix = `content-${randomUUID()}`;
    const password = `Test-only-${randomUUID()}`;
    const users: { id: string; cookie: string }[] = [];
    let base = '';
    let first: Content;
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
        data: { ownerUserId: users[0]!.id, name: 'Draft test', slug: prefix },
      });
      const otherOrg = await db.organization.create({
        data: {
          ownerUserId: users[1]!.id,
          name: 'Other owner',
          slug: `${prefix}-other`,
        },
      });
      const qos = await db.brand.create({
        data: { organizationId: org.id, name: 'Qos Workspace', slug: 'qos' },
      });
      const isis = await db.brand.create({
        data: { organizationId: org.id, name: 'ISIS Türkiye', slug: 'isis' },
      });
      const foreign = await db.brand.create({
        data: {
          organizationId: otherOrg.id,
          name: 'Foreign brand',
          slug: 'foreign',
        },
      });
      await t.test(
        'CNT-001-A1/A2: create multiple drafts, empty body and server DRAFT status',
        async () => {
          const response = await call('/contents', 'POST', {
            brandId: qos.id,
            title: '  Hypothetical Qos draft  ',
            body: 'Hypothetical only.\nNo released capability claims.',
          });
          assert.equal(response.status, 201);
          first = (await response.json()).content;
          assert.equal(first.title, 'Hypothetical Qos draft');
          assert.equal(first.status, 'DRAFT');
          assert.equal(first.brandId, qos.id);
          assert.equal(
            first.body,
            'Hypothetical only.\nNo released capability claims.',
          );
          for (const body of [undefined, '']) {
            const created = await call('/contents', 'POST', {
              brandId: qos.id,
              title: 'Another draft',
              ...(body === undefined ? {} : { body }),
            });
            assert.equal(created.status, 201);
            assert.equal((await created.json()).content.body, '');
          }
          assert.equal(
            await db.content.count({ where: { brandId: qos.id } }),
            3,
          );
        },
      );
      await t.test(
        'CNT-002-A1/A2 / CNT-004-A4: list per brand, metadata projection, retrieve and switch back',
        async () => {
          const list = (
            await (await call(`/contents?brandId=${qos.id}`)).json()
          ).contents;
          assert.equal(list.length, 3);
          assert.ok(
            list.every(
              (row: { brandId: string; body?: string }) =>
                row.brandId === qos.id && row.body === undefined,
            ),
          );
          assert.deepEqual(
            await (await call(`/contents?brandId=${isis.id}`)).json(),
            { contents: [] },
          );
          assert.deepEqual(
            (await (await call(`/contents/${first.id}`)).json()).content,
            first,
          );
          assert.equal(
            (await (await call(`/contents?brandId=${qos.id}`)).json()).contents
              .length,
            3,
          );
        },
      );
      await t.test(
        'CNT-003-A1: partial title/body updates, empty body and whitespace persistence',
        async () => {
          assert.equal(
            (
              await call(`/contents/${first.id}`, 'PATCH', {
                title: 'Edited hypothetical draft',
              })
            ).status,
            200,
          );
          assert.equal(
            (await (await call(`/contents/${first.id}`)).json()).content.body,
            first.body,
          );
          for (const body of [
            '',
            '  Plain text\n<script>not executed</script>  ',
          ]) {
            const response = await call(`/contents/${first.id}`, 'PATCH', {
              body,
            });
            assert.equal(response.status, 200);
            const edited = (await response.json()).content;
            assert.equal(edited.body, body);
            assert.equal(edited.title, 'Edited hypothetical draft');
            assert.equal(edited.brandId, qos.id);
            assert.equal(edited.status, 'DRAFT');
          }
          const stored = await db.content.findUniqueOrThrow({
            where: { id: first.id },
          });
          assert.equal(stored.title, 'Edited hypothetical draft');
          assert.equal(
            stored.body,
            '  Plain text\n<script>not executed</script>  ',
          );
          const list = (
            await (await call(`/contents?brandId=${qos.id}`)).json()
          ).contents;
          assert.equal(list[0].id, first.id);
        },
      );
      await t.test(
        'CNT-004-A1: unknown/foreign brand and content responses are indistinguishable',
        async () => {
          for (const method of ['GET', 'POST']) {
            const request = (id: string) =>
              method === 'GET'
                ? call(`/contents?brandId=${id}`)
                : call('/contents', 'POST', {
                    brandId: id,
                    title: 'Forbidden',
                  });
            const a = await request(foreign.id);
            const b = await request(randomUUID());
            assert.equal(a.status, 404);
            assert.equal(b.status, 404);
            assert.deepEqual(await a.json(), await b.json());
          }
          const before = await db.content.findUniqueOrThrow({
            where: { id: first.id },
          });
          for (const method of ['GET', 'PATCH']) {
            const body =
              method === 'PATCH' ? { title: 'Forbidden' } : undefined;
            const a = await call(
              `/contents/${first.id}`,
              method,
              body,
              users[1]!.cookie,
            );
            const b = await call(
              `/contents/${randomUUID()}`,
              method,
              body,
              users[1]!.cookie,
            );
            assert.equal(a.status, 404);
            assert.equal(b.status, 404);
            assert.deepEqual(await a.json(), await b.json());
          }
          assert.deepEqual(
            await db.content.findUnique({ where: { id: first.id } }),
            before,
          );
          assert.equal(
            await db.content.count({ where: { brandId: foreign.id } }),
            0,
          );
        },
      );
      await t.test(
        'CNT-004-A2/A3: boundary validation, ownership injection, auth and CSRF',
        async () => {
          for (const value of [
            { title: '' },
            { title: ' ' },
            { title: 'x'.repeat(201) },
            { body: 'x'.repeat(20001) },
            { body: null },
            { status: 'DRAFT' },
            { status: 'PUBLISHED' },
            { ownerUserId: users[1]!.id },
            { organizationId: org.id },
          ]) {
            assert.equal(
              (
                await call('/contents', 'POST', {
                  brandId: qos.id,
                  title: 'Valid',
                  ...value,
                })
              ).status,
              400,
            );
            assert.equal(
              (await call(`/contents/${first.id}`, 'PATCH', value)).status,
              400,
            );
          }
          assert.equal(
            (await call(`/contents/${first.id}`, 'PATCH', { brandId: isis.id }))
              .status,
            400,
          );
          assert.equal(
            (await call(`/contents/${first.id}`, 'PATCH', {})).status,
            400,
          );
          assert.equal(
            (await call('/contents', 'POST', { title: 'No brand' })).status,
            400,
          );
          for (const query of [
            '',
            '?brandId=no',
            `?brandId=${qos.id}&brandId=${isis.id}`,
            `?brandId=${qos.id}&ownerUserId=${users[1]!.id}`,
          ])
            assert.equal((await call(`/contents${query}`)).status, 400);
          assert.equal((await call('/contents/not-a-uuid')).status, 400);
          for (const [path, method, body] of [
            ['/contents', 'POST', { brandId: qos.id, title: 'No user' }],
            [`/contents?brandId=${qos.id}`, 'GET', undefined],
            [`/contents/${first.id}`, 'GET', undefined],
            [`/contents/${first.id}`, 'PATCH', { body: 'No user' }],
          ] as const)
            assert.equal((await call(path, method, body, '')).status, 401);
          for (const origin of ['https://evil.example', '']) {
            assert.equal(
              (
                await call(
                  '/contents',
                  'POST',
                  { brandId: qos.id, title: 'CSRF' },
                  users[0]!.cookie,
                  origin,
                )
              ).status,
              403,
            );
            assert.equal(
              (
                await call(
                  `/contents/${first.id}`,
                  'PATCH',
                  { body: 'CSRF' },
                  users[0]!.cookie,
                  origin,
                )
              ).status,
              403,
            );
          }
        },
      );
      await t.test(
        'CNT-003-A1 / CNT-004-A3: Unicode text within limits and bounded oversized payload',
        async () => {
          const body = '文'.repeat(20000);
          assert.equal(
            (await call(`/contents/${first.id}`, 'PATCH', { body })).status,
            200,
          );
          assert.equal(
            (await (await call(`/contents/${first.id}`)).json()).content.body,
            body,
          );
          assert.equal(
            (
              await call(`/contents/${first.id}`, 'PATCH', {
                body: 'x'.repeat(132000),
              })
            ).status,
            413,
          );
        },
      );
      await t.test(
        'CNT-004-A2: expiry and revocation deny draft resources',
        async () => {
          const token = users[0]!.cookie.split('=')[1]!;
          const tokenHash = createHash('sha256').update(token).digest('hex');
          await db.session.update({
            where: { tokenHash },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal((await call(`/contents/${first.id}`)).status, 401);
          await db.session.update({
            where: { tokenHash },
            data: {
              expiresAt: new Date(Date.now() + 60000),
              revokedAt: new Date(),
            },
          });
          assert.equal(
            (await call(`/contents/${first.id}`, 'PATCH', { body: 'Revoked' }))
              .status,
            401,
          );
        },
      );
      await t.test(
        'CNT-001–004: OpenAPI documents all four protected operations',
        async () => {
          const doc = await (await call('/openapi.json')).json();
          for (const [path, method, status] of [
            ['/contents', 'post', '201'],
            ['/contents', 'get', '200'],
            ['/contents/{id}', 'get', '200'],
            ['/contents/{id}', 'patch', '200'],
          ]) {
            assert.ok(doc.paths[path!]![method!].security);
            assert.ok(doc.paths[path!]![method!].responses[status!]);
          }
        },
      );
    } finally {
      await app.close();
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
