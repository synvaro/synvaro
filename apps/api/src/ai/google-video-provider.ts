import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { classifyGoogleFailure, GoogleFailure } from './google-failure.js';
import type {
  VideoProvider,
  VideoRequest,
  VideoObservation,
} from './providers/contracts.js';

export const VIDEO_MODEL = 'gemini-omni-1.1-flash';
export const VIDEO_DURATIONS = ['3s', '5s', '10s'] as const;
export const VIDEO_ASPECT_RATIOS = ['9:16', '16:9'] as const;
export const VIDEO_RESOLUTIONS = ['720p'] as const;
export const VIDEO_PRICING_EXPIRES = new Date('2026-11-25T00:00:00Z');
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_ENCODED = Math.ceil(MAX_VIDEO_BYTES / 3) * 4;

@Injectable()
export class GoogleVideoProvider implements VideoProvider {
  configured() {
    // Operator access confirmation is local admission, never proof of quota.
    return (
      !!process.env.GOOGLE_API_KEY?.trim() &&
      process.env.GOOGLE_VIDEO_PAID_TIER_CONFIRMED === 'true'
    );
  }
  private client() {
    return new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }
  async start(request: VideoRequest): Promise<VideoObservation> {
    if (
      request.model !== VIDEO_MODEL ||
      !VIDEO_DURATIONS.includes(
        request.duration as (typeof VIDEO_DURATIONS)[number],
      ) ||
      !VIDEO_ASPECT_RATIOS.includes(
        request.aspectRatio as (typeof VIDEO_ASPECT_RATIOS)[number],
      ) ||
      !VIDEO_RESOLUTIONS.includes(
        request.resolution as (typeof VIDEO_RESOLUTIONS)[number],
      ) ||
      (request.source &&
        (!['image/jpeg', 'image/png', 'image/webp'].includes(
          request.source.mimeType,
        ) ||
          request.source.bytes.length < 1 ||
          request.source.bytes.length > 10 * 1024 * 1024))
    )
      throw new GoogleFailure('UNSUPPORTED_REQUEST', 'generate', 0);
    const started = Date.now();
    try {
      const response = await this.client().interactions.create(
        {
          model: VIDEO_MODEL,
          input: request.source
            ? [
                { type: 'text', text: request.prompt },
                {
                  type: 'image',
                  mime_type: request.source.mimeType,
                  data: Buffer.from(request.source.bytes).toString('base64'),
                },
              ]
            : request.prompt,
          response_format: {
            type: 'video',
            duration: request.duration,
            aspect_ratio: request.aspectRatio,
            resolution: '720p',
            delivery: 'uri',
          },
          background: true,
          store: true,
        },
        { timeout_ms: 60_000, retries: { strategy: 'none' } },
      );
      return await this.observe(response, true);
    } catch (error) {
      throw classifyGoogleFailure(error, 'generate', Date.now() - started);
    }
  }
  async retrieve(operationId: string): Promise<VideoObservation> {
    if (!/^[-_a-zA-Z0-9]{1,160}$/.test(operationId))
      throw new GoogleFailure('UNSUPPORTED_REQUEST', 'generate', 0);
    const started = Date.now();
    try {
      const response = await this.client().interactions.get(
        operationId,
        undefined,
        { timeout_ms: 45_000, retries: { strategy: 'none' } },
      );
      return await this.observe(response);
    } catch (error) {
      throw classifyGoogleFailure(error, 'generate', Date.now() - started);
    }
  }
  private fileId(uri: string): string {
    if (/^files\/[a-zA-Z0-9-]{1,80}$/.test(uri)) return uri.slice(6);
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    }
    const match = /^\/v1beta\/files\/([a-zA-Z0-9-]{1,80})(?::download)?$/.exec(
      url.pathname,
    );
    if (
      url.origin !== 'https://generativelanguage.googleapis.com' ||
      url.username ||
      url.password ||
      url.hash ||
      (url.search && url.search !== '?alt=media') ||
      !match
    )
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    return match[1]!;
  }
  private async download(id: string): Promise<Buffer | null> {
    const file = await this.client().files.get({
      name: `files/${id}`,
      config: {
        httpOptions: { timeout: 10_000, retryOptions: { attempts: 1 } },
      },
    });
    if (file.state === 'PROCESSING') return null;
    if (file.state !== 'ACTIVE')
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    if (
      file.sizeBytes &&
      (!Number.isSafeInteger(Number(file.sizeBytes)) ||
        Number(file.sizeBytes) > MAX_VIDEO_BYTES)
    )
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/files/${id}:download?alt=media`;
    const signal = AbortSignal.timeout(40_000);
    let response = await fetch(endpoint, {
      headers: { 'x-goog-api-key': process.env.GOOGLE_API_KEY! },
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      let redirect: URL;
      try {
        redirect = new URL(location ?? '');
      } catch {
        throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
      }
      if (
        redirect.origin !== 'https://storage.googleapis.com' ||
        redirect.username ||
        redirect.password ||
        redirect.hash
      )
        throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
      response.body?.cancel().catch(() => {});
      response = await fetch(redirect, {
        redirect: 'manual',
        signal,
      });
    }
    if (!response.ok) throw response;
    if (
      !response.body ||
      (response.headers.get('content-length') &&
        Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES)
    )
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_VIDEO_BYTES) {
        await response.body.cancel().catch(() => {});
        throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
      }
      chunks.push(bytes);
    }
    if (!size) throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    return Buffer.concat(chunks);
  }
  private async observe(
    response: {
      id?: string;
      model?: string;
      status?: string;
      output_video?: { data?: string; mime_type?: string; uri?: string };
      usage?: {
        total_input_tokens?: number;
        total_output_tokens?: number;
        output_tokens_by_modality?: { modality?: string; tokens?: number }[];
      };
    },
    deferUri = false,
  ): Promise<VideoObservation> {
    if (
      !response.id ||
      !/^[-_a-zA-Z0-9]{1,160}$/.test(response.id) ||
      !(
        response.model === VIDEO_MODEL ||
        response.model?.startsWith(`${VIDEO_MODEL}-`)
      )
    )
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    if (response.status === 'queued' || response.status === 'in_progress')
      return { status: 'RUNNING', operationId: response.id };
    if (
      response.status === 'failed' ||
      response.status === 'cancelled' ||
      response.status === 'incomplete' ||
      response.status === 'budget_exceeded'
    )
      return { status: 'FAILED', operationId: response.id };
    const video = response.output_video;
    const encoded = video?.data;
    if (
      response.status !== 'completed' ||
      video?.mime_type !== 'video/mp4' ||
      (!encoded && !video.uri) ||
      (encoded &&
        (encoded.length > MAX_ENCODED ||
          encoded.length % 4 !== 0 ||
          /[^A-Za-z0-9+/=]/.test(encoded)))
    )
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    if (!encoded && video.uri && deferUri)
      return { status: 'RUNNING', operationId: response.id };
    const bytes = encoded
      ? Buffer.from(encoded, 'base64')
      : await this.download(this.fileId(video.uri!));
    if (!bytes) return { status: 'RUNNING', operationId: response.id };
    if (
      !bytes.length ||
      bytes.length > MAX_VIDEO_BYTES ||
      (encoded && bytes.toString('base64') !== encoded)
    )
      throw new GoogleFailure('MALFORMED_RESPONSE', 'generate', 0);
    const usage = response.usage;
    const videoTokens = usage?.output_tokens_by_modality?.find(
      (m) => m.modality === 'VIDEO',
    )?.tokens;
    return {
      status: 'SUCCEEDED',
      operationId: response.id,
      bytes,
      inputTokens: usage?.total_input_tokens,
      outputTokens: usage?.total_output_tokens,
      outputVideoTokens: videoTokens,
    };
  }
}
