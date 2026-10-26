import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test(
  'SYN-001-A4: worker starts independently and exits cleanly on SIGTERM',
  { timeout: 15_000 },
  async () => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../main.js', import.meta.url))],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exited = once(child, 'exit');
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', () =>
          reject(new Error('Worker exited before readiness')),
        );
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('SYNVARO worker ready')) resolve();
        });
      });
      child.kill('SIGTERM');
      const [code, signal] = await exited;
      assert.match(output, /idle; no queue configured/);
      assert.equal(code, 0);
      assert.equal(signal, null);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  },
);
