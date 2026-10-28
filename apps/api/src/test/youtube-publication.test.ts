import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { LocalMediaStorage } from '../media/storage.js';
import { encryptSocial, decryptSocial } from '../social/crypto.js';
import {
  YouTubePublisher,
  YouTubePublishError,
} from '../social/youtube-publisher.js';

const fixture = new URL(
  '../../src/test/fixtures/media/sample.mp4',
  import.meta.url,
);
type Result = {
  publication: {
    id: string;
    status: string;
    youtubePrivacy: string;
    youtubeUploadedBytes: number;
    providerPostId: string | null;
    watchUrl: string | null;
    shortsEligible: boolean;
    errorCode: string | null;
  };
};

test(
  'YTP-001–009 Nest, real PostgreSQL, private MP4 and deterministic YouTube',
  { timeout: 90_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const previous = {
      root: process.env.MEDIA_STORAGE_ROOT,
      id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      keys: process.env.SOCIAL_TOKEN_KEYS_JSON,
      active: process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID,
    };
    const root = await mkdtemp(join(tmpdir(), 'synvaro-youtube-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'mock-google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'mock-google-secret';
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({
      test: randomBytes(32).toString('base64'),
    });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'test';
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const publisher = app.get(YouTubePublisher);
    const original = {
      readiness: publisher.readiness.bind(publisher),
      initiate: publisher.initiate.bind(publisher),
      probe: publisher.probe.bind(publisher),
      upload: publisher.upload.bind(publisher),
      verify: publisher.verify.bind(publisher),
    };
    let initiations = 0,
      uploads = 0,
      probes = 0,
      failUpload = false,
      initiateFailure: YouTubePublishError | null = null,
      probeFailure: YouTubePublishError | null = null,
      probeCompleted = false,
      processing: 'processing' | 'succeeded' = 'succeeded';
    publisher.readiness = async (channel) => channel.startsWith('UCtest');
    publisher.initiate = async () => {
      initiations++;
      if (initiateFailure) throw initiateFailure;
      return 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=mockupload123';
    };
    publisher.probe = async () => {
      probes++;
      if (probeFailure) throw probeFailure;
      if (probeCompleted) return { kind: 'COMPLETE', videoId: 'abcdefghijk' };
      return { kind: 'INCOMPLETE', offset: 0 };
    };
    publisher.upload = async (_session, token, stream, start, end, size) => {
      uploads++;
      assert.equal(token, 'private-youtube-token');
      assert.equal(start, 0);
      assert.equal(end + 1, size);
      const parts: Buffer[] = [];
      for await (const part of stream) parts.push(Buffer.from(part));
      assert.deepEqual(Buffer.concat(parts), await readFile(fixture));
      if (failUpload) throw new YouTubePublishError('TIMEOUT', true);
      return { kind: 'COMPLETE', videoId: 'abcdefghijk' };
    };
    publisher.verify = async (_id, channel, privacy) => {
      assert.ok(channel.startsWith('UCtest'));
      assert.ok(['private', 'public'].includes(privacy));
      return processing;
    };
    let base = '';
    const nonce = randomUUID();
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
      const email = `yt-${nonce}-${index}@example.test`;
      assert.equal(
        (
          await call('/auth/register', 'POST', {
            email,
            password: `Strong-${nonce}`,
          })
        ).status,
        201,
      );
      const login = await call('/auth/login', 'POST', {
        email,
        password: `Strong-${nonce}`,
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal(
        (
          await call(
            '/organizations',
            'POST',
            { name: `YT Org ${nonce} ${index}` },
            cookie,
          )
        ).status,
        201,
      );
      const brand = await call(
        '/brands',
        'POST',
        { name: `YT Brand ${index}` },
        cookie,
      );
      const brandId = ((await brand.json()) as { brand: { id: string } }).brand
        .id;
      const content = await call(
        '/contents',
        'POST',
        { brandId, title: 'Draft title', body: 'Saved video description' },
        cookie,
      );
      const contentId = ((await content.json()) as { content: { id: string } })
        .content.id;
      const channel = await db.socialAccount.create({
        data: {
          grantId: randomUUID(),
          brandId,
          platform: 'YOUTUBE',
          externalId: `UCtest${index}${nonce.slice(0, 18).replaceAll('-', '')}`,
          displayName: `Mock channel ${index}`,
          accountType: 'CHANNEL',
          status: 'CONNECTED',
          scopes: [
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/youtube.upload',
          ],
          credentialsEncrypted: encryptSocial({
            accessToken: 'private-youtube-token',
            refreshToken: 'private-refresh-token',
          }),
        },
      });
      const bytes = await readFile(fixture);
      const key = randomUUID();
      const storage = app.get(LocalMediaStorage);
      await storage.stage(key, Readable.from([bytes]));
      await storage.publish(key);
      const asset = await db.mediaAsset.create({
        data: {
          brandId,
          originalFilename: `synthetic-${index}.mp4`,
          storageKey: key,
          mimeType: 'video/mp4',
          sizeBytes: bytes.length,
          width: 320,
          height: 240,
          durationMs: 1000,
        },
      });
      return {
        cookie,
        brandId,
        contentId,
        accountId: channel.id,
        assetId: asset.id,
        bytes,
        key,
      };
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const a = await owner(1),
        b = await owner(2);
      // The fixture's actual dimensions/duration are used below after inspection.
      const { inspectMedia } = await import('../media/inspect.js');
      for (const owner of [a, b]) {
        const details = await inspectMedia(
          await app.get(LocalMediaStorage).path(owner.key),
        );
        await db.mediaAsset.update({
          where: { id: owner.assetId },
          data: {
            width: details.width,
            height: details.height,
            durationMs: details.durationMs,
          },
        });
      }
      const path = `/contents/${a.contentId}/youtube-publications`;
      const prepare = (
        cookie = a.cookie,
        extra: Record<string, unknown> = {},
      ) =>
        call(
          path,
          'POST',
          {
            socialAccountId: a.accountId,
            mediaAssetId: a.assetId,
            title: 'Explicit video title',
            requestId: randomUUID(),
            ...extra,
          },
          cookie,
        );
      await t.test(
        'YTP-001/002/003/009 auth, Origin, grant, source and metadata validation',
        async () => {
          assert.equal((await prepare('')).status, 401);
          assert.equal(
            (
              await call(
                path,
                'POST',
                {
                  socialAccountId: a.accountId,
                  mediaAssetId: a.assetId,
                  title: 'T',
                  requestId: randomUUID(),
                },
                a.cookie,
                'https://evil.example',
              )
            ).status,
            403,
          );
          assert.equal((await prepare(b.cookie)).status, 404);
          assert.equal(
            (await prepare(a.cookie, { socialAccountId: b.accountId })).status,
            404,
          );
          assert.equal(
            (await prepare(a.cookie, { mediaAssetId: b.assetId })).status,
            404,
          );
          assert.equal(
            (await prepare(a.cookie, { title: '<bad>' })).status,
            400,
          );
          assert.equal(
            (await prepare(a.cookie, { title: 'x'.repeat(101) })).status,
            400,
          );
          assert.equal(
            (await prepare(a.cookie, { privacy: 'friends' })).status,
            400,
          );
          assert.equal(
            (await prepare(a.cookie, { ownerUserId: randomUUID() })).status,
            400,
          );
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: {
              scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
            },
          });
          assert.equal((await prepare()).status, 409);
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: {
              scopes: [
                'https://www.googleapis.com/auth/youtube.readonly',
                'https://www.googleapis.com/auth/youtube.upload',
              ],
              accessExpiresAt: new Date(Date.now() - 1000),
            },
          });
          assert.equal((await prepare()).status, 409);
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { accessExpiresAt: null },
          });
          const readiness = await call(
            `${path}/readiness`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.equal(readiness.status, 200);
          assert.equal(
            ((await readiness.json()) as { channels: { eligible: boolean }[] })
              .channels[0]?.eligible,
            true,
          );
          assert.equal(
            (
              await call(
                `/youtube-publications/${randomUUID()}`,
                'GET',
                undefined,
                a.cookie,
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        'YTP-003/004/006/007 private default, immutable review and one concurrent upload',
        async () => {
          const prepared = await prepare();
          assert.equal(prepared.status, 201);
          const intent = (await prepared.json()) as Result;
          assert.equal(intent.publication.youtubePrivacy, 'private');
          assert.equal(intent.publication.status, 'READY');
          assert.equal(initiations, 0);
          assert.equal(
            (
              await call(
                `/youtube-publications/${intent.publication.id}/confirm`,
                'POST',
                { confirm: false },
                a.cookie,
              )
            ).status,
            400,
          );
          const [one, two] = await Promise.all([
            call(
              `/youtube-publications/${intent.publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
            call(
              `/youtube-publications/${intent.publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
          ]);
          assert.equal(one.status, 201);
          assert.equal(two.status, 201);
          assert.equal(initiations, 1);
          assert.equal(uploads, 1);
          const current = (await (
            await call(
              `/youtube-publications/${intent.publication.id}`,
              'GET',
              undefined,
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(current.publication.status, 'PUBLISHED');
          assert.equal(current.publication.providerPostId, 'abcdefghijk');
          assert.equal(
            current.publication.youtubeUploadedBytes,
            a.bytes.length,
          );
          assert.ok(current.publication.watchUrl?.includes('abcdefghijk'));
          const stored = await db.publication.findUniqueOrThrow({
            where: { id: intent.publication.id },
          });
          assert.equal(
            stored.mediaSha256,
            createHash('sha256').update(a.bytes).digest('hex'),
          );
          assert.ok(stored.youtubeSessionEncrypted?.startsWith('v1:'));
          assert.ok(!stored.youtubeSessionEncrypted?.includes('mockupload123'));
          assert.equal(
            decryptSocial<{ uri: string }>(
              stored.youtubeSessionEncrypted!,
            ).uri.includes('mockupload123'),
            true,
          );
          assert.equal(
            (
              await db.mediaAsset.findUniqueOrThrow({
                where: { id: a.assetId },
              })
            ).storageKey,
            a.key,
          );
          assert.equal(
            (
              await call(
                `/youtube-publications/${intent.publication.id}`,
                'GET',
                undefined,
                b.cookie,
              )
            ).status,
            404,
          );
          const fb = await call(
            `/contents/${a.contentId}/facebook-publications`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.deepEqual(await fb.json(), { publications: [] });
        },
      );
      await t.test(
        'YTP-005/006 ambiguous upload probes and resumes same session without new initiation',
        async () => {
          failUpload = true;
          const prepared = await prepare(a.cookie, {
            title: 'Second upload',
            privacy: 'public',
          });
          const intent = (await prepared.json()) as Result;
          assert.equal(intent.publication.youtubePrivacy, 'public');
          const first = await call(
            `/youtube-publications/${intent.publication.id}/confirm`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(first.status, 201);
          assert.equal(
            ((await first.json()) as Result).publication.status,
            'UNCERTAIN',
          );
          assert.equal(initiations, 2);
          assert.equal(uploads, 2);
          assert.equal(
            (
              await prepare(a.cookie, {
                title: 'Second upload',
                privacy: 'public',
              })
            ).status,
            409,
          );
          failUpload = false;
          const resumed = await call(
            `/youtube-publications/${intent.publication.id}/resume`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(resumed.status, 201);
          assert.equal(
            ((await resumed.json()) as Result).publication.status,
            'PUBLISHED',
          );
          assert.equal(initiations, 2);
          assert.equal(uploads, 3);
          assert.equal(probes, 1);
          assert.equal(
            (
              await call(
                `/youtube-publications/${intent.publication.id}/resume`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(initiations, 2);
        },
      );
      await t.test(
        'YTP-003/006/007 stale draft, source mutation, processing and owner history',
        async () => {
          const stale = (await (
            await prepare(a.cookie, { title: 'Stale' })
          ).json()) as Result;
          assert.equal(
            (
              await call(
                `/contents/${a.contentId}`,
                'PATCH',
                { body: 'Saved changed description' },
                a.cookie,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/youtube-publications/${stale.publication.id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(initiations, 2);
          processing = 'processing';
          const fresh = (await (
            await prepare(a.cookie, { title: 'Processing' })
          ).json()) as Result;
          const first = (await (
            await call(
              `/youtube-publications/${fresh.publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(first.publication.status, 'PROCESSING');
          processing = 'succeeded';
          const checked = (await (
            await call(
              `/youtube-publications/${fresh.publication.id}/check`,
              'POST',
              {},
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(checked.publication.status, 'PUBLISHED');
          assert.equal(initiations, 3);
          const history = await call(path, 'GET', undefined, a.cookie);
          assert.ok(
            (
              (await history.json()) as {
                publications: Result['publication'][];
              }
            ).publications.length >= 4,
          );
          assert.equal(
            (await call(path, 'GET', undefined, b.cookie)).status,
            404,
          );
        },
      );
      await t.test(
        'YTP-002/005/006 corrupt source, definite rejection and ambiguous initiation',
        async () => {
          const before = initiations;
          const invalid = (await (
            await prepare(a.cookie, { title: 'Source changed' })
          ).json()) as Result;
          await db.mediaAsset.update({
            where: { id: a.assetId },
            data: { sizeBytes: a.bytes.length - 1 },
          });
          assert.equal(
            (
              await call(
                `/youtube-publications/${invalid.publication.id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(initiations, before);
          await db.mediaAsset.update({
            where: { id: a.assetId },
            data: { sizeBytes: a.bytes.length },
          });

          initiateFailure = new YouTubePublishError('AUTH', false);
          const rejected = (await (
            await prepare(a.cookie, { title: 'Definite rejection' })
          ).json()) as Result;
          const rejectedResult = (await (
            await call(
              `/youtube-publications/${rejected.publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(rejectedResult.publication.status, 'FAILED');
          assert.equal(rejectedResult.publication.errorCode, 'AUTH');
          assert.equal(initiations, before + 1);
          initiateFailure = new YouTubePublishError('TIMEOUT', true);
          const ambiguous = (await (
            await prepare(a.cookie, { title: 'Unknown initiation' })
          ).json()) as Result;
          const uncertain = (await (
            await call(
              `/youtube-publications/${ambiguous.publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(uncertain.publication.status, 'UNCERTAIN');
          assert.equal(
            (
              await call(
                `/youtube-publications/${ambiguous.publication.id}/resume`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await call(
                `/youtube-publications/${ambiguous.publication.id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(initiations, before + 2);
          initiateFailure = null;

          failUpload = true;
          const expired = (await (
            await prepare(a.cookie, { title: 'Expired session' })
          ).json()) as Result;
          assert.equal(
            (
              (await (
                await call(
                  `/youtube-publications/${expired.publication.id}/confirm`,
                  'POST',
                  { confirm: true },
                  a.cookie,
                )
              ).json()) as Result
            ).publication.status,
            'UNCERTAIN',
          );
          failUpload = false;
          probeFailure = new YouTubePublishError('EXPIRED', false);
          const expiredResult = (await (
            await call(
              `/youtube-publications/${expired.publication.id}/resume`,
              'POST',
              { confirm: true },
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(expiredResult.publication.status, 'UNCERTAIN');
          assert.equal(expiredResult.publication.errorCode, 'EXPIRED');
          assert.equal(initiations, before + 3);
          probeFailure = null;

          const completed = (await (
            await prepare(a.cookie, { title: 'Completed on probe' })
          ).json()) as Result;
          failUpload = true;
          assert.equal(
            (
              (await (
                await call(
                  `/youtube-publications/${completed.publication.id}/confirm`,
                  'POST',
                  { confirm: true },
                  a.cookie,
                )
              ).json()) as Result
            ).publication.status,
            'UNCERTAIN',
          );
          failUpload = false;
          probeCompleted = true;
          const resumed = (await (
            await call(
              `/youtube-publications/${completed.publication.id}/resume`,
              'POST',
              { confirm: true },
              a.cookie,
            )
          ).json()) as Result;
          assert.equal(resumed.publication.status, 'PUBLISHED');
          assert.equal(
            resumed.publication.youtubeUploadedBytes,
            a.bytes.length,
          );
          assert.equal(initiations, before + 4);
        },
      );
    } finally {
      publisher.readiness = original.readiness;
      publisher.initiate = original.initiate;
      publisher.probe = original.probe;
      publisher.upload = original.upload;
      publisher.verify = original.verify;
      await app.close();
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      for (const [key, value] of Object.entries({
        MEDIA_STORAGE_ROOT: previous.root,
        GOOGLE_OAUTH_CLIENT_ID: previous.id,
        GOOGLE_OAUTH_CLIENT_SECRET: previous.secret,
        SOCIAL_TOKEN_KEYS_JSON: previous.keys,
        SOCIAL_TOKEN_ACTIVE_KEY_ID: previous.active,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
