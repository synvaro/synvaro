// SYN-002B + SYN-002A-A11: real PostgreSQL + built Next.js proxy + NestJS API, without mocks.
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../packages/database/dist/index.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const children = [];
function start(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  child.on('error', () => {});
  const entry = { child, output: () => output, exited: once(child, 'exit') };
  children.push(entry);
  return entry;
}
async function ready(url, entry) {
  for (let i = 0; i < 120; i++) {
    if (entry.child.exitCode !== null)
      throw new Error(`Process exited: ${entry.output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* Wait for the listening socket. */
    }
    await delay(250);
  }
  throw new Error(`Startup timed out: ${entry.output()}`);
}
const databaseUrl = process.env.DATABASE_URL;
assert.ok(
  databaseUrl && new URL(databaseUrl).pathname.endsWith('_test'),
  'Use a dedicated PostgreSQL database ending in _test',
);
const db = createDatabase(databaseUrl);
const email = `smoke-${randomUUID()}@example.test`;
const password = `Test-only-${randomUUID()}`;
const origin = 'http://127.0.0.1:43100';
async function auth(action, body, cookie = '', requestOrigin = origin) {
  return fetch(`${origin}/api/auth/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
}
try {
  const api = start(['dist/main.js'], 'apps/api', {
    API_PORT: '43101',
    API_HOST: '127.0.0.1',
    NODE_ENV: 'test',
    WEB_ORIGIN: origin,
  });
  const web = start(
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '43100',
    ],
    'apps/web',
    { API_INTERNAL_URL: 'http://127.0.0.1:43101', WEB_ORIGIN: origin },
  );
  const health = await ready('http://127.0.0.1:43101/health', api);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'synvaro-api',
  });
  await ready(`${origin}/login`, web);
  const anonymous = await fetch(`${origin}/brands`, { redirect: 'manual' });
  assert.equal(anonymous.status, 307);
  assert.equal(anonymous.headers.get('location'), '/login');
  assert.equal(
    (await auth('register', { email, password }, '', 'https://evil.example'))
      .status,
    403,
  );
  assert.equal((await auth('register', { email, password })).status, 201);
  const login = await auth('login', { email, password });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie') ?? '';
  assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie));
  const cookie = setCookie.split(';')[0];
  const body = await login.text();
  assert.ok(!body.includes(password) && !body.includes(cookie.split('=')[1]));
  assert.equal((await auth('me', undefined, cookie)).status, 200);
  for (let i = 0; i < 2; i++) {
    const home = await fetch(origin, { headers: { cookie } });
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Create your organization/);
    assert.ok(html.includes(email));
  }
  async function product(path, method = 'GET', data, requestOrigin = origin) {
    return fetch(`${origin}/api${path}`, {
      method,
      headers: {
        cookie,
        origin: requestOrigin,
        'content-type': 'application/json',
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  assert.deepEqual(await (await product('/organizations/me')).json(), {
    organization: null,
  });
  assert.equal(
    (
      await product(
        '/organizations',
        'POST',
        { name: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  const organizationName = `Smoke organization ${randomUUID()}`;
  assert.equal(
    (await product('/organizations', 'POST', { name: organizationName }))
      .status,
    201,
  );
  const created = await product('/brands', 'POST', {
    name: 'First smoke brand',
    description: 'Initial description',
  });
  assert.equal(created.status, 201);
  const { brand } = await created.json();
  assert.equal(
    (await product('/brands', 'POST', { name: 'Second smoke brand' })).status,
    201,
  );
  assert.equal(
    (
      await product(
        `/brands/${brand.id}`,
        'PATCH',
        { name: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await product(`/brands/${brand.id}`, 'PATCH', {
        name: 'Edited smoke brand',
        description: 'Persisted edit',
      })
    ).status,
    200,
  );
  for (let i = 0; i < 2; i++) {
    const page = await fetch(`${origin}/brands`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(
      html.includes(organizationName) &&
        html.includes('Edited smoke brand') &&
        html.includes('Persisted edit') &&
        html.includes('Second smoke brand'),
    );
  }
  const persisted = await (await product('/brands')).json();
  assert.equal(persisted.brands.length, 2);
  assert.equal(
    persisted.brands.find((item) => item.id === brand.id).description,
    'Persisted edit',
  );
  // BRP-001-A1/A3/A8: profile through the actual Next proxy and refreshed SSR.
  const profilePath = `/brands/${brand.id}/profile`;
  assert.deepEqual(await (await product(profilePath)).json(), {
    profile: null,
  });
  assert.equal(
    (
      await product(
        profilePath,
        'PUT',
        { description: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  const detail = '文'.repeat(3000);
  assert.equal(
    (
      await product(profilePath, 'PUT', {
        description: detail,
        targetAudience: 'Local business owners',
        toneOfVoice: 'Warm and factual',
        defaultLanguage: 'tr-tr',
        contentGuidelines: 'No invented claims',
      })
    ).status,
    200,
  );
  assert.equal(
    (await product(profilePath, 'PUT', { toneOfVoice: 'Clear and helpful' }))
      .status,
    200,
  );
  const profile = (await (await product(profilePath)).json()).profile;
  assert.equal(profile.description, detail);
  assert.equal(profile.targetAudience, 'Local business owners');
  assert.equal(profile.defaultLanguage, 'tr-TR');
  for (let i = 0; i < 2; i++) {
    const page = await fetch(`${origin}${profilePath}`, {
      headers: { cookie },
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(
      html.includes('Clear and helpful') &&
        html.includes('Local business owners') &&
        html.includes('No invented claims'),
    );
  }
  for (const section of ['content', 'calendar', 'media']) {
    const response = await fetch(`${origin}/${section}`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Coming later/);
  }
  assert.equal(
    (await fetch(`${origin}/unknown-section`, { headers: { cookie } })).status,
    404,
  );
  assert.equal(
    (await auth('logout', {}, cookie, 'https://evil.example')).status,
    403,
  );
  assert.equal((await auth('me', undefined, cookie)).status, 200);
  assert.equal((await auth('logout', {}, cookie)).status, 200);
  assert.equal((await auth('me', undefined, cookie)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/brands`, {
        headers: { cookie },
        redirect: 'manual',
      })
    ).status,
    307,
  );
  console.info(
    'SYN-003 + SYN-002B + SYN-002A-A11 passed: real PostgreSQL, Next/Nest auth, organization, multiple brands, edit/reload, CSRF and logout.',
  );
} finally {
  for (const { child, exited } of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
  }
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
}
