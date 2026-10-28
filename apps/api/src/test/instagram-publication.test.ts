import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { encryptSocial } from '../social/crypto.js';
import {
  InstagramPublisher,
  InstagramPublishError,
} from '../social/instagram-publisher.js';
import { LocalMediaStorage } from '../media/storage.js';
import {
  reconcileFacebookPublication,
  reconcileInstagramPublication,
} from '../publication/reconciliation.js';

test(
  'SYN-SOC-004: Instagram publishing with real PostgreSQL and mocked Meta',
  { timeout: 90_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const previous = {
      root: process.env.MEDIA_STORAGE_ROOT,
      origin: process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN,
      key: process.env.INSTAGRAM_DELIVERY_SIGNING_KEY,
    };
    const root = await mkdtemp(join(tmpdir(), 'synvaro-instagram-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN = 'https://media.example.test';
    process.env.INSTAGRAM_DELIVERY_SIGNING_KEY =
      randomBytes(32).toString('base64');
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({
      test: randomBytes(32).toString('base64'),
    });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'test';
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const meta = app.get(InstagramPublisher);
    const original = {
      ready: meta.readiness.bind(meta),
      create: meta.createContainer.bind(meta),
      status: meta.containerStatus.bind(meta),
      publish: meta.publish.bind(meta),
    };
    meta.readiness = async () => ({ eligible: true, reason: null });
    let created = 0,
      published = 0,
      providerState: 'IN_PROGRESS' | 'FINISHED' = 'IN_PROGRESS',
      deliveryUrl = '';
    meta.createContainer = async (_id, token, url, caption) => {
      created++;
      assert.equal(token, 'private-page-token');
      assert.ok(caption.length > 0);
      deliveryUrl = url;
      return '18270815569115548';
    };
    meta.containerStatus = async () => providerState;
    meta.publish = async (_id, container, token) => {
      published++;
      assert.equal(container, '18270815569115548');
      assert.equal(token, 'private-page-token');
      return '90011803596441';
    };
    let base = '';
    const prefix = randomUUID();
    const call = (
      path: string,
      method = 'GET',
      body?: unknown,
      cookie = '',
      origin = config.origin,
    ) =>
      fetch(base + path, {
        method,
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    async function owner(index: number) {
      const email = `ig-${prefix}-${index}@example.test`;
      assert.equal(
        (
          await call('/auth/register', 'POST', {
            email,
            password: `Strong-${prefix}`,
          })
        ).status,
        201,
      );
      const login = await call('/auth/login', 'POST', {
        email,
        password: `Strong-${prefix}`,
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      assert.equal(
        (
          await call(
            '/organizations',
            'POST',
            { name: `IG Org ${prefix} ${index}` },
            cookie,
          )
        ).status,
        201,
      );
      const brandResponse = await call(
        '/brands',
        'POST',
        { name: `IG Brand ${index}` },
        cookie,
      );
      assert.equal(brandResponse.status, 201);
      const brandId = (
        (await brandResponse.json()) as { brand: { id: string } }
      ).brand.id;
      const draftResponse = await call(
        '/contents',
        'POST',
        {
          brandId,
          title: 'Test draft',
          body: `Saved Instagram caption ${index}`,
        },
        cookie,
      );
      assert.equal(draftResponse.status, 201);
      const contentId = (
        (await draftResponse.json()) as { content: { id: string } }
      ).content.id;
      const account = await db.socialAccount.create({
        data: {
          grantId: randomUUID(),
          brandId,
          platform: 'INSTAGRAM',
          externalId: `${BigInt(`0x${prefix.replaceAll('-', '').slice(0, 15)}`)}${index}`,
          displayName: `ig-test-${index}`,
          accountType: 'PROFESSIONAL',
          status: 'CONNECTED',
          scopes: ['instagram_content_publish'],
          credentialsEncrypted: encryptSocial({
            accessToken: 'private-page-token',
            userToken: 'private-user-token',
            pageId: '12345',
          }),
        },
      });
      const bytes = await sharp({
        create: { width: 100, height: 100, channels: 3, background: '#66aa88' },
      })
        .jpeg()
        .toBuffer();
      const storageKey = randomUUID();
      const storage = app.get(LocalMediaStorage);
      await storage.stage(storageKey, Readable.from([bytes]));
      await storage.publish(storageKey);
      const media = await db.mediaAsset.create({
        data: {
          brandId,
          originalFilename: 'test.jpeg',
          storageKey,
          mimeType: 'image/jpeg',
          sizeBytes: bytes.length,
          width: 100,
          height: 100,
        },
      });
      return {
        cookie,
        userId: user.id,
        brandId,
        contentId,
        accountId: account.id,
        mediaId: media.id,
        bytes,
      };
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const a = await owner(1),
        b = await owner(2);
      const path = `/contents/${a.contentId}/instagram-publications`;
      await t.test(
        'auth, Origin, ownership, strict input and readiness',
        async () => {
          assert.equal((await call(`${path}/readiness`)).status, 401);
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
                'https://evil.test',
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                `/contents/${b.contentId}/instagram-publications/readiness`,
                'GET',
                undefined,
                a.cookie,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: b.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: b.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                  brandId: b.brandId,
                },
                a.cookie,
              )
            ).status,
            400,
          );
          const ready = await call(
            `${path}/readiness`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.equal(ready.status, 200);
          assert.equal(
            (
              (await ready.json()) as {
                accounts: unknown[];
                deliveryConfigured: boolean;
              }
            ).deliveryConfigured,
            true,
          );
          meta.readiness = async () => ({
            eligible: false,
            reason: 'PUBLISH_PERMISSION_MISSING',
          });
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            409,
          );
          meta.readiness = async () => ({ eligible: true, reason: null });
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { status: 'DISCONNECTED' },
          });
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            409,
          );
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: {
              status: 'CONNECTED',
              accessExpiresAt: new Date(Date.now() - 1000),
            },
          });
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            409,
          );
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { accessExpiresAt: null },
          });
        },
      );
      await t.test(
        'JPEG-only validation and fail-closed HTTPS configuration',
        async () => {
          const storage = app.get(LocalMediaStorage);
          const png = await sharp({
            create: {
              width: 100,
              height: 100,
              channels: 3,
              background: '#227744',
            },
          })
            .png()
            .toBuffer();
          const key = randomUUID();
          await storage.stage(key, Readable.from([png]));
          await storage.publish(key);
          const asset = await db.mediaAsset.create({
            data: {
              brandId: a.brandId,
              originalFilename: 'not-jpeg.png',
              storageKey: key,
              mimeType: 'image/png',
              sizeBytes: png.length,
              width: 100,
              height: 100,
            },
          });
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: asset.id,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            400,
          );
          process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN = 'http://127.0.0.1:3001';
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.mediaId,
                  requestId: randomUUID(),
                },
                a.cookie,
              )
            ).status,
            503,
          );
          process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN =
            'https://media.example.test';
          assert.equal(created, 0);
        },
      );
      const requestId = randomUUID();
      const prepared = await call(
        path,
        'POST',
        { socialAccountId: a.accountId, mediaAssetId: a.mediaId, requestId },
        a.cookie,
      );
      assert.equal(prepared.status, 201);
      const row = (
        (await prepared.json()) as {
          publication: {
            id: string;
            status: string;
            mediaSha256: string;
            textSnapshot: string;
          };
        }
      ).publication;
      assert.equal(row.status, 'READY');
      assert.equal(
        row.mediaSha256,
        createHash('sha256').update(a.bytes).digest('hex'),
      );
      assert.equal(created, 0);
      await t.test(
        'idempotent prepare, explicit container, protected signed delivery and separate publish',
        async () => {
          const repeat = await call(
            path,
            'POST',
            {
              socialAccountId: a.accountId,
              mediaAssetId: a.mediaId,
              requestId,
            },
            a.cookie,
          );
          assert.equal(
            ((await repeat.json()) as { publication: { id: string } })
              .publication.id,
            row.id,
          );
          const [first, second] = await Promise.all([
            call(
              `/instagram-publications/${row.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
            call(
              `/instagram-publications/${row.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
          ]);
          assert.equal(first.status, 201);
          assert.equal(second.status, 201);
          assert.equal(created, 1);
          assert.equal(published, 0);
          const signed = new URL(deliveryUrl);
          const image = await call(signed.pathname);
          assert.equal(image.status, 200);
          assert.equal(image.headers.get('content-type'), 'image/jpeg');
          assert.deepEqual(Buffer.from(await image.arrayBuffer()), a.bytes);
          assert.equal((await call(signed.pathname)).status, 200);
          const actualNow = Date.now;
          Date.now = () => Number(signed.pathname.split('/')[3]) * 1000 + 1000;
          try {
            assert.equal((await call(signed.pathname)).status, 404);
          } finally {
            Date.now = actualNow;
          }
          assert.equal(
            (await call(signed.pathname.replace(/.$/, 'X'))).status,
            404,
          );
          const foreignRead = await call(
            `/instagram-publications/${row.id}`,
            'GET',
            undefined,
            b.cookie,
          );
          assert.equal(foreignRead.status, 404);
          const check = await call(
            `/instagram-publications/${row.id}/check`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(check.status, 201);
          assert.equal(published, 0);
          providerState = 'FINISHED';
          const finished = await call(
            `/instagram-publications/${row.id}/check`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(
            (
              (await finished.json()) as {
                publication: { containerStatus: string };
              }
            ).publication.containerStatus,
            'FINISHED',
          );
          const [posted, duplicate] = await Promise.all([
            call(
              `/instagram-publications/${row.id}/publish`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
            call(
              `/instagram-publications/${row.id}/publish`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
          ]);
          assert.equal(posted.status, 201);
          assert.equal(duplicate.status, 201);
          assert.equal(published, 1);
          const final = await call(
            `/instagram-publications/${row.id}`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.equal(
            (
              (await final.json()) as {
                publication: {
                  status: string;
                  providerPostId: string;
                  providerContainerId: string;
                };
              }
            ).publication.status,
            'PUBLISHED',
          );
          assert.equal((await call(signed.pathname)).status, 404);
          assert.equal(
            (await call(path, 'GET', undefined, a.cookie)).status,
            200,
          );
          assert.equal(
            (
              await db.mediaAsset.findUniqueOrThrow({
                where: { id: a.mediaId },
              })
            ).storageKey.length,
            36,
          );
        },
      );
      await t.test(
        'changed source JPEG is rejected before container creation',
        async () => {
          const storage = app.get(LocalMediaStorage);
          const key = randomUUID();
          await storage.stage(key, Readable.from([a.bytes]));
          await storage.publish(key);
          const asset = await db.mediaAsset.create({
            data: {
              brandId: a.brandId,
              originalFilename: 'mutable-test.jpeg',
              storageKey: key,
              mimeType: 'image/jpeg',
              sizeBytes: a.bytes.length,
              width: 100,
              height: 100,
            },
          });
          const prepared = await call(
            path,
            'POST',
            {
              socialAccountId: a.accountId,
              mediaAssetId: asset.id,
              requestId: randomUUID(),
            },
            a.cookie,
          );
          assert.equal(prepared.status, 201);
          const id = (
            (await prepared.json()) as { publication: { id: string } }
          ).publication.id;
          await writeFile(
            await storage.path(key),
            Buffer.from('changed source'),
          );
          const before = created;
          assert.equal(
            (
              await call(
                `/instagram-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(created, before);
        },
      );
      await t.test(
        'final publish rejects a draft edited after container creation',
        async () => {
          const prepared = await call(
            path,
            'POST',
            {
              socialAccountId: a.accountId,
              mediaAssetId: a.mediaId,
              requestId: randomUUID(),
            },
            a.cookie,
          );
          assert.equal(prepared.status, 201);
          const id = (
            (await prepared.json()) as { publication: { id: string } }
          ).publication.id;
          assert.equal(
            (
              await call(
                `/instagram-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await call(
                `/contents/${a.contentId}`,
                'PATCH',
                { body: 'Edited after image processing' },
                a.cookie,
              )
            ).status,
            200,
          );
          const before = published;
          assert.equal(
            (
              await call(
                `/instagram-publications/${id}/publish`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(published, before);
        },
      );
      await t.test(
        'failed and expired provider containers cannot publish',
        async () => {
          const statusFunction = meta.containerStatus;
          for (const state of ['ERROR', 'EXPIRED'] as const) {
            const prepared = await call(
              path,
              'POST',
              {
                socialAccountId: a.accountId,
                mediaAssetId: a.mediaId,
                requestId: randomUUID(),
              },
              a.cookie,
            );
            assert.equal(prepared.status, 201);
            const id = (
              (await prepared.json()) as { publication: { id: string } }
            ).publication.id;
            assert.equal(
              (
                await call(
                  `/instagram-publications/${id}/confirm`,
                  'POST',
                  { confirm: true },
                  a.cookie,
                )
              ).status,
              201,
            );
            meta.containerStatus = async () => state;
            const checked = await call(
              `/instagram-publications/${id}/check`,
              'POST',
              { confirm: true },
              a.cookie,
            );
            assert.equal(
              (
                (await checked.json()) as {
                  publication: { status: string; errorCode: string };
                }
              ).publication.status,
              'FAILED',
            );
            const before = published;
            assert.equal(
              (
                await call(
                  `/instagram-publications/${id}/publish`,
                  'POST',
                  { confirm: true },
                  a.cookie,
                )
              ).status,
              201,
            );
            assert.equal(published, before);
            meta.containerStatus = statusFunction;
          }
        },
      );
      await t.test(
        'stale draft and uncertain publish never resend',
        async () => {
          const p = await call(
            path,
            'POST',
            {
              socialAccountId: a.accountId,
              mediaAssetId: a.mediaId,
              requestId: randomUUID(),
            },
            a.cookie,
          );
          const id = ((await p.json()) as { publication: { id: string } })
            .publication.id;
          assert.equal(
            (
              await call(
                `/contents/${a.contentId}`,
                'PATCH',
                { body: 'Changed saved caption' },
                a.cookie,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/instagram-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          const changed = await call(
            path,
            'POST',
            {
              socialAccountId: a.accountId,
              mediaAssetId: a.mediaId,
              requestId: randomUUID(),
            },
            a.cookie,
          );
          const nextId = (
            (await changed.json()) as { publication: { id: string } }
          ).publication.id;
          meta.publish = async () => {
            published++;
            throw new InstagramPublishError('TIMEOUT', true);
          };
          assert.equal(
            (
              await call(
                `/instagram-publications/${nextId}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(
            (
              await call(
                `/instagram-publications/${nextId}/publish`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          const uncertain = await db.publication.findUniqueOrThrow({
            where: { id: nextId },
          });
          assert.equal(uncertain.status, 'UNCERTAIN');
          assert.equal(uncertain.errorCode, 'TIMEOUT');
          const before = published;
          assert.equal(
            (
              await call(
                `/instagram-publications/${nextId}/publish`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(published, before);
          await assert.rejects(() =>
            reconcileFacebookPublication(db, {
              id: nextId,
              outcome: 'FAILED',
              evidence: 'wrong platform',
              operator: 'test',
            }),
          );
          const auditId = await reconcileInstagramPublication(db, {
            id: nextId,
            outcome: 'FAILED',
            evidence: 'independent Meta activity check found no post',
            operator: 'test-operator',
          });
          assert.ok(/^[0-9a-f-]{36}$/.test(auditId));
          assert.equal(
            (await db.publication.findUniqueOrThrow({ where: { id: nextId } }))
              .status,
            'FAILED',
          );
        },
      );
      await t.test(
        'ambiguous container timeout stays uncertain without another create',
        async () => {
          const foreignPath = `/contents/${b.contentId}/instagram-publications`;
          const prepared = await call(
            foreignPath,
            'POST',
            {
              socialAccountId: b.accountId,
              mediaAssetId: b.mediaId,
              requestId: randomUUID(),
            },
            b.cookie,
          );
          assert.equal(prepared.status, 201);
          const id = (
            (await prepared.json()) as { publication: { id: string } }
          ).publication.id;
          meta.createContainer = async () => {
            created++;
            throw new InstagramPublishError('TIMEOUT', true);
          };
          const before = created;
          assert.equal(
            (
              await call(
                `/instagram-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                b.cookie,
              )
            ).status,
            201,
          );
          assert.equal(created, before + 1);
          assert.equal(
            (await db.publication.findUniqueOrThrow({ where: { id } })).status,
            'UNCERTAIN',
          );
          assert.equal(
            (
              await call(
                `/instagram-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                b.cookie,
              )
            ).status,
            201,
          );
          assert.equal(created, before + 1);
        },
      );
      assert.equal(
        published,
        2,
        'only the two explicitly approved publish actions reached the mock Meta publisher',
      );
    } finally {
      meta.readiness = original.ready;
      meta.createContainer = original.create;
      meta.containerStatus = original.status;
      meta.publish = original.publish;
      await app.close();
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      if (previous.root === undefined) delete process.env.MEDIA_STORAGE_ROOT;
      else process.env.MEDIA_STORAGE_ROOT = previous.root;
      if (previous.origin === undefined)
        delete process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN;
      else process.env.INSTAGRAM_MEDIA_PUBLIC_ORIGIN = previous.origin;
      if (previous.key === undefined)
        delete process.env.INSTAGRAM_DELIVERY_SIGNING_KEY;
      else process.env.INSTAGRAM_DELIVERY_SIGNING_KEY = previous.key;
    }
  },
);

test(
  'Instagram Graph adapter uses fixed endpoints, one write and safe failures',
  { concurrency: false },
  async () => {
    const adapter = new InstagramPublisher();
    const original = globalThis.fetch;
    const requests: {
      path: string;
      method: string;
      body: string;
      auth: string | null;
    }[] = [];
    try {
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          path: url.pathname + url.search,
          method: init?.method ?? 'GET',
          body: String(init?.body ?? ''),
          auth: new Headers(init?.headers).get('authorization'),
        });
        if (url.pathname.endsWith('/media_publish'))
          return Response.json({ id: '90011803596441' });
        if (url.pathname.endsWith('/media'))
          return Response.json({ id: '18270815569115548' });
        return Response.json({
          id: '18270815569115548',
          status_code: 'FINISHED',
        });
      };
      assert.equal(
        await adapter.createContainer(
          '12345',
          'private-token',
          'https://media.example.test/signed',
          'Caption',
        ),
        '18270815569115548',
      );
      assert.equal(
        await adapter.containerStatus('18270815569115548', 'private-token'),
        'FINISHED',
      );
      assert.equal(
        await adapter.publish('12345', '18270815569115548', 'private-token'),
        '90011803596441',
      );
      assert.equal(requests.length, 3);
      assert.ok(requests[0]!.path.endsWith('/12345/media'));
      assert.equal(requests[0]!.method, 'POST');
      assert.ok(requests[0]!.body.includes('image_url='));
      assert.equal(requests[0]!.auth, 'Bearer private-token');
      assert.equal(
        new URL(
          requests[1]!.path,
          'https://graph.facebook.com',
        ).searchParams.get('fields'),
        'id,status_code',
      );
      assert.ok(requests[2]!.path.endsWith('/12345/media_publish'));
      for (const [status, code, uncertain] of [
        [401, 'AUTH', false],
        [403, 'PERMISSION', false],
        [429, 'RATE_LIMIT', false],
        [500, 'PROVIDER_ERROR', true],
      ] as const) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          return new Response(
            '{"error":{"message":"private provider detail"}}',
            { status },
          );
        };
        await assert.rejects(
          () => adapter.publish('12345', '18270815569115548', 'private-token'),
          (error: unknown) => {
            assert.ok(error instanceof InstagramPublishError);
            assert.equal(error.code, code);
            assert.equal(error.uncertain, uncertain);
            assert.equal(
              error.message.includes('private provider detail'),
              false,
            );
            return true;
          },
        );
        assert.equal(calls, 1);
      }
    } finally {
      globalThis.fetch = original;
    }
  },
);

test(
  'Instagram readiness requires live grants, linked Page task and matching ID',
  { concurrency: false },
  async () => {
    const adapter = new InstagramPublisher();
    const original = globalThis.fetch;
    const grants = [
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_content_publish',
    ];
    let granted = [...grants],
      linked = true,
      task = true;
    try {
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/me/permissions'))
          return Response.json({
            data: granted.map((permission) => ({
              permission,
              status: 'granted',
            })),
          });
        if (path.endsWith('/me/accounts'))
          return Response.json({
            data: [
              {
                id: '12345',
                tasks: task ? ['CREATE_CONTENT'] : [],
                instagram_business_account: { id: linked ? '67890' : '99999' },
              },
            ],
          });
        return Response.json({ id: '67890' });
      };
      assert.deepEqual(
        await adapter.readiness(
          '67890',
          'private-user',
          'private-page',
          '12345',
        ),
        { eligible: true, reason: null },
      );
      granted = grants.filter((name) => name !== 'instagram_content_publish');
      assert.deepEqual(
        await adapter.readiness(
          '67890',
          'private-user',
          'private-page',
          '12345',
        ),
        { eligible: false, reason: 'PUBLISH_PERMISSION_MISSING' },
      );
      granted = [...grants];
      linked = false;
      assert.deepEqual(
        await adapter.readiness(
          '67890',
          'private-user',
          'private-page',
          '12345',
        ),
        { eligible: false, reason: 'PAGE_LINK_OR_TASK_MISSING' },
      );
      linked = true;
      task = false;
      assert.deepEqual(
        await adapter.readiness(
          '67890',
          'private-user',
          'private-page',
          '12345',
        ),
        { eligible: false, reason: 'PAGE_LINK_OR_TASK_MISSING' },
      );
      assert.deepEqual(
        await adapter.readiness('67890', '', 'private-page', '12345'),
        { eligible: false, reason: 'REAUTHORIZE' },
      );
    } finally {
      globalThis.fetch = original;
    }
  },
);
