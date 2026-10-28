import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { encryptSocial } from '../social/crypto.js';
import {
  FacebookPublisher,
  FacebookPublishError,
} from '../social/facebook-publisher.js';
import { reconcileFacebookPublication } from '../publication/reconciliation.js';

test(
  'SYN-SOC-002: Facebook Page publishing through Nest and real PostgreSQL',
  { timeout: 90_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({
      test: randomBytes(32).toString('base64'),
    });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'test';
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const publisher = app.get(FacebookPublisher);
    const originalReady = publisher.readiness.bind(publisher);
    const originalPublish = publisher.publish.bind(publisher);
    publisher.readiness = async () => ({ eligible: true, reason: null });
    let posts = 0;
    publisher.publish = async (_id, token, text) => {
      posts++;
      assert.equal(token, 'private-page-token');
      assert.ok(text.startsWith('Saved'));
      return `12345_${1000 + posts}`;
    };
    let base = '';
    const prefix = randomUUID();
    async function call(
      path: string,
      method = 'GET',
      body?: unknown,
      cookie = '',
      origin = config.origin,
    ) {
      return fetch(base + path, {
        method,
        headers: { origin, 'content-type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function owner(index: number) {
      const email = `publish-${prefix}-${index}@example.test`;
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
            { name: `Publish Org ${prefix} ${index}` },
            cookie,
          )
        ).status,
        201,
      );
      const brand = await call(
        '/brands',
        'POST',
        { name: `Brand ${index}` },
        cookie,
      );
      assert.equal(brand.status, 201);
      const brandId = ((await brand.json()) as { brand: { id: string } }).brand
        .id;
      const draft = await call(
        '/contents',
        'POST',
        {
          brandId,
          title: 'Review title',
          body: `Saved Facebook text ${index}`,
        },
        cookie,
      );
      assert.equal(draft.status, 201);
      const contentId = ((await draft.json()) as { content: { id: string } })
        .content.id;
      const account = await db.socialAccount.create({
        data: {
          grantId: randomUUID(),
          brandId,
          platform: 'FACEBOOK',
          externalId: `${BigInt(`0x${prefix.replaceAll('-', '').slice(0, 15)}`)}${index}`,
          displayName: `Controlled Page ${index}`,
          accountType: 'PAGE',
          status: 'CONNECTED',
          scopes: ['pages_manage_posts'],
          credentialsEncrypted: encryptSocial({
            accessToken: 'private-page-token',
            userToken: 'private-user-token',
          }),
        },
      });
      return {
        cookie,
        userId: user.id,
        brandId,
        contentId,
        accountId: account.id,
      };
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const a = await owner(1);
      const b = await owner(2);
      const path = `/contents/${a.contentId}/facebook-publications`;
      await t.test('auth, Origin, brand and Page isolation', async () => {
        assert.equal((await call(`${path}/readiness`)).status, 401);
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
        assert.equal(
          (
            await call(
              `/contents/${b.contentId}/facebook-publications/readiness`,
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
              { socialAccountId: b.accountId, requestId: randomUUID() },
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
                requestId: randomUUID(),
                ownerUserId: b.userId,
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
          ((await ready.json()) as { pages: unknown[] }).pages.length,
          1,
        );
      });
      await t.test(
        'permission failure rejects before durable intent and external send',
        async () => {
          publisher.readiness = async () => ({
            eligible: false,
            reason: 'PUBLISH_PERMISSION_MISSING',
          });
          assert.equal(
            (
              await call(
                path,
                'POST',
                { socialAccountId: a.accountId, requestId: randomUUID() },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(posts, 0);
          publisher.readiness = async () => ({ eligible: true, reason: null });
        },
      );
      const requestId = randomUUID();
      const prepared = await call(
        path,
        'POST',
        { socialAccountId: a.accountId, requestId },
        a.cookie,
      );
      assert.equal(prepared.status, 201);
      const publication = (
        (await prepared.json()) as {
          publication: { id: string; status: string; textSnapshot: string };
        }
      ).publication;
      assert.equal(publication.status, 'READY');
      assert.equal(publication.textSnapshot, 'Saved Facebook text 1');
      assert.equal(posts, 0);
      await t.test(
        'idempotent prepare, explicit confirm, concurrent double click and history',
        async () => {
          const repeat = await call(
            path,
            'POST',
            { socialAccountId: a.accountId, requestId },
            a.cookie,
          );
          assert.equal(repeat.status, 201);
          assert.equal(
            ((await repeat.json()) as { publication: { id: string } })
              .publication.id,
            publication.id,
          );
          const [first, second] = await Promise.all([
            call(
              `/facebook-publications/${publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
            call(
              `/facebook-publications/${publication.id}/confirm`,
              'POST',
              { confirm: true },
              a.cookie,
            ),
          ]);
          assert.equal(first.status, 201);
          assert.equal(second.status, 201);
          assert.equal(posts, 1);
          const result = await call(
            `/facebook-publications/${publication.id}`,
            'GET',
            undefined,
            a.cookie,
          );
          assert.equal(
            (
              (await result.json()) as {
                publication: { status: string; providerPostId: string };
              }
            ).publication.status,
            'PUBLISHED',
          );
          assert.equal(
            (
              await call(
                `/facebook-publications/${publication.id}`,
                'GET',
                undefined,
                b.cookie,
              )
            ).status,
            404,
          );
          const history = await call(path, 'GET', undefined, a.cookie);
          assert.equal(
            ((await history.json()) as { publications: unknown[] }).publications
              .length,
            1,
          );
        },
      );
      await t.test(
        'stale draft rejects confirmation and preserves immutable snapshot',
        async () => {
          const p = await call(
            path,
            'POST',
            { socialAccountId: a.accountId, requestId: randomUUID() },
            a.cookie,
          );
          const id = ((await p.json()) as { publication: { id: string } })
            .publication.id;
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
                `/facebook-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            409,
          );
          assert.equal(posts, 1);
          const stored = await db.publication.findUniqueOrThrow({
            where: { id },
          });
          assert.equal(stored.textSnapshot, 'Saved Facebook text 1');
        },
      );
      let uncertainId = '';
      await t.test(
        'uncertain timeout is durable and never retried',
        async () => {
          publisher.publish = async () => {
            posts++;
            throw new FacebookPublishError('TIMEOUT', true);
          };
          const p = await call(
            path,
            'POST',
            { socialAccountId: a.accountId, requestId: randomUUID() },
            a.cookie,
          );
          const id = ((await p.json()) as { publication: { id: string } })
            .publication.id;
          uncertainId = id;
          const result = await call(
            `/facebook-publications/${id}/confirm`,
            'POST',
            { confirm: true },
            a.cookie,
          );
          assert.equal(
            ((await result.json()) as { publication: { status: string } })
              .publication.status,
            'UNCERTAIN',
          );
          assert.equal(
            (
              await call(
                `/facebook-publications/${id}/confirm`,
                'POST',
                { confirm: true },
                a.cookie,
              )
            ).status,
            201,
          );
          assert.equal(posts, 2);
          assert.equal(
            (
              await call(
                path,
                'POST',
                { socialAccountId: a.accountId, requestId: randomUUID() },
                a.cookie,
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        'operator reconciliation requires evidence and is one-time',
        async () => {
          await assert.rejects(
            reconcileFacebookPublication(db, {
              id: uncertainId,
              outcome: 'FAILED',
              evidence: '',
              operator: 'test',
              providerPostId: undefined,
            }),
          );
          const audit = await reconcileFacebookPublication(db, {
            id: uncertainId,
            outcome: 'FAILED',
            evidence: 'Controlled Page activity checked: no post',
            operator: 'integration-test',
          });
          assert.ok(audit);
          assert.equal(
            (
              await db.publication.findUniqueOrThrow({
                where: { id: uncertainId },
              })
            ).status,
            'FAILED',
          );
          await assert.rejects(
            reconcileFacebookPublication(db, {
              id: uncertainId,
              outcome: 'FAILED',
              evidence: 'again',
              operator: 'integration-test',
            }),
          );
        },
      );
      await t.test('disconnect cannot race an active send', async () => {
        const draft = await db.content.findUniqueOrThrow({
          where: { id: a.contentId },
        });
        const pending = await db.publication.create({
          data: {
            userId: a.userId,
            contentId: a.contentId,
            brandId: a.brandId,
            socialAccountId: a.accountId,
            requestId: randomUUID(),
            pageId: '12345',
            pageName: 'Controlled Page',
            textSnapshot: draft.body,
            draftUpdatedAt: draft.updatedAt,
            status: 'PUBLISHING',
            confirmedAt: new Date(),
          },
        });
        assert.equal(
          (
            await call(
              `/social/accounts/${a.accountId}`,
              'DELETE',
              {},
              a.cookie,
            )
          ).status,
          409,
        );
        await db.publication.update({
          where: { id: pending.id },
          data: { status: 'UNCERTAIN', errorCode: 'INTERRUPTED' },
        });
        await reconcileFacebookPublication(db, {
          id: pending.id,
          outcome: 'FAILED',
          evidence: 'Synthetic test never sent a request',
          operator: 'integration-test',
        });
      });
      await t.test(
        'disconnect retains history and removes encrypted active token',
        async () => {
          const response = await call(
            `/social/accounts/${a.accountId}`,
            'DELETE',
            {},
            a.cookie,
          );
          assert.equal(response.status, 200);
          const account = await db.socialAccount.findUniqueOrThrow({
            where: { id: a.accountId },
          });
          assert.equal(account.status, 'DISCONNECTED');
          assert.ok(
            !account.credentialsEncrypted.includes('private-page-token'),
          );
          assert.equal(
            await db.publication.count({
              where: { socialAccountId: a.accountId },
            }),
            4,
          );
        },
      );
    } finally {
      publisher.readiness = originalReady;
      publisher.publish = originalPublish;
      await app.close();
      await db.$disconnect();
    }
  },
);
