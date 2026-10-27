import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
export const IMAGE_MODEL = 'gpt-image-2.5-flare';
export const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export const IMAGE_PRICING_EXPIRES = new Date('2026-11-25T00:00:00Z');
export const IMAGE_COST_NOTICE =
  'Cost cannot be reliably bounded before generation. A selected monthly budget blocks image generation. Actual usage can be estimated afterward; this is not a provider billing cap.';
export interface ImageRequest {
  model: string;
  size: (typeof IMAGE_SIZES)[number];
  quality: (typeof IMAGE_QUALITIES)[number];
  prompt: string;
}
export interface ImageResult {
  bytes: Buffer;
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTokens?: number;
}
export interface ImageProvider {
  configured(): boolean;
  generate(request: ImageRequest): Promise<ImageResult>;
}
// Bound JSON before the SDK buffers it, including error responses. No remote image URLs.
export const boundedImageFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 30 * 1024 * 1024) throw new Error('Image response too large');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
@Injectable()
export class OpenAIImageProvider implements ImageProvider {
  configured() {
    return !!process.env.OPENAI_API_KEY?.trim();
  }
  async generate(request: ImageRequest): Promise<ImageResult> {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: 'https://api.openai.com/v1',
      maxRetries: 0,
      timeout: 120000,
      fetch: boundedImageFetch,
    });
    const result = await client.images.generate({
      model: request.model,
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      n: 1,
      output_format: 'png',
      background: 'opaque',
      moderation: 'auto',
    });
    const encoded =
      result.data?.length === 1 ? result.data[0]?.b64_json : undefined;
    if (
      !encoded ||
      encoded.length > Math.ceil((20 * 1024 * 1024) / 3) * 4 ||
      encoded.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(encoded)
    )
      throw new Error('Invalid image response');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded)
      throw new Error('Invalid image encoding');
    const usage = result.usage;
    const knownBreakdown =
      usage &&
      usage.input_tokens ===
        usage.input_tokens_details?.text_tokens +
          usage.input_tokens_details?.image_tokens &&
      usage.total_tokens === usage.input_tokens + usage.output_tokens &&
      (!usage.output_tokens_details ||
        (usage.output_tokens_details.text_tokens === 0 &&
          usage.output_tokens_details.image_tokens === usage.output_tokens));
    return {
      bytes,
      inputTextTokens: knownBreakdown
        ? usage.input_tokens_details.text_tokens
        : undefined,
      inputImageTokens: knownBreakdown
        ? usage.input_tokens_details.image_tokens
        : undefined,
      outputTokens: knownBreakdown ? usage.output_tokens : undefined,
    };
  }
}
