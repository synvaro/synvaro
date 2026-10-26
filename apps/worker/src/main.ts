import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

try {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Keep the idle foundation process alive until a queue owns its lifecycle.
  const keepAlive = setInterval(() => {}, 60_000);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    try {
      await app.close();
      console.info('SYNVARO worker stopped');
    } catch {
      console.error('SYNVARO worker shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  console.info('SYNVARO worker ready (idle; no queue configured)');
} catch {
  console.error('SYNVARO worker failed to start');
  process.exitCode = 1;
}
