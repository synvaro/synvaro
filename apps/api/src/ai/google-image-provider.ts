import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import {
  GOOGLE_IMAGE_ASPECT_RATIOS,
  GOOGLE_IMAGE_MODEL,
  GOOGLE_IMAGE_QUALITIES,
  GOOGLE_IMAGE_SIZES,
} from './providers/models.js';
import type {
  ImageEditProvider,
  ImageProvider,
  ImageRequest,
  ImageResult,
} from './providers/contracts.js';

const MAX_ENCODED = Math.ceil((20 * 1024 * 1024) / 3) * 4;

@Injectable()
export class GoogleImageProvider implements ImageProvider, ImageEditProvider {
  configured() {
    // Nano Banana 2.1 has no free-tier API access. The operator confirms paid
    // model access after checking the exact Synvaro project; no paid probe.
    return (
      !!process.env.GOOGLE_API_KEY?.trim() &&
      process.env.GOOGLE_IMAGE_PAID_TIER_CONFIRMED === 'true'
    );
  }

  private validate(request: ImageRequest) {
    if (
      request.model !== GOOGLE_IMAGE_MODEL ||
      !GOOGLE_IMAGE_SIZES.includes(
        request.size as (typeof GOOGLE_IMAGE_SIZES)[number],
      ) ||
      !GOOGLE_IMAGE_QUALITIES.includes(
        request.quality as (typeof GOOGLE_IMAGE_QUALITIES)[number],
      ) ||
      !GOOGLE_IMAGE_ASPECT_RATIOS.includes(
        request.aspectRatio as (typeof GOOGLE_IMAGE_ASPECT_RATIOS)[number],
      )
    )
      throw new Error('Unsupported Google image settings');
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    return this.execute(request);
  }

  async edit(
    request: ImageRequest & {
      aspectRatio: string;
      source: Uint8Array;
      mimeType: string;
    },
  ): Promise<ImageResult> {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(request.mimeType) ||
      request.source.byteLength < 1 ||
      request.source.byteLength > 10 * 1024 * 1024
    )
      throw new Error('Unsupported source image');
    return this.execute(request, {
      bytes: request.source,
      mimeType: request.mimeType,
    });
  }

  private async execute(
    request: ImageRequest,
    source?: { bytes: Uint8Array; mimeType: string },
  ): Promise<ImageResult> {
    this.validate(request);
    const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    const response = await client.interactions.create(
      {
        model: request.model,
        input: source
          ? [
              { type: 'text', text: request.prompt },
              {
                type: 'image',
                mime_type: source.mimeType,
                data: Buffer.from(source.bytes).toString('base64'),
              },
            ]
          : request.prompt,
        response_format: {
          type: 'image',
          mime_type: 'image/png',
          image_size: '1K',
          aspect_ratio: request.aspectRatio,
        },
        store: false,
        background: false,
      },
      { timeout_ms: 120_000, retries: { strategy: 'none' } },
    );
    const image = response.output_image;
    const encoded = image?.data;
    if (
      response.status !== 'completed' ||
      !(
        response.model === request.model ||
        response.model?.startsWith(`${request.model}-`)
      ) ||
      !response.id ||
      !encoded ||
      image.mime_type !== 'image/png' ||
      encoded.length > MAX_ENCODED ||
      encoded.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(encoded)
    )
      throw new Error('Invalid Google image response');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded)
      throw new Error('Invalid Google image encoding');
    const usage = response.usage;
    const input = usage?.total_input_tokens;
    const output = usage?.total_output_tokens;
    const total = usage?.total_tokens;
    const inputImage =
      usage?.input_tokens_by_modality?.find((part) => part.modality === 'IMAGE')
        ?.tokens ?? (source ? undefined : 0);
    const outputImage = usage?.output_tokens_by_modality?.find(
      (part) => part.modality === 'IMAGE',
    )?.tokens;
    const known = [input, output, total, inputImage, outputImage].every(
      (n) => Number.isSafeInteger(n) && n! >= 0 && n! < 1e7,
    );
    // total_tokens may also include thinking/internal output. Charge any excess
    // at the text/thinking rate rather than assuming it is free.
    const billableOutput = known
      ? Math.max(output!, total! - input!)
      : undefined;
    return {
      bytes,
      providerGenerationId: response.id,
      ...(known &&
      inputImage! <= input! &&
      outputImage! <= output! &&
      total! >= input! + output!
        ? {
            inputTextTokens: input! - inputImage!,
            inputImageTokens: inputImage,
            outputTokens: billableOutput,
            imageOutputTokens: outputImage,
          }
        : {}),
    };
  }
}
