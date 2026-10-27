import { Injectable } from '@nestjs/common';
import type { SpeechProvider } from './providers/contracts.js';

export const SPEECH_MODEL = 'eleven_multilingual_v2';
export const SPEECH_FORMAT = 'mp3_44100_128';
export const MAX_NARRATION = 2000;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const API = 'https://api.elevenlabs.io';
const voiceId = (id: string) => /^[A-Za-z0-9]{20,40}$/.test(id);
export type Voice = { id: string; name: string; languages: string[] };

export class ElevenFailure extends Error {
  constructor(
    readonly category:
      | 'TIMEOUT'
      | 'RATE_LIMIT'
      | 'AUTHENTICATION'
      | 'PERMISSION'
      | 'INVALID_REQUEST'
      | 'SERVER_ERROR'
      | 'MALFORMED_RESPONSE'
      | 'PROVIDER_ERROR',
    readonly status?: number,
  ) {
    super('ElevenLabs request failed');
  }
}

@Injectable()
export class ElevenLabsProvider implements SpeechProvider {
  configured() {
    return !!process.env.ELEVENLABS_API_KEY?.trim();
  }
  private async request(path: string, init: RequestInit, timeout: number) {
    try {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        const code = response.status;
        throw new ElevenFailure(
          code === 429
            ? 'RATE_LIMIT'
            : code === 401
              ? 'AUTHENTICATION'
              : code === 403
                ? 'PERMISSION'
                : code === 400 || code === 404 || code === 422
                  ? 'INVALID_REQUEST'
                  : code >= 500
                    ? 'SERVER_ERROR'
                    : 'PROVIDER_ERROR',
          code,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof ElevenFailure) throw error;
      throw new ElevenFailure(
        error instanceof Error &&
          /abort|timeout/i.test(`${error.name} ${error.message}`)
          ? 'TIMEOUT'
          : 'PROVIDER_ERROR',
      );
    }
  }
  async voices(): Promise<Voice[]> {
    if (!this.configured()) return [];
    const result: Voice[] = [];
    let next: string | null = null;
    try {
      for (let page = 0; page < 5; page++) {
        const query = new URLSearchParams({
          category: 'premade',
          page_size: '100',
        });
        if (next) query.set('next_page_token', next);
        const response = await this.request(`/v2/voices?${query}`, {}, 10_000);
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== 'object' ||
          !('voices' in data) ||
          !Array.isArray(data.voices)
        )
          throw new ElevenFailure('MALFORMED_RESPONSE');
        for (const item of data.voices) {
          if (
            !item ||
            typeof item !== 'object' ||
            item.category !== 'premade' ||
            typeof item.voice_id !== 'string' ||
            !voiceId(item.voice_id) ||
            typeof item.name !== 'string'
          )
            continue;
          result.push({
            id: item.voice_id,
            name: item.name.slice(0, 120),
            languages: Array.isArray(item.verified_languages)
              ? item.verified_languages
                  .filter(
                    (x: unknown) =>
                      x &&
                      typeof x === 'object' &&
                      'model_id' in x &&
                      x.model_id === SPEECH_MODEL &&
                      'language' in x &&
                      typeof x.language === 'string',
                  )
                  .map((x: { language: string }) => x.language.slice(0, 20))
              : [],
          });
        }
        const hasMore = 'has_more' in data && data.has_more === true;
        next =
          'next_page_token' in data && typeof data.next_page_token === 'string'
            ? data.next_page_token
            : null;
        if (!hasMore || !next) break;
      }
      if (result.length) return result;
    } catch (error) {
      if (!process.env.ELEVENLABS_VOICE_ID) throw error;
    }
    const fallback = process.env.ELEVENLABS_VOICE_ID;
    if (!fallback || !voiceId(fallback)) return [];
    const response = await this.request(`/v1/voices/${fallback}`, {}, 10_000);
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('voice_id' in data) ||
      data.voice_id !== fallback ||
      !('category' in data) ||
      data.category !== 'premade'
    )
      throw new ElevenFailure('MALFORMED_RESPONSE');
    return [{ id: fallback, name: 'Configured premade voice', languages: [] }];
  }
  async generate(request: {
    model: string;
    text: string;
    voiceId: string;
    format: string;
  }) {
    if (
      request.model !== SPEECH_MODEL ||
      request.format !== SPEECH_FORMAT ||
      !voiceId(request.voiceId) ||
      !request.text.trim() ||
      [...request.text].length > MAX_NARRATION
    )
      throw new ElevenFailure('INVALID_REQUEST');
    const response = await this.request(
      `/v1/text-to-speech/${request.voiceId}?output_format=${SPEECH_FORMAT}`,
      {
        method: 'POST',
        body: JSON.stringify({ text: request.text, model_id: request.model }),
      },
      60_000,
    );
    if (
      !/^audio\/mpeg(?:\s*;|$)/i.test(
        response.headers.get('content-type') ?? '',
      ) ||
      !response.body
    )
      throw new ElevenFailure('MALFORMED_RESPONSE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_AUDIO_BYTES)
          throw new ElevenFailure('MALFORMED_RESPONSE');
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof ElevenFailure) throw error;
      throw new ElevenFailure('PROVIDER_ERROR');
    }
    if (!size) throw new ElevenFailure('MALFORMED_RESPONSE');
    const rawCost = response.headers.get('character-cost');
    const characterCost =
      rawCost && /^\d{1,8}$/.test(rawCost) ? Number(rawCost) : undefined;
    const rawId = response.headers.get('request-id');
    return {
      bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
      mimeType: 'audio/mpeg',
      model: request.model,
      providerGenerationId:
        rawId && /^[A-Za-z0-9_-]{1,160}$/.test(rawId) ? rawId : undefined,
      characterCost,
    };
  }
}
