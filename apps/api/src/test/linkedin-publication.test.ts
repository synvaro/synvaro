import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { encryptSocial } from '../social/crypto.js';
import {
  LinkedInPublisher,
  LinkedInPublishError,
} from '../social/linkedin-publisher.js';
import { LocalMediaStorage } from '../media/storage.js';
import { reconcileLinkedInPublication } from '../publication/reconciliation.js';

type Publication = {
  id: string;
  status: string;
  textSnapshot: string;
  providerPostId: string | null;
  providerImageUrn: string | null;
  imageUploadStage: string | null;
  errorCode: string | null;
};

test(
  'LIP-001–009 Nest + real PostgreSQL + deterministic LinkedIn',
  { timeout: 90_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const previous = {
      root: process.env.MEDIA_STORAGE_ROOT,
      client: process.env.LINKEDIN_CLIENT_ID,
      secret: process.env.LINKEDIN_CLIENT_SECRET,
      keys: process.env.SOCIAL_TOKEN_KEYS_JSON,
      active: process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID,
    };
    const root = await mkdtemp(join(tmpdir(), 'synvaro-linkedin-'));
    process.env.MEDIA_STORAGE_ROOT = root;
    process.env.LINKEDIN_CLIENT_ID = 'mock-client';
    process.env.LINKEDIN_CLIENT_SECRET = 'mock-secret';
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({
      test: randomBytes(32).toString('base64'),
    });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'test';
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const adapter = app.get(LinkedInPublisher);
    const original = {
      readiness: adapter.readiness.bind(adapter),
      initialize: adapter.initializeImage.bind(adapter),
      upload: adapter.uploadImage.bind(adapter),
      imageReady: adapter.imageReady.bind(adapter),
      publish: adapter.publish.bind(adapter),
    };
    adapter.readiness = async () => ({
      eligible: true,
      reason: null,
      productAccessVerified: false,
    });
    let publishCalls = 0,
      imageUploads = 0,
      failPost = false,
      failUpload = false;
    adapter.initializeImage = async () => ({
      urn: 'urn:li:image:mockasset123',
      url: 'https://www.linkedin.com/dms-uploads/mockasset123/upload',
    });
    adapter.uploadImage = async (_url, token, bytes) => {
      imageUploads++;
      assert.equal(token, 'private-member-token');
      assert.ok(bytes.length > 0);
      if (failUpload) throw new LinkedInPublishError('NETWORK', true);
    };
    adapter.imageReady = async () => undefined;
    adapter.publish = async (author, token, text, image) => {
      publishCalls++;
      assert.ok(author.startsWith('urn:li:person:member'));
      assert.equal(token, 'private-member-token');
      assert.ok(text.startsWith('Saved'));
      if (image) assert.equal(image, 'urn:li:image:mockasset123');
      if (failPost) throw new LinkedInPublishError('TIMEOUT', true);
      return `urn:li:share:${1000 + publishCalls}`;
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
      const email = `li-${prefix}-${index}@example.test`;
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
      assert.equal(
        (
          await call(
            '/organizations',
            'POST',
            { name: `LI Org ${prefix} ${index}` },
            cookie,
          )
        ).status,
        201,
      );
      const brand = await call(
        '/brands',
        'POST',
        { name: `LI Brand ${index}` },
        cookie,
      );
      assert.equal(brand.status, 201);
      const brandId = ((await brand.json()) as { brand: { id: string } }).brand
        .id;
      const content = await call(
        '/contents',
        'POST',
        { brandId, title: 'Saved title', body: `Saved LinkedIn text ${index}` },
        cookie,
      );
      assert.equal(content.status, 201);
      const contentId = ((await content.json()) as { content: { id: string } })
        .content.id;
      const account = await db.socialAccount.create({
        data: {
          grantId: randomUUID(),
          brandId,
          platform: 'LINKEDIN',
          externalId: `member${index}${prefix.slice(0, 8)}`,
          displayName: `Test member ${index}`,
          accountType: 'MEMBER',
          status: 'CONNECTED',
          scopes: ['openid', 'profile', 'w_member_social'],
          credentialsEncrypted: encryptSocial({
            accessToken: 'private-member-token',
          }),
        },
      });
      return { cookie, brandId, contentId, accountId: account.id };
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const a = await owner(1),
        b = await owner(2);
      const path = `/contents/${a.contentId}/linkedin-publications`;
      const prepare = (cookie: string, extra: Record<string, unknown> = {}) =>
        call(
          path,
          'POST',
          { socialAccountId: a.accountId, requestId: randomUUID(), ...extra },
          cookie,
        );
      await t.test(
        'auth, Origin, ownership, input and permissions',
        async () => {
          assert.equal((await call(path)).status, 401);
          assert.equal((await prepare('')).status, 401);
          assert.equal(
            (
              await call(
                path,
                'POST',
                { socialAccountId: a.accountId, requestId: randomUUID() },
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
            (await prepare(a.cookie, { ownerUserId: randomUUID() })).status,
            400,
          );
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { scopes: ['openid', 'profile'] },
          });
          assert.equal((await prepare(a.cookie)).status, 409);
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { scopes: ['openid', 'profile', 'w_member_social'] },
          });
          const readiness = await call(
            `${path}/readiness`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.equal(readiness.status, 200);
          assert.equal(
            ((await readiness.json()) as { members: { eligible: boolean }[] })
              .members[0]?.eligible,
            true,
          );
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { accessExpiresAt: new Date(Date.now() - 60_000) },
          });
          assert.equal((await prepare(a.cookie)).status, 409);
          await db.socialAccount.update({
            where: { id: a.accountId },
            data: { accessExpiresAt: null },
          });
          assert.equal(
            (
              await call(
                '/linkedin-publications/not-a-uuid',
                'GET',
                undefined,
                a.cookie,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await call(
                `/linkedin-publications/${randomUUID()}`,
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
                { socialAccountId: 'bad', requestId: randomUUID() },
                a.cookie,
              )
            ).status,
            400,
          );
          for (const body of ['', 'x'.repeat(2_801)]) {
            assert.equal(
              (
                await call(
                  `/contents/${a.contentId}`,
                  'PATCH',
                  { body },
                  a.cookie,
                )
              ).status,
              200,
            );
            assert.equal((await prepare(a.cookie)).status, 400);
          }
          assert.equal(
            (
              await call(
                `/contents/${a.contentId}`,
                'PATCH',
                { body: 'Saved LinkedIn text 1' },
                a.cookie,
              )
            ).status,
            200,
          );
        },
      );
      await t.test(
        'text snapshot, explicit send, duplicate and concurrent confirmation',
        async () => {
          const requestId = randomUUID();
          const first = await call(
            path,
            'POST',
            { socialAccountId: a.accountId, requestId },
            a.cookie,
          );
          assert.equal(first.status, 201);
          const item = ((await first.json()) as { publication: Publication })
            .publication;
          assert.equal(item.textSnapshot, 'Saved LinkedIn text 1');
          assert.equal(publishCalls, 0);
          const duplicate = await call(
            path,
            'POST',
            { socialAccountId: a.accountId, requestId },
            a.cookie,
          );
          assert.equal(
            ((await duplicate.json()) as { publication: Publication })
              .publication.id,
            item.id,
          );
          const [one, two] = await Promise.all([
            call(
              `/linkedin-publications/${item.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
            call(
              `/linkedin-publications/${item.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
          ]);
          assert.equal(one.status, 201);
          assert.equal(two.status, 201);
          assert.equal(publishCalls, 1);
          assert.equal(
            (await db.publication.findUniqueOrThrow({ where: { id: item.id } }))
              .status,
            'PUBLISHED',
          );
          assert.equal(
            (
              await call(
                `/linkedin-publications/${item.id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(publishCalls, 1);
          assert.equal(
            (
              await call(
                `/linkedin-publications/${item.id}`,
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
        'stale saved draft blocks before provider write',
        async () => {
          const result = await prepare(a.cookie);
          const item = ((await result.json()) as { publication: Publication })
            .publication;
          assert.equal(
            (
              await call(
                `/contents/${a.contentId}`,
                'PATCH',
                { body: 'Saved edited copy' },
                a.cookie,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                `/linkedin-publications/${item.id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(publishCalls, 1);
        },
      );
      await t.test(
        'same-brand PNG upload, immutable source digest and one post',
        async () => {
          const bytes = await sharp({
            create: { width: 4, height: 4, channels: 3, background: '#66aa88' },
          })
            .png()
            .toBuffer();
          const storage = app.get(LocalMediaStorage);
          const storageKey = randomUUID();
          await storage.stage(storageKey, Readable.from([bytes]));
          await storage.publish(storageKey);
          const asset = await db.mediaAsset.create({
            data: {
              brandId: a.brandId,
              originalFilename: 'image.png',
              storageKey,
              mimeType: 'image/png',
              sizeBytes: bytes.length,
              width: 4,
              height: 4,
            },
          });
          const foreign = await db.mediaAsset.create({
            data: {
              brandId: b.brandId,
              originalFilename: 'other.png',
              storageKey: randomUUID(),
              mimeType: 'image/png',
              sizeBytes: bytes.length,
              width: 4,
              height: 4,
            },
          });
          assert.equal(
            (await prepare(a.cookie, { mediaAssetId: foreign.id })).status,
            404,
          );
          const result = await prepare(a.cookie, { mediaAssetId: asset.id });
          assert.equal(result.status, 201);
          const item = ((await result.json()) as { publication: Publication })
            .publication;
          assert.equal(
            (await db.publication.findUniqueOrThrow({ where: { id: item.id } }))
              .mediaSha256,
            createHash('sha256').update(bytes).digest('hex'),
          );
          assert.equal(
            (
              await call(
                `/linkedin-publications/${item.id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          const stored = await db.publication.findUniqueOrThrow({
            where: { id: item.id },
          });
          assert.equal(stored.providerImageUrn, 'urn:li:image:mockasset123');
          assert.equal(stored.imageUploadStage, 'AVAILABLE');
          assert.equal(stored.status, 'PUBLISHED');
          assert.equal(imageUploads, 1);
          assert.equal(publishCalls, 2);
          assert.equal(
            (await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }))
              .storageKey,
            storageKey,
          );
          failUpload = true;
          const failed = (
            (await (
              await prepare(a.cookie, { mediaAssetId: asset.id })
            ).json()) as { publication: Publication }
          ).publication;
          await call(
            `/linkedin-publications/${failed.id}/confirm`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(
            (
              await db.publication.findUniqueOrThrow({
                where: { id: failed.id },
              })
            ).status,
            'UNCERTAIN',
          );
          assert.equal(publishCalls, 2);
          failUpload = false;
          failPost = true;
          const uncertain = (
            (await (await prepare(a.cookie)).json()) as {
              publication: Publication;
            }
          ).publication;
          await call(
            `/linkedin-publications/${uncertain.id}/confirm`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(
            (
              await db.publication.findUniqueOrThrow({
                where: { id: uncertain.id },
              })
            ).status,
            'UNCERTAIN',
          );
          assert.equal(publishCalls, 3);
          await call(
            `/linkedin-publications/${uncertain.id}/confirm`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(publishCalls, 3);
          assert.equal((await prepare(a.cookie)).status, 409);
          await assert.rejects(
            reconcileLinkedInPublication(db, {
              id: uncertain.id,
              outcome: 'FAILED',
              evidence: '',
              operator: 'test',
            }),
          );
          const audit = await reconcileLinkedInPublication(db, {
            id: uncertain.id,
            outcome: 'FAILED',
            evidence: 'mock member feed confirms no post',
            operator: 'test-operator',
          });
          assert.ok(/^[0-9a-f-]{36}$/.test(audit));
          assert.equal(
            (
              await db.publication.findUniqueOrThrow({
                where: { id: uncertain.id },
              })
            ).status,
            'FAILED',
          );
          const history = await call(path, 'GET', undefined, a.cookie);
          assert.equal(history.status, 200);
          assert.ok(
            ((await history.json()) as { publications: Publication[] })
              .publications.length >= 4,
          );
          const facebookHistory = await call(
            `/contents/${a.contentId}/facebook-publications`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.deepEqual(await facebookHistory.json(), { publications: [] });
          assert.equal(
            (
              await call(
                `/facebook-publications/${uncertain.id}`,
                'GET',
                undefined,
                a.cookie,
              )
            ).status,
            404,
          );
        },
      );
    } finally {
      adapter.readiness = original.readiness;
      adapter.initializeImage = original.initialize;
      adapter.uploadImage = original.upload;
      adapter.imageReady = original.imageReady;
      adapter.publish = original.publish;
      await app.close();
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      for (const [key, value] of Object.entries({
        MEDIA_STORAGE_ROOT: previous.root,
        LINKEDIN_CLIENT_ID: previous.client,
        LINKEDIN_CLIENT_SECRET: previous.secret,
        SOCIAL_TOKEN_KEYS_JSON: previous.keys,
        SOCIAL_TOKEN_ACTIVE_KEY_ID: previous.active,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
