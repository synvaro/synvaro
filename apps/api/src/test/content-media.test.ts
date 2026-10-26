import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import type { ContentMedia } from '@synvaro/contracts';

test(
  'CMA-001–005: real PostgreSQL/HTTP attachment lifecycle, concurrency and isolation',
  { timeout: 30000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const db = createDatabase(config.databaseUrl),
      root = await mkdtemp(join(tmpdir(), 'synvaro-attachments-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    const app = await createApp(),
      prefix = `cma-${randomUUID()}`,
      users: { id: string; cookie: string }[] = [];
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
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      for (let i = 0; i < 2; i++) {
        const email = `${prefix}-${i}@example.test`,
          password = `Test-${randomUUID()}`;
        assert.equal(
          (await call('/auth/register', 'POST', { email, password }, ''))
            .status,
          201,
        );
        const response = await call(
          '/auth/login',
          'POST',
          { email, password },
          '',
        );
        assert.equal(response.status, 200);
        users.push({
          id: (await response.json()).user.id,
          cookie: response.headers.get('set-cookie')!.split(';')[0]!,
        });
      }
      const org = await db.organization.create({
        data: { ownerUserId: users[0]!.id, name: 'CMA', slug: prefix },
      });
      const other = await db.organization.create({
        data: {
          ownerUserId: users[1]!.id,
          name: 'Other',
          slug: prefix + '-other',
        },
      });
      const brands = await Promise.all(
        [org.id, org.id, other.id].map((organizationId, index) =>
          db.brand.create({
            data: {
              organizationId,
              name: `Brand ${index}`,
              slug: `brand-${index}`,
            },
          }),
        ),
      );
      const drafts = await Promise.all(
        brands.map((brand) =>
          db.content.create({
            data: {
              brandId: brand.id,
              title: 'Hypothetical attachment test',
              body: 'Original text',
            },
          }),
        ),
      );
      const shared = await db.content.create({
        data: { brandId: brands[0]!.id, title: 'Shared asset draft' },
      });
      const assets: string[] = [];
      for (const [index, format] of ['png', 'mp4', 'webp', 'jpeg'].entries()) {
        const bytes = await readFile(
          new URL(
            `../../src/test/fixtures/media/sample.${format}`,
            import.meta.url,
          ),
        );
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(bytes)]),
          `sample.${format}`,
        );
        const response = await fetch(
          `${base}/brands/${brands[index < 2 ? 0 : index - 1]!.id}/media`,
          {
            method: 'POST',
            headers: {
              cookie: users[index === 3 ? 1 : 0]!.cookie,
              origin: config.origin,
            },
            body: form,
          },
        );
        assert.equal(response.status, 201);
        assets.push((await response.json()).asset.id);
      }
      const path = `/contents/${drafts[0]!.id}/media`;
      const rows = async () =>
        (await (await call(path)).json()).attachments as ContentMedia[];
      const filesBefore = (await readdir(root)).sort();
      await t.test(
        'CMA-001-A1 / CMA-002-A1: images/videos, multiple attachments, shared media and safe ordered metadata',
        async () => {
          assert.deepEqual(await rows(), []);
          for (const mediaAssetId of assets.slice(0, 2))
            assert.equal(
              (await call(path, 'POST', { mediaAssetId })).status,
              201,
            );
          assert.equal(
            (
              await call(`/contents/${shared.id}/media`, 'POST', {
                mediaAssetId: assets[0],
              })
            ).status,
            201,
          );
          const attached = await rows();
          assert.deepEqual(
            attached.map((item) => item.mediaAssetId),
            assets.slice(0, 2),
          );
          assert.deepEqual(
            attached.map((item) => item.position),
            [0, 1],
          );
          assert.equal(attached[0]!.asset.mimeType, 'image/png');
          assert.equal(attached[1]!.asset.mimeType, 'video/mp4');
          assert.ok(attached.every((item) => !('storageKey' in item.asset)));
          assert.deepEqual((await readdir(root)).sort(), filesBefore);
        },
      );
      await t.test(
        'CMA-001-A2: duplicate requests and database uniqueness',
        async () => {
          assert.equal(
            (await call(path, 'POST', { mediaAssetId: assets[0] })).status,
            409,
          );
          await assert.rejects(
            db.contentMedia.create({
              data: {
                contentId: drafts[0]!.id,
                mediaAssetId: assets[0]!,
                position: 9,
              },
            }),
          );
          const responses = await Promise.all(
            [0, 1].map(() =>
              call(`/contents/${shared.id}/media`, 'POST', {
                mediaAssetId: assets[1],
              }),
            ),
          );
          assert.deepEqual(
            responses.map((response) => response.status).sort(),
            [201, 409],
          );
          assert.equal(
            await db.contentMedia.count({
              where: { contentId: shared.id, mediaAssetId: assets[1] },
            }),
            1,
          );
        },
      );
      await t.test(
        'CMA-003-A1: reorder persists and never modifies text',
        async () => {
          const before = await db.content.findUniqueOrThrow({
            where: { id: drafts[0]!.id },
          });
          assert.equal(
            (
              await call(path + '/order', 'PUT', {
                mediaAssetIds: [assets[1], assets[0]],
              })
            ).status,
            200,
          );
          assert.deepEqual(
            (await rows()).map((item) => item.mediaAssetId),
            [assets[1], assets[0]],
          );
          assert.deepEqual(
            await db.content.findUnique({ where: { id: drafts[0]!.id } }),
            before,
          );
        },
      );
      await t.test(
        'CMA-003-A2 / CMA-005-A1: invalid full permutations are atomic',
        async () => {
          const before = await rows();
          const invalidOrders: [Array<string | undefined>, number][] = [
            [[assets[0], assets[0]], 400],
            [[assets[0]], 409],
            [[], 409],
            [[assets[0], randomUUID()], 404],
            [[assets[0], assets[2]], 404],
            [[assets[0], assets[3]], 404],
          ];
          for (const [ids, status] of invalidOrders) {
            assert.equal(
              (await call(path + '/order', 'PUT', { mediaAssetIds: ids }))
                .status,
              status,
            );
            assert.deepEqual(await rows(), before);
          }
        },
      );
      await t.test(
        'CMA-005-A1: wrong brand, foreign and unknown resources share 404',
        async () => {
          let expected: unknown;
          for (const mediaAssetId of [assets[2], assets[3], randomUUID()]) {
            const response = await call(path, 'POST', { mediaAssetId });
            assert.equal(response.status, 404);
            const body = await response.json();
            expected ??= body;
            assert.deepEqual(body, expected);
          }
          const foreignCases: [string, string, unknown][] = [
            ['GET', '', undefined],
            ['POST', '', { mediaAssetId: assets[0] }],
            ['PUT', '/order', { mediaAssetIds: [] }],
            ['DELETE', `/${assets[0]}`, {}],
          ];
          for (const id of [drafts[2]!.id, randomUUID()])
            for (const [method, suffix, body] of foreignCases) {
              const response = await call(
                `/contents/${id}/media${suffix}`,
                method,
                body,
              );
              assert.equal(response.status, 404);
              assert.deepEqual(await response.json(), expected);
            }
          for (const id of [assets[2]!, assets[3]!, randomUUID()]) {
            const response = await call(`${path}/${id}`, 'DELETE', {});
            assert.equal(response.status, 404);
            assert.deepEqual(await response.json(), expected);
          }
          assert.deepEqual((await readdir(root)).sort(), filesBefore);
        },
      );
      await t.test(
        'CMA-004-A1: detach compacts order and preserves original bytes and other draft',
        async () => {
          assert.equal(
            (await call(`${path}/${assets[1]}`, 'DELETE', {})).status,
            200,
          );
          assert.deepEqual(
            (await rows()).map((item) => [item.mediaAssetId, item.position]),
            [[assets[0], 0]],
          );
          assert.equal(
            await db.contentMedia.count({ where: { contentId: shared.id } }),
            2,
          );
          assert.equal((await call(`/media/${assets[1]}`)).status, 200);
          const bytes = Buffer.from(
            await (await call(`/media/${assets[1]}/file`)).arrayBuffer(),
          );
          assert.deepEqual(
            bytes,
            await readFile(
              new URL(
                '../../src/test/fixtures/media/sample.mp4',
                import.meta.url,
              ),
            ),
          );
          assert.deepEqual((await readdir(root)).sort(), filesBefore);
        },
      );
      await t.test(
        'CMA-003-A2: concurrent attach/reorder and detach/reorder have serial outcomes',
        async () => {
          const results = await Promise.all([
            call(path, 'POST', { mediaAssetId: assets[1] }),
            call(path + '/order', 'PUT', { mediaAssetIds: [assets[0]] }),
          ]);
          assert.equal(results[0]!.status, 201);
          assert.ok([200, 409].includes(results[1]!.status));
          assert.deepEqual(
            (await rows()).map((item) => item.position),
            [0, 1],
          );
          const reorders = await Promise.all(
            [
              [assets[0], assets[1]],
              [assets[1], assets[0]],
            ].map((mediaAssetIds) =>
              call(path + '/order', 'PUT', { mediaAssetIds }),
            ),
          );
          assert.ok(reorders.every((response) => response.status === 200));
          const ids = (await rows()).map((item) => item.mediaAssetId);
          assert.ok(
            JSON.stringify(ids) === JSON.stringify(assets.slice(0, 2)) ||
              JSON.stringify(ids) ===
                JSON.stringify(assets.slice(0, 2).reverse()),
          );
          const deletion = await Promise.all([
            call(`${path}/${assets[1]}`, 'DELETE', {}),
            call(path + '/order', 'PUT', {
              mediaAssetIds: [assets[1], assets[0]],
            }),
          ]);
          assert.equal(deletion[0]!.status, 200);
          assert.ok([200, 404].includes(deletion[1]!.status));
          assert.deepEqual(
            (await rows()).map((item) => [item.mediaAssetId, item.position]),
            [[assets[0], 0]],
          );
        },
      );
      await t.test(
        'CMA-005-A2: input, session and CSRF regression',
        async () => {
          const requests: [string, string, unknown][] = [
            ['GET', '', undefined],
            ['POST', '', { mediaAssetId: assets[1] }],
            ['PUT', '/order', { mediaAssetIds: [assets[0]] }],
            ['DELETE', `/${assets[0]}`, {}],
          ];
          for (const [method, suffix, body] of requests) {
            assert.equal(
              (await call(path + suffix, method, body, '')).status,
              401,
            );
            if (method !== 'GET')
              for (const origin of ['', 'https://evil.example'])
                assert.equal(
                  (
                    await call(
                      path + suffix,
                      method,
                      body,
                      users[0]!.cookie,
                      origin,
                    )
                  ).status,
                  403,
                );
          }
          for (const body of [
            {},
            { mediaAssetId: 'bad' },
            { mediaAssetId: assets[1], brandId: brands[1]!.id },
            { mediaAssetId: assets[1], position: 0 },
          ])
            assert.equal((await call(path, 'POST', body)).status, 400);
          for (const body of [
            { mediaAssetIds: ['bad'] },
            { mediaAssetIds: [assets[0]], ownerUserId: users[0]!.id },
          ])
            assert.equal(
              (await call(path + '/order', 'PUT', body)).status,
              400,
            );
          assert.equal(
            (await call(`${path}/${assets[0]}`, 'DELETE', { deleteFile: true }))
              .status,
            400,
          );
          assert.equal((await call('/contents/not-a-uuid/media')).status, 400);
          const tokenHash = createHash('sha256')
            .update(users[0]!.cookie.split('=')[1]!)
            .digest('hex');
          await db.session.update({
            where: { tokenHash },
            data: { expiresAt: new Date(Date.now() - 1) },
          });
          assert.equal((await call(path)).status, 401);
          await db.session.update({
            where: { tokenHash },
            data: {
              expiresAt: new Date(Date.now() + 60000),
              revokedAt: new Date(),
            },
          });
          assert.equal(
            (await call(path, 'POST', { mediaAssetId: assets[1] })).status,
            401,
          );
        },
      );
      await t.test(
        'CMA-005-A3: parent deletion cascades only relationships; OpenAPI has four protected operations',
        async () => {
          await db.content.delete({ where: { id: shared.id } });
          assert.equal(
            await db.contentMedia.count({ where: { contentId: shared.id } }),
            0,
          );
          assert.equal(
            await db.mediaAsset.count({ where: { id: assets[0] } }),
            1,
          );
          await db.mediaAsset.delete({ where: { id: assets[0] } });
          assert.equal(
            await db.contentMedia.count({ where: { mediaAssetId: assets[0] } }),
            0,
          );
          const doc = await (await call('/openapi.json')).json();
          for (const [route, method] of [
            ['/contents/{id}/media', 'get'],
            ['/contents/{id}/media', 'post'],
            ['/contents/{id}/media/order', 'put'],
            ['/contents/{id}/media/{mediaAssetId}', 'delete'],
          ])
            assert.ok(doc.paths[route!]![method!].security);
        },
      );
    } finally {
      await app.close();
      await db.mediaAsset.deleteMany({
        where: {
          brand: {
            organization: { ownerUserId: { in: users.map((user) => user.id) } },
          },
        },
      });
      await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      delete process.env.MEDIA_STORAGE_ROOT;
    }
  },
);
