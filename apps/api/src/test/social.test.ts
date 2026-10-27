import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import {
  SocialProviderError,
  SocialProviders,
  type DiscoveredAccount,
} from '../social/providers.js';
import { decryptSocial } from '../social/crypto.js';

test(
  'SYN-SOC-001: OAuth session binding, encrypted persistence and ownership on real PostgreSQL',
  { timeout: 60_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    process.env.SOCIAL_TOKEN_KEYS_JSON = JSON.stringify({
      test: randomBytes(32).toString('base64'),
    });
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = 'test';
    process.env.META_APP_ID = 'test-meta';
    process.env.META_APP_SECRET = 'test-meta-secret';
    process.env.LINKEDIN_CLIENT_ID = 'test-linkedin';
    process.env.LINKEDIN_CLIENT_SECRET = 'test-linkedin-secret';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-secret';
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const provider = app.get(SocialProviders);
    const originalComplete = provider.complete.bind(provider);
    const originalRevoke = provider.revoke.bind(provider);
    const originalRefreshGoogle = provider.refreshGoogle.bind(provider);
    const calls: string[] = [];
    const revoked: string[] = [];
    provider.complete = async (name, platform) => {
      calls.push(`${name}:${platform}`);
      const id =
        platform === 'YOUTUBE'
          ? 'channel-test'
          : platform === 'LINKEDIN'
            ? 'member-test'
            : platform === 'INSTAGRAM'
              ? 'ig-test'
              : 'page-test';
      return [
        {
          platform,
          externalId: id,
          displayName: `Test ${platform}`,
          accountType:
            platform === 'YOUTUBE'
              ? 'CHANNEL'
              : platform === 'LINKEDIN'
                ? 'MEMBER'
                : platform === 'INSTAGRAM'
                  ? 'PROFESSIONAL'
                  : 'PAGE',
          scopes: ['read'],
          accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          refreshExpiresAt: null,
          credential: {
            accessToken: `secret-${id}`,
            ...(platform === 'YOUTUBE'
              ? { refreshToken: 'refresh-secret' }
              : {}),
          },
        } satisfies DiscoveredAccount,
      ];
    };
    provider.revoke = async (name, credential) => {
      revoked.push(`${name}:${credential.accessToken}`);
    };
    provider.refreshGoogle = async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-secret');
      return {
        accessToken: 'renewed-channel-token',
        accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    };
    let base = '';
    const prefix = randomUUID();
    const password = `Test-${randomUUID()}`;
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
      const email = `social-${prefix}-${index}@example.test`;
      assert.equal(
        (await call('/auth/register', 'POST', { email, password })).status,
        201,
      );
      const login = await call('/auth/login', 'POST', { email, password });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const org = await call(
        '/organizations',
        'POST',
        { name: `Social ${prefix} ${index}` },
        cookie,
      );
      assert.equal(org.status, 201);
      const brand = await call(
        '/brands',
        'POST',
        { name: `Brand ${index}` },
        cookie,
      );
      assert.equal(brand.status, 201);
      return {
        cookie,
        brandId: ((await brand.json()) as { brand: { id: string } }).brand.id,
      };
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const a = await owner(1);
      const b = await owner(2);
      await t.test(
        'catalog truth, authentication, Origin and foreign brand',
        async () => {
          const catalog = await call(
            '/social/providers',
            'GET',
            undefined,
            a.cookie,
          );
          assert.equal(catalog.status, 200);
          assert.equal(
            ((await catalog.json()) as { providers: unknown[] }).providers
              .length,
            4,
          );
          assert.equal((await call('/social/providers')).status, 401);
          assert.equal(
            (
              await call(`/brands/${a.brandId}/social/oauth`, 'POST', {
                platform: 'FACEBOOK',
              })
            ).status,
            401,
          );
          assert.equal(
            (
              await call(
                `/brands/${a.brandId}/social/oauth`,
                'POST',
                { platform: 'FACEBOOK' },
                a.cookie,
                'https://evil.example',
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await call(
                `/brands/${a.brandId}/social/oauth`,
                'POST',
                { platform: 'FACEBOOK' },
                b.cookie,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await call(
                `/brands/${a.brandId}/social/oauth`,
                'POST',
                { platform: 'BAD' },
                a.cookie,
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        'missing app configuration is safe and consent denial or expiry cannot associate',
        async () => {
          const saved = process.env.META_APP_ID;
          delete process.env.META_APP_ID;
          try {
            const catalog = (await (
              await call('/social/providers', 'GET', undefined, a.cookie)
            ).json()) as {
              providers: Array<{ platform: string; status: string }>;
            };
            assert.equal(
              catalog.providers.find((entry) => entry.platform === 'FACEBOOK')
                ?.status,
              'NOT_CONFIGURED',
            );
            assert.equal(
              (
                await call(
                  `/brands/${a.brandId}/social/oauth`,
                  'POST',
                  { platform: 'FACEBOOK' },
                  a.cookie,
                )
              ).status,
              503,
            );
          } finally {
            process.env.META_APP_ID = saved;
          }
          const started = await call(
            `/brands/${a.brandId}/social/oauth`,
            'POST',
            { platform: 'FACEBOOK' },
            a.cookie,
          );
          const state = new URL(
            ((await started.json()) as { authorizationUrl: string })
              .authorizationUrl,
          ).searchParams.get('state')!;
          const denied = await call('/social/oauth/meta/callback', 'POST', {
            state,
            error: 'access_denied',
          });
          assert.equal(denied.status, 201);
          const attemptId = ((await denied.json()) as { attemptId: string })
            .attemptId;
          const discovery = (await (
            await call(
              `/social/oauth/attempts/${attemptId}`,
              'GET',
              undefined,
              a.cookie,
            )
          ).json()) as { status: string; accounts: unknown[] };
          assert.equal(discovery.status, 'FAILED');
          assert.deepEqual(discovery.accounts, []);
          assert.equal(
            (
              await call('/social/oauth/meta/callback', 'POST', {
                state,
                code: 'late',
              })
            ).status,
            400,
          );
          const another = await call(
            `/brands/${a.brandId}/social/oauth`,
            'POST',
            { platform: 'FACEBOOK' },
            a.cookie,
          );
          const expiredState = new URL(
            ((await another.json()) as { authorizationUrl: string })
              .authorizationUrl,
          ).searchParams.get('state')!;
          const { createHash } = await import('node:crypto');
          await db.socialOauthAttempt.update({
            where: {
              stateHash: createHash('sha256')
                .update(expiredState)
                .digest('hex'),
            },
            data: { expiresAt: new Date(Date.now() - 1_000) },
          });
          assert.equal(
            (
              await call('/social/oauth/meta/callback', 'POST', {
                state: expiredState,
                code: 'late',
              })
            ).status,
            400,
          );
        },
      );
      for (const platform of [
        'FACEBOOK',
        'INSTAGRAM',
        'LINKEDIN',
        'YOUTUBE',
      ] as const) {
        await t.test(
          `${platform}: one-time state, session-bound discovery and encrypted association`,
          async () => {
            const started = await call(
              `/brands/${a.brandId}/social/oauth`,
              'POST',
              { platform },
              a.cookie,
            );
            assert.equal(started.status, 201);
            const { authorizationUrl } = (await started.json()) as {
              authorizationUrl: string;
            };
            const url = new URL(authorizationUrl);
            const state = url.searchParams.get('state')!;
            assert.match(state, /^[A-Za-z0-9_-]{43}$/);
            assert.equal(
              url.searchParams.get('redirect_uri'),
              `${config.origin}/api/social/oauth/${platform === 'FACEBOOK' || platform === 'INSTAGRAM' ? 'meta' : platform === 'YOUTUBE' ? 'google' : 'linkedin'}/callback`,
            );
            assert.equal(
              url.searchParams.get('scope'),
              platform === 'FACEBOOK'
                ? 'pages_show_list'
                : platform === 'INSTAGRAM'
                  ? 'pages_show_list pages_read_engagement instagram_basic'
                  : platform === 'LINKEDIN'
                    ? 'openid profile'
                    : 'https://www.googleapis.com/auth/youtube.readonly',
            );
            if (platform === 'YOUTUBE')
              assert.equal(
                url.searchParams.get('code_challenge_method'),
                'S256',
              );
            const providerName =
              platform === 'FACEBOOK' || platform === 'INSTAGRAM'
                ? 'meta'
                : platform === 'YOUTUBE'
                  ? 'google'
                  : 'linkedin';
            const callback = await call(
              `/social/oauth/${providerName}/callback`,
              'POST',
              { state, code: 'test-code' },
            );
            assert.equal(callback.status, 201);
            const { attemptId } = (await callback.json()) as {
              attemptId: string;
            };
            assert.equal(
              (
                await call(`/social/oauth/${providerName}/callback`, 'POST', {
                  state,
                  code: 'test-code',
                })
              ).status,
              400,
            );
            assert.equal(
              (
                await call(
                  `/social/oauth/attempts/${attemptId}`,
                  'GET',
                  undefined,
                  b.cookie,
                )
              ).status,
              404,
            );
            const discovered = await call(
              `/social/oauth/attempts/${attemptId}`,
              'GET',
              undefined,
              a.cookie,
            );
            assert.equal(discovered.status, 200);
            const discovery = (await discovered.json()) as {
              status: string;
              accounts: Array<{ externalId: string }>;
            };
            assert.equal(discovery.status, 'READY');
            assert.equal(discovery.accounts.length, 1);
            assert.ok(!JSON.stringify(discovery).includes('secret-'));
            const storedAttempt = await db.socialOauthAttempt.findUniqueOrThrow(
              { where: { id: attemptId } },
            );
            assert.ok(
              storedAttempt.credentialsEncrypted?.startsWith('v1:test:'),
            );
            assert.ok(
              !JSON.stringify(storedAttempt.discovered).includes('secret-'),
            );
            assert.equal(
              (
                await call(
                  `/social/oauth/attempts/${attemptId}/accounts`,
                  'POST',
                  { externalId: discovery.accounts[0]!.externalId },
                  b.cookie,
                )
              ).status,
              404,
            );
            const connected = await call(
              `/social/oauth/attempts/${attemptId}/accounts`,
              'POST',
              { externalId: discovery.accounts[0]!.externalId },
              a.cookie,
            );
            assert.equal(connected.status, 201);
            const account = (
              (await connected.json()) as { account: { id: string } }
            ).account;
            const row = await db.socialAccount.findUniqueOrThrow({
              where: { id: account.id },
            });
            assert.ok(row.credentialsEncrypted.startsWith('v1:test:'));
            assert.ok(!row.credentialsEncrypted.includes('secret-'));
            assert.equal(
              decryptSocial<{ accessToken: string }>(row.credentialsEncrypted)
                .accessToken,
              `secret-${discovery.accounts[0]!.externalId}`,
            );
            if (platform === 'YOUTUBE') {
              const renewed = await call(
                `/social/accounts/${account.id}/refresh`,
                'POST',
                {},
                a.cookie,
              );
              assert.equal(renewed.status, 201);
              const renewedRow = await db.socialAccount.findUniqueOrThrow({
                where: { id: account.id },
              });
              assert.equal(
                decryptSocial<{ accessToken: string }>(
                  renewedRow.credentialsEncrypted,
                ).accessToken,
                'renewed-channel-token',
              );
              provider.refreshGoogle = async () => {
                throw new SocialProviderError('AUTH', 400);
              };
              assert.equal(
                (
                  await call(
                    `/social/accounts/${account.id}/refresh`,
                    'POST',
                    {},
                    a.cookie,
                  )
                ).status,
                409,
              );
              assert.equal(
                (
                  await db.socialAccount.findUniqueOrThrow({
                    where: { id: account.id },
                  })
                ).status,
                'REAUTH_REQUIRED',
              );
              provider.refreshGoogle = async () => ({
                accessToken: 'renewed-channel-token',
                accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              });
            }
            const reauth = await call(
              `/brands/${a.brandId}/social/oauth`,
              'POST',
              { platform },
              a.cookie,
            );
            const reauthState = new URL(
              ((await reauth.json()) as { authorizationUrl: string })
                .authorizationUrl,
            ).searchParams.get('state')!;
            const reauthCallback = await call(
              `/social/oauth/${providerName}/callback`,
              'POST',
              { state: reauthState, code: 'another-code' },
            );
            const reauthAttempt = (
              (await reauthCallback.json()) as { attemptId: string }
            ).attemptId;
            assert.equal(
              (
                await call(
                  `/social/oauth/attempts/${reauthAttempt}/accounts`,
                  'POST',
                  { externalId: discovery.accounts[0]!.externalId },
                  a.cookie,
                )
              ).status,
              201,
            );
            assert.equal(
              await db.socialAccount.count({
                where: {
                  platform,
                  externalId: discovery.accounts[0]!.externalId,
                },
              }),
              1,
            );
            if (platform === 'FACEBOOK') {
              const foreignStart = await call(
                `/brands/${b.brandId}/social/oauth`,
                'POST',
                { platform },
                b.cookie,
              );
              const foreignState = new URL(
                ((await foreignStart.json()) as { authorizationUrl: string })
                  .authorizationUrl,
              ).searchParams.get('state')!;
              const foreignCallback = await call(
                '/social/oauth/meta/callback',
                'POST',
                { state: foreignState, code: 'foreign-code' },
              );
              const foreignAttemptId = (
                (await foreignCallback.json()) as { attemptId: string }
              ).attemptId;
              assert.equal(
                (
                  await call(
                    `/social/oauth/attempts/${foreignAttemptId}/accounts`,
                    'POST',
                    { externalId: 'page-test' },
                    b.cookie,
                  )
                ).status,
                409,
              );
            }
            assert.equal(
              (
                await call(
                  `/brands/${a.brandId}/social-accounts`,
                  'GET',
                  undefined,
                  b.cookie,
                )
              ).status,
              404,
            );
            const listed = await call(
              `/brands/${a.brandId}/social-accounts`,
              'GET',
              undefined,
              a.cookie,
            );
            assert.equal(listed.status, 200);
            assert.ok(!(await listed.text()).includes('secret-'));
            assert.equal(
              (
                await call(
                  `/social/accounts/${account.id}`,
                  'DELETE',
                  {},
                  b.cookie,
                )
              ).status,
              404,
            );
            assert.equal(
              (
                await call(
                  `/social/accounts/${account.id}`,
                  'DELETE',
                  {},
                  a.cookie,
                )
              ).status,
              200,
            );
            assert.equal(
              await db.socialAccount.count({ where: { id: account.id } }),
              0,
            );
          },
        );
      }
      assert.equal(calls.length, 9);
      assert.equal(revoked.length, 3);
    } finally {
      provider.complete = originalComplete;
      provider.revoke = originalRevoke;
      provider.refreshGoogle = originalRefreshGoogle;
      await app.close();
      await db.$disconnect();
    }
  },
);
