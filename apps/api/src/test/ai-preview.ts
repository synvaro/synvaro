// Test-only executable, never imported by main.ts. No production mock-provider flag.
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { AiService } from '../ai/ai.service.js';
import { OpenAITextProvider } from '../ai/text-provider.js';
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'));
const app = await createApp();
app.get(AiService).now = () => new Date('2026-10-26T16:00:00Z');
const provider = app.get(OpenAITextProvider);
provider.configured = () => true;
provider.count = async () => 100;
let sequence = 0;
provider.generate = async (request) => ({
  text: `Hypothetical example ${++sequence} for ${JSON.parse(request.context).brand.name}. This is a test-provider suggestion, not a claim about released capabilities.`,
  model: request.model,
  inputTokens: 100,
  outputTokens: 50,
});
const config = loadConfig();
await app.listen(config.port, config.host);
