import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { createDatabase } from '@synvaro/database';
import { createApp } from '../app.js';
import { loadAuthConfig } from '../auth/auth.config.js';
import { hashOptions } from '../auth/auth.service.js';
import { totp } from '../auth/mfa-crypto.js';
import { tokenHash } from '../auth/auth-security.js';

test(
  'AUTH-MFA-001: real PostgreSQL setup, challenge, recovery and isolation',
  { timeout: 30_000 },
  async () => {
    const oldRequired = process.env.MFA_REQUIRED;
    const oldKey = process.env.AUTH_TOTP_KEY;
    process.env.MFA_REQUIRED = 'true';
    process.env.AUTH_TOTP_KEY = randomBytes(32).toString('base64');
    const config = loadAuthConfig();
    assert.ok(new URL(config.databaseUrl).pathname.endsWith('_test'));
    const db = createDatabase(config.databaseUrl);
    const email = `mfa-${randomUUID()}@example.test`;
    const password = `Test-only-${randomUUID()}`;
    const user = await db.user.create({
      data: { email, passwordHash: await argon2.hash(password, hashOptions) },
    });
    const app = await createApp();
    let base = '';
    async function request(path: string, body?: object, cookie?: string) {
      return fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body
            ? { origin: config.origin, 'content-type': 'application/json' }
            : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    const cookieOf = (response: Response) =>
      (response.headers.get('set-cookie') ?? '').split(';')[0]!;
    try {
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const login = await request('/auth/login', { email, password });
      assert.equal(login.status, 200);
      assert.deepEqual(await login.json(), {
        mfaRequired: true,
        setupRequired: true,
      });
      const pending = cookieOf(login);
      assert.ok(pending.includes('='));
      assert.equal((await request('/auth/me', undefined, pending)).status, 401);
      assert.equal(
        (await request('/organizations/me', undefined, pending)).status,
        401,
      );
      assert.equal(
        (await request('/auth/mfa/status', undefined, pending)).status,
        200,
      );
      const setup = await request('/auth/mfa/setup', {}, pending);
      assert.equal(setup.status, 201);
      const data = (await setup.json()) as {
        secret: string;
        provisioningUri: string;
      };
      assert.ok(data.provisioningUri.startsWith('otpauth://totp/'));
      const storedPending = await db.session.findUniqueOrThrow({
        where: { tokenHash: tokenHash(pending.split('=')[1]!) },
      });
      assert.ok(
        storedPending.pendingMfaSecret &&
          !storedPending.pendingMfaSecret.includes(data.secret),
      );
      assert.equal(
        (
          await request(
            '/auth/mfa/activate',
            { code: 'ffffffffffffffffffffffffffffffff' },
            pending,
          )
        ).status,
        401,
      );
      const activated = await request(
        '/auth/mfa/activate',
        { code: totp(data.secret, email).generate() },
        pending,
      );
      assert.equal(activated.status, 201);
      const { recoveryCodes } = (await activated.json()) as {
        recoveryCodes: string[];
      };
      assert.equal(recoveryCodes.length, 8);
      const full = cookieOf(activated);
      assert.notEqual(full, pending);
      assert.equal((await request('/auth/me', undefined, pending)).status, 401);
      assert.equal((await request('/auth/me', undefined, full)).status, 200);
      const credential = await db.userMfa.findUniqueOrThrow({
        where: { userId: user.id },
      });
      assert.ok(!credential.secretEncrypted.includes(data.secret));
      assert.equal(
        await db.mfaRecoveryCode.count({ where: { userId: user.id } }),
        8,
      );
      const loginAgain = await request('/auth/login', { email, password });
      assert.deepEqual(await loginAgain.json(), {
        mfaRequired: true,
        setupRequired: false,
      });
      const pending2 = cookieOf(loginAgain);
      assert.equal(
        (
          await request(
            '/auth/mfa/verify',
            { code: totp(data.secret, email).generate() },
            pending2,
          )
        ).status,
        401,
        'enrollment timestep cannot be replayed',
      );
      const recovered = await request(
        '/auth/mfa/verify',
        { code: recoveryCodes[0] },
        pending2,
      );
      assert.equal(recovered.status, 201);
      assert.equal(
        (await request('/auth/me', undefined, cookieOf(recovered))).status,
        200,
      );
      const loginThird = await request('/auth/login', { email, password });
      const pending3 = cookieOf(loginThird);
      assert.equal(
        (
          await request(
            '/auth/mfa/verify',
            { code: recoveryCodes[0] },
            pending3,
          )
        ).status,
        401,
      );
      assert.equal(
        await db.mfaRecoveryCode.count({ where: { userId: user.id } }),
        7,
      );
      await db.session.updateMany({
        where: { userId: user.id, stage: 'PENDING_MFA' },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      assert.equal(
        (await request('/auth/mfa/status', undefined, pending3)).status,
        401,
      );
      const pending4 = cookieOf(
        await request('/auth/login', { email, password }),
      );
      const pending5 = cookieOf(
        await request('/auth/login', { email, password }),
      );
      const concurrent = await Promise.all([
        request('/auth/mfa/verify', { code: recoveryCodes[1] }, pending4),
        request('/auth/mfa/verify', { code: recoveryCodes[1] }, pending5),
      ]);
      assert.deepEqual(
        concurrent.map((response) => response.status).sort(),
        [201, 401],
      );
      assert.equal(
        await db.mfaRecoveryCode.count({ where: { userId: user.id } }),
        6,
      );
      const failedPending = concurrent[0]!.status === 401 ? pending4 : pending5;
      for (let attempt = 0; attempt < 4; attempt++)
        assert.equal(
          (
            await request(
              '/auth/mfa/verify',
              { code: 'ffffffffffffffffffffffffffffffff' },
              failedPending,
            )
          ).status,
          401,
        );
      assert.equal(
        (
          await request(
            '/auth/mfa/verify',
            { code: recoveryCodes[2] },
            failedPending,
          )
        ).status,
        403,
        'five failed attempts block even a correct recovery code on that session',
      );
      assert.equal(
        await db.mfaRecoveryCode.count({ where: { userId: user.id } }),
        6,
      );
      assert.equal(
        (
          await fetch(base + '/auth/mfa/verify', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              cookie: failedPending,
            },
            body: JSON.stringify({ code: recoveryCodes[2] }),
          })
        ).status,
        403,
        'missing Origin is rejected before authentication',
      );
    } finally {
      await app.close();
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
      if (oldRequired === undefined) delete process.env.MFA_REQUIRED;
      else process.env.MFA_REQUIRED = oldRequired;
      if (oldKey === undefined) delete process.env.AUTH_TOTP_KEY;
      else process.env.AUTH_TOTP_KEY = oldKey;
    }
  },
);
