// SYN-001-A5: exercise built HTTP processes, not mocks. No database is required.
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
try {
  const api = start(['dist/main.js'], 'apps/api', {
    API_PORT: '43101',
    API_HOST: '127.0.0.1',
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
  );
  const health = await ready('http://127.0.0.1:43101/health', api);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'synvaro-api',
  });
  const home = await ready('http://127.0.0.1:43100', web);
  assert.match(await home.text(), /The foundation is here/);
  for (const section of ['brands', 'content', 'calendar', 'media']) {
    const response = await fetch(`http://127.0.0.1:43100/${section}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Coming later/);
  }
  const missing = await fetch('http://127.0.0.1:43100/unknown-section');
  assert.equal(missing.status, 404);
  console.info('SYN-001-A5 passed: built API, web and all placeholder routes.');
} finally {
  for (const { child, exited } of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
  }
}
