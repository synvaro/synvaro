import { Injectable } from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { INSTRUCTIONS } from './text-provider.js';
import { GOOGLE_TEXT_MODEL } from './providers/models.js';
import { classifyGoogleFailure, GoogleFailure } from './google-failure.js';
import type {
  TextProvider,
  TextRequest,
  TextResult,
} from './providers/contracts.js';

@Injectable()
export class GoogleTextProvider implements TextProvider {
  static readonly COUNT_TIMEOUT_MS = 30_000;
  static readonly GENERATE_TIMEOUT_MS = 60_000;
  configured() {
    return !!process.env.GOOGLE_API_KEY?.trim();
  }
  private client() {
    return new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
      httpOptions: {
        apiVersion: 'v1beta',
        timeout: GoogleTextProvider.GENERATE_TIMEOUT_MS,
        retryOptions: { attempts: 1 },
      },
    });
  }
  private params(request: TextRequest) {
    if (request.model !== GOOGLE_TEXT_MODEL.model)
      throw new Error('Unsupported text model');
    return {
      model: request.model,
      contents: [{ role: 'user', parts: [{ text: request.context }] }],
    };
  }
  async count(request: TextRequest) {
    const started = performance.now();
    const params = this.params(request);
    // The SDK rejects systemInstruction in Developer API countTokens. The official
    // REST endpoint supports a complete generateContentRequest and counts it all.
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_TEXT_MODEL.model}:countTokens`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(GoogleTextProvider.COUNT_TIMEOUT_MS),
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': process.env.GOOGLE_API_KEY ?? '',
          },
          body: JSON.stringify({
            generateContentRequest: {
              model: `models/${params.model}`,
              contents: params.contents,
              systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
            },
          }),
        },
      );
      if (!response.ok) throw response;
      const reader = response.body?.getReader();
      if (!reader)
        throw new GoogleFailure(
          'MALFORMED_RESPONSE',
          'count',
          Math.round(performance.now() - started),
        );
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 16384)
            throw new GoogleFailure(
              'MALFORMED_RESPONSE',
              'count',
              Math.round(performance.now() - started),
            );
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      let data: { totalTokens?: number };
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new GoogleFailure(
          'MALFORMED_RESPONSE',
          'count',
          Math.round(performance.now() - started),
        );
      }
      if (!Number.isSafeInteger(data.totalTokens) || data.totalTokens! < 1)
        throw new GoogleFailure(
          'MALFORMED_RESPONSE',
          'count',
          Math.round(performance.now() - started),
        );
      return data.totalTokens!;
    } catch (error) {
      throw classifyGoogleFailure(
        error,
        'count',
        Math.round(performance.now() - started),
      );
    }
  }
  async generate(request: TextRequest): Promise<TextResult> {
    const params = this.params(request);
    const started = performance.now();
    try {
      const response = await this.client().models.generateContent({
        ...params,
        config: {
          systemInstruction: INSTRUCTIONS,
          candidateCount: 1,
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          store: false,
        },
      });
      const candidates = response.candidates;
      if (
        !candidates ||
        candidates.length !== 1 ||
        candidates[0]?.finishReason !== 'STOP' ||
        !response.modelVersion ||
        !(
          response.modelVersion === request.model ||
          response.modelVersion.startsWith(`${request.model}-`)
        )
      )
        throw new GoogleFailure(
          'MALFORMED_RESPONSE',
          'generate',
          Math.round(performance.now() - started),
        );
      const parts = candidates[0].content?.parts;
      if (!parts || parts.some((p) => !p.thought && typeof p.text !== 'string'))
        throw new GoogleFailure(
          'MALFORMED_RESPONSE',
          'generate',
          Math.round(performance.now() - started),
        );
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('');
      const usage = response.usageMetadata;
      const input = usage?.promptTokenCount;
      const visible = usage?.candidatesTokenCount;
      const thoughts =
        usage?.thoughtsTokenCount ??
        (usage?.totalTokenCount === (input ?? -1) + (visible ?? -1)
          ? 0
          : undefined);
      const total = usage?.totalTokenCount;
      const valid =
        [input, visible, thoughts, total].every(
          (n) => Number.isSafeInteger(n) && n! >= 0,
        ) &&
        (usage?.toolUsePromptTokenCount ?? 0) === 0 &&
        total === input! + visible! + thoughts! &&
        visible! + thoughts! <= request.maxOutputTokens;
      return {
        text,
        model: request.model,
        ...(valid
          ? { inputTokens: input, outputTokens: visible! + thoughts! }
          : {}),
      };
    } catch (error) {
      throw classifyGoogleFailure(
        error,
        'generate',
        Math.round(performance.now() - started),
      );
    }
  }
}
