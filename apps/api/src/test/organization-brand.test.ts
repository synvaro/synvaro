import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import type { Organization, Brand } from '@synvaro/contracts';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';

test(
  'SYN-002B: owner isolation and constraints through real HTTP/PostgreSQL',
  { timeout: 30_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(
      new URL(config.databaseUrl).pathname.endsWith('_test'),
      'Dedicated _test database required',
    );
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const prefix = `org-test-${randomUUID()}`;
    const password = `Test-only-${randomUUID()}`;
    const users: Array<{ cookie: string; id: string }> = [];
    let base = '';
    let orgA: Organization;
    let orgB: Organization;
    let brandA: Brand;
    async function call(
      path: string,
      method = 'GET',
      body?: unknown,
      cookie = '',
      origin: string | null = config.origin,
    ) {
      return fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { origin } : {}),
          cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (let i = 0; i < 3; i++) {
        const email = `${prefix}-${i}@example.test`;
        assert.equal(
          (await call('/auth/register', 'POST', { email, password })).status,
          201,
        );
        const response = await call('/auth/login', 'POST', { email, password });
        assert.equal(response.status, 200);
        users.push({
          cookie: response.headers.get('set-cookie')!.split(';')[0]!,
          id: ((await response.json()) as { user: { id: string } }).user.id,
        });
      }
      const [a, b, c] = users as [
        (typeof users)[number],
        (typeof users)[number],
        (typeof users)[number],
      ];
      await t.test(
        'ORG-002-A2 / BRD-001-A3: explicit empty organization, empty list, no brand before organization',
        async () => {
          assert.deepEqual(
            await (
              await call('/organizations/me', 'GET', undefined, a.cookie)
            ).json(),
            { organization: null },
          );
          assert.deepEqual(
            await (await call('/brands', 'GET', undefined, a.cookie)).json(),
            { brands: [] },
          );
          assert.equal(
            (await call('/brands', 'POST', { name: 'Orphan' }, a.cookie))
              .status,
            409,
          );
        },
      );
      await t.test(
        'ORG-001-A1/A2/A3: create, normalize name/slug, enforce unique owner and global slug',
        async () => {
          const response = await call(
            '/organizations',
            'POST',
            { name: `  Studio ${prefix}  ` },
            a.cookie,
          );
          assert.equal(response.status, 201);
          orgA = ((await response.json()) as { organization: Organization })
            .organization;
          assert.equal(orgA.name, `Studio ${prefix}`);
          assert.equal(orgA.slug, `studio-${prefix}`);
          const row = await db.organization.findUniqueOrThrow({
            where: { id: orgA.id },
          });
          assert.equal(row.ownerUserId, a.id);
          const duplicateOwner = await call(
            '/organizations',
            'POST',
            { name: 'Another', slug: `another-${prefix}` },
            a.cookie,
          );
          const duplicateSlug = await call(
            '/organizations',
            'POST',
            { name: 'Another owner', slug: orgA.slug },
            b.cookie,
          );
          assert.equal(duplicateOwner.status, 409);
          assert.equal(duplicateSlug.status, 409);
          assert.deepEqual(
            await duplicateOwner.json(),
            await duplicateSlug.json(),
          );
          const second = await call(
            '/organizations',
            'POST',
            { name: 'Owner B', slug: `second-${prefix}` },
            b.cookie,
          );
          assert.equal(second.status, 201);
          orgB = ((await second.json()) as { organization: Organization })
            .organization;
        },
      );
      await t.test(
        'ORG-001-A2: concurrent creation cannot bypass ownership uniqueness',
        async () => {
          const responses = await Promise.all([
            call(
              '/organizations',
              'POST',
              { name: `Race one ${prefix}` },
              c.cookie,
            ),
            call(
              '/organizations',
              'POST',
              { name: `Race two ${prefix}` },
              c.cookie,
            ),
          ]);
          assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
          assert.equal(
            await db.organization.count({ where: { ownerUserId: c.id } }),
            1,
          );
        },
      );
      await t.test(
        'ORG-002-A1/A3: reads derive owner only from session, not URL selectors',
        async () => {
          const response = await call(
            `/organizations/me?ownerUserId=${a.id}&organizationId=${orgA.id}`,
            'GET',
            undefined,
            b.cookie,
          );
          assert.deepEqual(await response.json(), { organization: orgB });
          assert.equal(
            (
              await call(
                `/organizations/${orgA.id}`,
                'GET',
                undefined,
                b.cookie,
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        'BRD-001-A1/A2: multiple brands, per-organization uniqueness and same slug across owners',
        async () => {
          const first = await call(
            '/brands',
            'POST',
            {
              name: 'First brand',
              slug: 'shared-brand',
              description: '  Initial description  ',
            },
            a.cookie,
          );
          assert.equal(first.status, 201);
          brandA = ((await first.json()) as { brand: Brand }).brand;
          assert.equal(brandA.organizationId, orgA.id);
          assert.equal(brandA.description, 'Initial description');
          assert.equal(
            (await call('/brands', 'POST', { name: 'Second brand' }, a.cookie))
              .status,
            201,
          );
          assert.equal(
            (
              await call(
                '/brands',
                'POST',
                { name: 'Duplicate', slug: 'shared-brand' },
                a.cookie,
              )
            ).status,
            409,
          );
          const other = await call(
            '/brands',
            'POST',
            { name: 'Other owner brand', slug: 'shared-brand' },
            b.cookie,
          );
          assert.equal(other.status, 201);
          assert.equal(
            ((await other.json()) as { brand: Brand }).brand.organizationId,
            orgB.id,
          );
        },
      );
      await t.test(
        'BRD-002-A1/A2: scoped lists and name/description patch persist without changing slug or ownership',
        async () => {
          const aList = (await (
            await call('/brands', 'GET', undefined, a.cookie)
          ).json()) as { brands: Brand[] };
          assert.equal(aList.brands.length, 2);
          assert.ok(
            aList.brands.every((brand) => brand.organizationId === orgA.id),
          );
          const bList = (await (
            await call(
              `/brands?organizationId=${orgA.id}`,
              'GET',
              undefined,
              b.cookie,
            )
          ).json()) as { brands: Brand[] };
          assert.equal(bList.brands.length, 1);
          assert.equal(bList.brands[0]!.organizationId, orgB.id);
          const update = await call(
            `/brands/${brandA.id}`,
            'PATCH',
            { name: '  Updated brand  ', description: 'Updated description' },
            a.cookie,
          );
          assert.equal(update.status, 200);
          const edited = ((await update.json()) as { brand: Brand }).brand;
          assert.equal(edited.name, 'Updated brand');
          assert.equal(edited.slug, brandA.slug);
          assert.equal(edited.organizationId, orgA.id);
          const stored = await db.brand.findUniqueOrThrow({
            where: { id: brandA.id },
          });
          assert.equal(stored.description, 'Updated description');
          const cleared = await call(
            `/brands/${brandA.id}`,
            'PATCH',
            { description: null },
            a.cookie,
          );
          assert.equal(cleared.status, 200);
          assert.equal(
            ((await cleared.json()) as { brand: Brand }).brand.description,
            null,
          );
        },
      );
      await t.test(
        'BRD-002-A3: cross-organization patch is identical to not-found and leaves data unchanged',
        async () => {
          const foreign = await call(
            `/brands/${brandA.id}`,
            'PATCH',
            { name: 'Stolen' },
            b.cookie,
          );
          const missing = await call(
            `/brands/${randomUUID()}`,
            'PATCH',
            { name: 'Stolen' },
            b.cookie,
          );
          assert.equal(foreign.status, 404);
          assert.equal(missing.status, 404);
          assert.deepEqual(await foreign.json(), await missing.json());
          assert.equal(
            (await db.brand.findUniqueOrThrow({ where: { id: brandA.id } }))
              .name,
            'Updated brand',
          );
        },
      );
      await t.test(
        'ORG-BRD-SEC-A1/A2/A3: all endpoints protected, ownership injection and invalid input rejected, CSRF preserved',
        async () => {
          for (const [path, method, body] of [
            ['/organizations', 'POST', { name: 'No user' }],
            ['/organizations/me', 'GET', undefined],
            ['/brands', 'POST', { name: 'No user' }],
            ['/brands', 'GET', undefined],
            [`/brands/${brandA.id}`, 'PATCH', { name: 'No user' }],
          ] as const)
            assert.equal((await call(path, method, body)).status, 401);
          for (const body of [
            { name: '' },
            { name: ' ' },
            { name: 'x'.repeat(121) },
            { name: 'Valid', slug: 'bad slug' },
            { name: 'Valid', ownerUserId: b.id },
            { name: 'Valid', organizationId: orgB.id },
          ]) {
            assert.equal(
              (await call('/organizations', 'POST', body, a.cookie)).status,
              400,
            );
            assert.equal(
              (await call('/brands', 'POST', body, a.cookie)).status,
              400,
            );
          }
          for (const body of [
            {},
            { name: '' },
            { slug: 'renamed' },
            { organizationId: orgB.id },
            { ownerUserId: b.id },
            { description: 'x'.repeat(2001) },
          ]) {
            assert.equal(
              (await call(`/brands/${brandA.id}`, 'PATCH', body, a.cookie))
                .status,
              400,
            );
          }
          assert.equal(
            (
              await call(
                '/brands/not-a-uuid',
                'PATCH',
                { name: 'Bad ID' },
                a.cookie,
              )
            ).status,
            400,
          );
          for (const origin of ['https://evil.example', null]) {
            for (const [path, method] of [
              ['/organizations', 'POST'],
              ['/brands', 'POST'],
              [`/brands/${brandA.id}`, 'PATCH'],
            ]) {
              assert.equal(
                (await call(path!, method!, { name: 'CSRF' }, a.cookie, origin))
                  .status,
                403,
              );
            }
          }
          const responseText = await (
            await call('/organizations/me', 'GET', undefined, a.cookie)
          ).text();
          assert.ok(
            !responseText.includes('passwordHash') &&
              !responseText.includes('tokenHash') &&
              !responseText.includes('ownerUserId'),
          );
        },
      );
      await t.test(
        'ORG/BRD OpenAPI documents authenticated endpoints and payloads',
        async () => {
          const doc = (await (await call('/openapi.json')).json()) as {
            paths: Record<
              string,
              Record<
                string,
                { security?: unknown; responses: Record<string, unknown> }
              >
            >;
          };
          for (const [path, method, status] of [
            ['/organizations', 'post', '201'],
            ['/organizations/me', 'get', '200'],
            ['/brands', 'post', '201'],
            ['/brands', 'get', '200'],
            ['/brands/{id}', 'patch', '200'],
          ]) {
            const operation = doc.paths[path!]![method!]!;
            assert.ok(operation.security);
            assert.ok(operation.responses[status!]);
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
