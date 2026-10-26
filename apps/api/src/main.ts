import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await createApp();
  await app.listen(config.port, config.host);
} catch {
  console.error(
    'SYNVARO API failed to start. Check environment configuration and port availability.',
  );
  process.exitCode = 1;
}
