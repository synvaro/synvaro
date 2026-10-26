import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { LocalMediaStorage } from '../media/storage.js';
import { MAX_FILE_BYTES } from '../media/inspect.js';
import type { MediaAsset } from '@synvaro/contracts';

const fixtures = new URL('../../src/test/fixtures/media/', import.meta.url);
test(
  'MED-001–004: real PostgreSQL, private filesystem and HTTP media lifecycle',
  { timeout: 60000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const db = createDatabase(config.databaseUrl);
    const root = await mkdtemp(join(tmpdir(), 'synvaro-media-test-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    const app = await createApp();
    const prefix = `media-${randomUUID()}`;
    const users: { id: string; cookie: string }[] = [];
    let base = '';
    let first: MediaAsset;
    let brandId = '';
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
    async function upload(
      bytes: Uint8Array,
      name = 'sample.png',
      brand = brandId,
      cookie = users[0]!.cookie,
      origin = config.origin,
      extra = false,
    ) {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
        name,
      );
      if (extra) form.append('organizationId', randomUUID());
      return fetch(`${base}/brands/${brand}/media`, {
        method: 'POST',
        headers: { cookie, origin },
        body: form,
      });
    }
    const files: Record<string, Buffer> = Object.fromEntries(
      await Promise.all(
        ['jpeg', 'png', 'webp', 'mp4'].map(
          async (format) =>
            [
              format,
              await readFile(new URL(`sample.${format}`, fixtures)),
            ] as const,
        ),
      ),
    );
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
        data: { ownerUserId: users[0]!.id, name: 'Media test', slug: prefix },
      });
      const other = await db.organization.create({
        data: {
          ownerUserId: users[1]!.id,
          name: 'Other',
          slug: prefix + '-other',
        },
      });
      const brand = await db.brand.create({
        data: { organizationId: org.id, name: 'Qos Workspace', slug: 'qos' },
      });
      brandId = brand.id;
      const second = await db.brand.create({
        data: { organizationId: org.id, name: 'ISIS Türkiye', slug: 'isis' },
      });
      const foreign = await db.brand.create({
        data: { organizationId: other.id, name: 'Foreign', slug: 'foreign' },
      });
      await t.test(
        'MED-001-A1/A2 / MED-003-A1: four formats, identical filenames, byte integrity and metadata provenance',
        async () => {
          for (const [format, bytes] of Object.entries(files)) {
            const response = await upload(bytes, 'original.dat');
            assert.equal(response.status, 201, await response.clone().text());
            const asset = (await response.json()).asset as MediaAsset;
            first ??= asset;
            assert.equal(
              asset.mimeType,
              format === 'mp4' ? 'video/mp4' : `image/${format}`,
            );
            assert.equal(asset.originalFilename, 'original.dat');
            assert.equal(asset.origin, 'UPLOADED');
            assert.equal(asset.sizeBytes, bytes.length);
            assert.equal(asset.width, 96);
            assert.equal(asset.height, 64);
            assert.equal(asset.durationMs, format === 'mp4' ? 2000 : null);
            assert.ok(!('storageKey' in asset));
            const metadata = await call(`/media/${asset.id}`);
            assert.equal(metadata.status, 200);
            assert.deepEqual((await metadata.json()).asset, asset);
            const download = await call(`/media/${asset.id}/file`);
            assert.equal(download.status, 200);
            assert.equal(download.headers.get('content-type'), asset.mimeType);
            assert.equal(
              download.headers.get('x-content-type-options'),
              'nosniff',
            );
            assert.equal(
              download.headers.get('cache-control'),
              'private, no-store',
            );
            assert.equal(
              download.headers.get('cross-origin-resource-policy'),
              'same-origin',
            );
            assert.match(
              download.headers.get('content-security-policy')!,
              /sandbox/,
            );
            assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
            const stored = await db.mediaAsset.findUniqueOrThrow({
              where: { id: asset.id },
            });
            assert.notEqual(stored.storageKey, asset.originalFilename);
            assert.deepEqual(
              await readFile(join(root, stored.storageKey)),
              bytes,
            );
            assert.equal(
              (await stat(join(root, stored.storageKey))).mode & 0o777,
              0o600,
            );
          }
          assert.equal(new Set(await readdir(root)).size, 4);
          assert.equal((await stat(root)).mode & 0o777, 0o700);
        },
      );
      await t.test(
        'MED-002-A1: brand lists stay separate and persist when reloaded',
        async () => {
          assert.equal(
            (await (await call(`/brands/${brandId}/media`)).json()).assets
              .length,
            4,
          );
          assert.deepEqual(
            await (await call(`/brands/${second.id}/media`)).json(),
            { assets: [] },
          );
          assert.equal(
            (await upload(files.png!, 'isis.png', second.id)).status,
            201,
          );
          assert.equal(
            (await (await call(`/brands/${second.id}/media`)).json()).assets
              .length,
            1,
          );
          assert.equal(
            (await (await call(`/brands/${brandId}/media`)).json()).assets
              .length,
            4,
          );
        },
      );
      await t.test(
        'MED-003-A2: authenticated byte ranges support previews without full buffering',
        async () => {
          const response = await fetch(`${base}/media/${first.id}/file`, {
            headers: { cookie: users[0]!.cookie, range: 'bytes=0-7' },
          });
          assert.equal(response.status, 206);
          assert.equal(
            response.headers.get('content-range'),
            `bytes 0-7/${first.sizeBytes}`,
          );
          assert.deepEqual(
            Buffer.from(await response.arrayBuffer()),
            files.jpeg!.subarray(0, 8),
          );
          const suffix = await fetch(`${base}/media/${first.id}/file`, {
            headers: { cookie: users[0]!.cookie, range: 'bytes=-8' },
          });
          assert.equal(suffix.status, 206);
          assert.deepEqual(
            Buffer.from(await suffix.arrayBuffer()),
            files.jpeg!.subarray(-8),
          );
          for (const range of [
            'bytes=999999-',
            'bytes=0-1,3-4',
            'bytes=-0',
            'garbage',
          ])
            assert.equal(
              (
                await fetch(`${base}/media/${first.id}/file`, {
                  headers: { cookie: users[0]!.cookie, range },
                })
              ).status,
              416,
            );
        },
      );
      await t.test(
        'MED-004-A1/A2: unknown/foreign metadata and bytes, unauthenticated requests and CSRF',
        async () => {
          for (const suffix of ['', '/file']) {
            const a = await call(
              `/media/${first.id}${suffix}`,
              'GET',
              undefined,
              users[1]!.cookie,
            );
            const b = await call(
              `/media/${randomUUID()}${suffix}`,
              'GET',
              undefined,
              users[1]!.cookie,
            );
            assert.equal(a.status, 404);
            assert.equal(b.status, 404);
            assert.deepEqual(await a.json(), await b.json());
            assert.equal(
              (await call(`/media/${first.id}${suffix}`, 'GET', undefined, ''))
                .status,
              401,
            );
          }
          for (const method of ['GET', 'POST']) {
            const send = (id: string) =>
              method === 'GET'
                ? call(`/brands/${id}/media`)
                : upload(files.png!, 'test.png', id);
            const a = await send(foreign.id),
              b = await send(randomUUID());
            assert.equal(a.status, 404);
            assert.equal(b.status, 404);
            assert.deepEqual(await a.json(), await b.json());
          }
          assert.equal(
            (await call(`/brands/${brandId}/media`, 'GET', undefined, ''))
              .status,
            401,
          );
          assert.equal(
            (await upload(files.png!, 'test.png', brandId, '')).status,
            401,
          );
          for (const origin of ['https://evil.example', ''])
            assert.equal(
              (
                await upload(
                  files.png!,
                  'test.png',
                  brandId,
                  users[0]!.cookie,
                  origin,
                )
              ).status,
              403,
            );
        },
      );
      await t.test(
        'MED-004-A3 / MED-001-A3: malformed formats, unsupported fields and cleanup',
        async () => {
          const before = (await readdir(root)).sort();
          for (const bytes of [
            Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
            Buffer.from('GIF89a'),
            Buffer.alloc(0),
            files.png!.subarray(0, 40),
            files.jpeg!.subarray(0, 30),
            files.webp!.subarray(0, 30),
            files.mp4!.subarray(0, 100),
          ]) {
            const response = await upload(bytes, 'fake.png');
            assert.equal(response.status, 400, await response.clone().text());
            assert.deepEqual((await readdir(root)).sort(), before);
          }
          assert.equal(
            (
              await upload(
                files.png!,
                'valid.png',
                brandId,
                users[0]!.cookie,
                config.origin,
                true,
              )
            ).status,
            400,
          );
          const multi = new FormData();
          for (let i = 0; i < 2; i++)
            multi.append(
              'file',
              new Blob([new Uint8Array(files.png!)]),
              'two.png',
            );
          assert.equal(
            (
              await fetch(`${base}/brands/${brandId}/media`, {
                method: 'POST',
                headers: { cookie: users[0]!.cookie, origin: config.origin },
                body: multi,
              })
            ).status,
            400,
          );
          assert.deepEqual((await readdir(root)).sort(), before);
        },
      );
      await t.test(
        'MED-004-A3: filename traversal stays metadata-only and storage rejects unsafe keys',
        async () => {
          const response = await upload(files.png!, '../../escape.png');
          assert.equal(response.status, 201);
          const asset = (await response.json()).asset;
          assert.equal(asset.originalFilename, 'escape.png');
          const stored = await db.mediaAsset.findUniqueOrThrow({
            where: { id: asset.id },
          });
          assert.match(stored.storageKey, /^[0-9a-f-]{36}$/);
          const storage = new LocalMediaStorage();
          await assert.rejects(storage.path('../escape'));
          await assert.rejects(storage.read('/etc/passwd'));
        },
      );
      await t.test(
        'MED-001-A3: exact size boundary, streamed excess and no partial objects',
        async () => {
          const exact = Buffer.alloc(MAX_FILE_BYTES);
          files.jpeg!.copy(exact);
          assert.equal((await upload(exact, 'boundary.jpeg')).status, 201);
          const before = (await readdir(root)).sort();
          const oversized = Buffer.concat([exact, Buffer.alloc(1)]);
          const response = await upload(oversized, 'oversized.jpeg');
          assert.equal(response.status, 413, await response.clone().text());
          assert.deepEqual((await readdir(root)).sort(), before);
        },
      );
      await t.test(
        'MED-001-A3: interrupted multipart stream removes its staging file',
        async () => {
          const before = (await readdir(root)).sort();
          await new Promise<void>((resolve, reject) => {
            const req = request(
              `${base}/brands/${brandId}/media`,
              {
                method: 'POST',
                headers: {
                  cookie: users[0]!.cookie,
                  origin: config.origin,
                  'content-type': 'multipart/form-data; boundary=interrupt',
                },
              },
              (res) => {
                res.resume();
                reject(new Error(`Unexpected response ${res.statusCode}`));
              },
            );
            req.on('error', () => resolve());
            req.write(
              '--interrupt\r\nContent-Disposition: form-data; name="file"; filename="interrupted.png"\r\nContent-Type: image/png\r\n\r\n',
            );
            req.write(files.png!);
            const wait = async () => {
              for (let i = 0; i < 100; i++) {
                if (
                  (await readdir(root)).some((name) => name.endsWith('.part'))
                ) {
                  req.destroy();
                  return;
                }
                await new Promise((r) => setTimeout(r, 10));
              }
              req.destroy();
              reject(new Error('Staging file was not observed'));
            };
            void wait();
          });
          for (
            let i = 0;
            i < 100 &&
            (await readdir(root)).some((name) => name.endsWith('.part'));
            i++
          )
            await new Promise((r) => setTimeout(r, 10));
          assert.deepEqual((await readdir(root)).sort(), before);
        },
      );
      await t.test(
        'MED-001-A3: real database rejection removes published bytes; response hides internals',
        async () => {
          const before = (await readdir(root)).sort();
          await db.$executeRawUnsafe(
            `CREATE FUNCTION media_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."originalFilename" = 'reject-db.png' THEN RAISE EXCEPTION 'private database detail'; END IF; RETURN NEW; END $$`,
          );
          await db.$executeRawUnsafe(
            `CREATE TRIGGER media_test_reject BEFORE INSERT ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION media_test_reject()`,
          );
          try {
            const response = await upload(files.png!, 'reject-db.png');
            assert.equal(response.status, 500);
            assert.doesNotMatch(
              await response.text(),
              /private database detail|storageKey|\/tmp\/|Prisma/,
            );
            assert.deepEqual((await readdir(root)).sort(), before);
            assert.equal(
              await db.mediaAsset.count({
                where: { originalFilename: 'reject-db.png' },
              }),
              0,
            );
          } finally {
            await db.$executeRawUnsafe(
              'DROP TRIGGER media_test_reject ON "MediaAsset"',
            );
            await db.$executeRawUnsafe('DROP FUNCTION media_test_reject()');
          }
        },
      );
      await t.test(
        'MED-001-A3: filesystem stream failures leave no object after cleanup',
        async () => {
          const storage = new LocalMediaStorage(),
            key = randomUUID();
          const source = Readable.from(
            (async function* () {
              yield files.png!;
              throw new Error('Interrupted source');
            })(),
          );
          await assert.rejects(storage.stage(key, source));
          await storage.remove(key);
          assert.ok(
            !(await readdir(root)).some((name) => name.startsWith(key)),
          );
        },
      );
      await t.test(
        'MED-001-A3 / MED-004-A3: chunked oversize body and missing validator fail closed',
        async () => {
          const before = (await readdir(root)).sort();
          const stream = Readable.from(
            (async function* () {
              yield Buffer.from(
                '--size\r\nContent-Disposition: form-data; name="file"; filename="large.png"\r\n\r\n',
              );
              for (let i = 0; i < 21; i++) yield Buffer.alloc(1024 * 1024);
              yield Buffer.from('\r\n--size--\r\n');
            })(),
          );
          const response = await fetch(`${base}/brands/${brandId}/media`, {
            method: 'POST',
            headers: {
              cookie: users[0]!.cookie,
              origin: config.origin,
              'content-type': 'multipart/form-data; boundary=size',
            },
            body: Readable.toWeb(stream),
            duplex: 'half',
          } as RequestInit & { duplex: string });
          assert.equal(response.status, 413);
          assert.deepEqual((await readdir(root)).sort(), before);
          const prior = process.env.FFPROBE_PATH;
          process.env.FFPROBE_PATH = join(root, 'nonexistent-ffprobe');
          try {
            assert.equal((await upload(files.mp4!, 'video.mp4')).status, 503);
          } finally {
            if (prior) process.env.FFPROBE_PATH = prior;
            else delete process.env.FFPROBE_PATH;
          }
          assert.deepEqual((await readdir(root)).sort(), before);
        },
      );
      await t.test(
        'MED-004-A3: storage refuses implicit, relative and repository roots',
        async () => {
          try {
            for (const value of ['', 'relative', process.cwd()]) {
              process.env.MEDIA_STORAGE_ROOT = value;
              await assert.rejects(new LocalMediaStorage().path(randomUUID()));
            }
          } finally {
            process.env.MEDIA_STORAGE_ROOT = root;
          }
        },
      );
      await t.test(
        'MED-004-A2: expired and revoked sessions cannot stream originals',
        async () => {
          const tokenHash = createHash('sha256')
            .update(users[0]!.cookie.split('=')[1]!)
            .digest('hex');
          await db.session.update({
            where: { tokenHash },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          assert.equal((await call(`/media/${first.id}/file`)).status, 401);
          await db.session.update({
            where: { tokenHash },
            data: {
              expiresAt: new Date(Date.now() + 60000),
              revokedAt: new Date(),
            },
          });
          assert.equal((await call(`/media/${first.id}/file`)).status, 401);
        },
      );
      await t.test(
        'MED-001–004: OpenAPI documents all protected media operations',
        async () => {
          const doc = await (await call('/openapi.json')).json();
          for (const [path, method] of [
            ['/brands/{brandId}/media', 'post'],
            ['/brands/{brandId}/media', 'get'],
            ['/media/{id}', 'get'],
            ['/media/{id}/file', 'get'],
          ])
            assert.ok(doc.paths[path!]![method!].security);
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
