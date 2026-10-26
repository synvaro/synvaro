import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { tokenHash } from '../auth/auth-security.js';
import { loadAuthConfig } from '../auth/auth.config.js';

// Deliberately fails instead of skipping or falling back to mocked persistence.
test(
  'SYN-002A: real PostgreSQL authentication and security boundaries',
  { timeout: 30_000 },
  async (t) => {
    const config = loadAuthConfig();
    assert.ok(
      new URL(config.databaseUrl).pathname.endsWith('_test'),
      'Use a dedicated database ending in _test',
    );
    const db = createDatabase(config.databaseUrl);
    const app = await createApp();
    const logs: string[] = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    app.useLogger({ log: capture, error: capture, warn: capture });
    const prefix = `spike-${randomUUID()}`;
    const email = `${prefix}@example.test`;
    const password = `Test-only-${randomUUID()}`;
    const email2 = `${prefix}-second@example.test`;
    let cookie = '';
    let token = '';
    let base = '';
    async function request(
      path: string,
      body?: unknown,
      options: {
        cookie?: string;
        origin?: string | null;
        site?: string;
        raw?: string;
      } = {},
    ) {
      const headers: Record<string, string> = {};
      if (body !== undefined || options.raw) {
        headers['content-type'] = 'application/json';
        if (options.origin !== null)
          headers.origin = options.origin ?? config.origin;
      }
      if (options.cookie) headers.cookie = options.cookie;
      if (options.site) headers['sec-fetch-site'] = options.site;
      return fetch(base + path, {
        method: body === undefined && !options.raw ? 'GET' : 'POST',
        headers,
        body:
          options.raw ??
          (body === undefined ? undefined : JSON.stringify(body)),
      });
    }
    function readCookie(response: Response) {
      const header = response.headers.get('set-cookie') ?? '';
      assert.ok(
        /HttpOnly/i.test(header) &&
          /SameSite=Strict/i.test(header) &&
          /Path=\//.test(header),
      );
      assert.ok(!/Domain=/i.test(header));
      assert.ok(!config.secure || /; Secure/i.test(header));
      return header.split(';')[0]!;
    }
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      await t.test(
        'A1: registration, normalized unique email and Argon2id storage; duplicates are indistinguishable',
        async () => {
          const response = await request('/auth/register', {
            email: `  ${email.toUpperCase()}  `,
            password,
          });
          assert.equal(response.status, 201);
          const first = await response.text();
          assert.equal(response.headers.get('set-cookie'), null);
          const duplicate = await request('/auth/register', {
            email,
            password: 'Different-test-password',
          });
          assert.equal(duplicate.status, 201);
          assert.equal(await duplicate.text(), first);
          assert.equal(await db.user.count({ where: { email } }), 1);
          const user = await db.user.findUniqueOrThrow({ where: { email } });
          const [, algorithm, version, parameters] =
            user.passwordHash.split('$');
          assert.equal(algorithm, 'argon2id');
          assert.equal(version, 'v=19');
          assert.deepEqual(
            Object.fromEntries(
              parameters!.split(',').map((entry) => entry.split('=')),
            ),
            { m: '19456', t: '2', p: '1' },
          );
          assert.ok(
            user.passwordHash !== password &&
              (await argon2.verify(user.passwordHash, password)),
          );
          assert.ok(
            !first.includes(password) && !first.includes(user.passwordHash),
          );
        },
      );
      await t.test(
        'A2: invalid credentials do not enumerate accounts; protected route denies anonymous access',
        async () => {
          const invalid = await request('/auth/login', {
            email,
            password: 'Incorrect-test-password',
          });
          const missing = await request('/auth/login', {
            email: `${prefix}-missing@example.test`,
            password,
          });
          assert.equal(invalid.status, 401);
          assert.equal(missing.status, 401);
          assert.equal(await invalid.text(), await missing.text());
          assert.equal(invalid.headers.get('set-cookie'), null);
          assert.equal((await request('/auth/me')).status, 401);
          assert.equal(
            (
              await request('/auth/me', undefined, {
                cookie: 'synvaro-session=invalid',
              })
            ).status,
            401,
          );
        },
      );
      await t.test(
        'A3: login creates hashed session; authentication returns only public user fields',
        async () => {
          const response = await request('/auth/login', { email, password });
          assert.equal(response.status, 200);
          cookie = readCookie(response);
          token = cookie.split('=')[1]!;
          assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token));
          const body = await response.text();
          assert.ok(
            !body.includes(token) &&
              !body.includes(password) &&
              !body.includes('Hash'),
          );
          const session = await db.session.findUniqueOrThrow({
            where: { tokenHash: tokenHash(token) },
          });
          assert.ok(
            session.tokenHash !== token &&
              session.expiresAt.getTime() > Date.now(),
          );
          const me = await request('/auth/me', undefined, { cookie });
          assert.equal(me.status, 200);
          assert.equal(me.headers.get('cache-control'), 'no-store');
          const data = (await me.json()) as { user: Record<string, unknown> };
          assert.deepEqual(Object.keys(data.user).sort(), ['email', 'id']);
          assert.equal(data.user.email, email);
        },
      );
      await t.test(
        'A4: successful login rotates presented session; old token cannot be reused',
        async () => {
          const previous = cookie;
          const login = await request(
            '/auth/login',
            { email, password },
            { cookie },
          );
          assert.equal(login.status, 200);
          cookie = readCookie(login);
          token = cookie.split('=')[1]!;
          assert.ok(cookie !== previous);
          assert.equal(
            (await request('/auth/me', undefined, { cookie: previous })).status,
            401,
          );
          assert.equal(
            (await request('/auth/me', undefined, { cookie })).status,
            200,
          );
        },
      );
      await t.test(
        'A5: absolute expiry and database revocation deny access',
        async () => {
          await db.session.update({
            where: { tokenHash: tokenHash(token) },
            data: { expiresAt: new Date(Date.now() - 1) },
          });
          assert.equal(
            (await request('/auth/me', undefined, { cookie })).status,
            401,
          );
          await db.session.update({
            where: { tokenHash: tokenHash(token) },
            data: {
              expiresAt: new Date(Date.now() + 60000),
              revokedAt: new Date(),
            },
          });
          assert.equal(
            (await request('/auth/me', undefined, { cookie })).status,
            401,
          );
        },
      );
      await t.test(
        'A6: logout revokes persisted session, clears cookie and is idempotent',
        async () => {
          assert.equal(
            (await request('/auth/register', { email: email2, password }))
              .status,
            201,
          );
          const login = await request('/auth/login', {
            email: email2,
            password,
          });
          assert.equal(login.status, 200);
          cookie = readCookie(login);
          token = cookie.split('=')[1]!;
          const logout = await request('/auth/logout', {}, { cookie });
          assert.equal(logout.status, 200);
          assert.ok(/Max-Age=0/.test(logout.headers.get('set-cookie') ?? ''));
          assert.ok(
            (
              await db.session.findUniqueOrThrow({
                where: { tokenHash: tokenHash(token) },
              })
            ).revokedAt,
          );
          assert.equal(
            (await request('/auth/me', undefined, { cookie })).status,
            401,
          );
          assert.equal(
            (await request('/auth/logout', {}, { cookie })).status,
            200,
          );
        },
      );
      await t.test(
        'A7: cross-origin, absent/null Origin, and fetch cross-site mutations rejected',
        async () => {
          for (const path of [
            '/auth/register',
            '/auth/login',
            '/auth/logout',
          ]) {
            for (const origin of ['https://evil.example', 'null', null]) {
              assert.equal(
                (
                  await request(
                    path,
                    { email: email2, password },
                    { origin, cookie },
                  )
                ).status,
                403,
              );
            }
            assert.equal(
              (await request(path, {}, { site: 'cross-site' })).status,
              403,
            );
          }
        },
      );
      await t.test(
        'A8: boundary validation and bounded parser reject malformed or excessive input without echoing it',
        async () => {
          for (const body of [
            { email, password: 'short' },
            { email: 'not-email', password },
            { email, password, admin: true },
            { email, password: 'x'.repeat(129) },
          ]) {
            const response = await request('/auth/register', body);
            assert.equal(response.status, 400);
            assert.ok(!(await response.text()).includes(password));
          }
          assert.equal(
            (await request('/auth/login', undefined, { raw: '{invalid' }))
              .status,
            400,
          );
          assert.equal(
            (
              await request('/auth/login', undefined, {
                raw: JSON.stringify({ email, password: 'x'.repeat(10000) }),
              })
            ).status,
            413,
          );
        },
      );
      await t.test(
        'A9: login and registration rate limits cannot be bypassed by switching endpoints',
        async () => {
          const limited = `${prefix}-limited@example.test`;
          for (let i = 0; i < 5; i++)
            assert.equal(
              (await request('/auth/login', { email: limited, password }))
                .status,
              401,
            );
          for (const path of ['/auth/login', '/auth/register']) {
            const response = await request(path, { email: limited, password });
            assert.equal(response.status, 429);
            assert.ok(Number(response.headers.get('retry-after')) > 0);
          }
          // Invalid bodies consume the IP bucket before schema parsing; X-Forwarded-For is not trusted.
          let status = 0;
          for (let i = 0; i < 65 && status !== 429; i++)
            status = (await request('/auth/register', {})).status;
          assert.equal(status, 429);
        },
      );
      await t.test(
        'A12: application logs exclude passwords, session tokens and database credentials',
        () => {
          const output = logs.join('\n');
          assert.ok(
            !output.includes(password) &&
              !output.includes(token) &&
              !output.includes(config.databaseUrl),
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
