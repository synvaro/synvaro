// SYN-002A-A11: real PostgreSQL + built Next.js proxy + NestJS API, without mocks.
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
  const anonymous = await fetch(origin, { redirect: 'manual' });
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
    assert.match(html, /The foundation is here/);
    assert.ok(html.includes(email));
  }
  for (const section of ['brands', 'content', 'calendar', 'media']) {
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
    (await fetch(origin, { headers: { cookie }, redirect: 'manual' })).status,
    307,
  );
  console.info(
    'SYN-002A-A11 passed: PostgreSQL + Next.js proxy + NestJS register/login/refresh/logout and protected studio.',
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
