// Capability boundaries only; no orchestration or automatic provider selection.
export const TEXT_PROVIDER = Symbol('TEXT_PROVIDER');
export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
export interface TextRequest {
  model: string;
  context: string;
  maxOutputTokens: number;
}
export interface TextResult {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}
export interface TextProvider {
  configured(): boolean;
  count(request: TextRequest): Promise<number>;
  generate(request: TextRequest): Promise<TextResult>;
}
export interface ImageRequest {
  model: string;
  size: string;
  quality: string;
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

// Future contracts: intentionally no implementations or runtime registrations.
export interface ImageEditProvider {
  edit(
    request: ImageRequest & { source: Uint8Array; mimeType: string },
  ): Promise<ImageResult>;
}
export interface SpeechProvider {
  voices(): Promise<ReadonlyArray<{ id: string; name: string }>>;
  generate(request: {
    model: string;
    text: string;
    voiceId: string;
    format: string;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    model: string;
    usage?: { characters: number; audioSeconds?: number };
  }>;
}
export type VideoResult =
  | { status: 'PENDING' }
  | { status: 'FAILED'; code: 'PROVIDER_FAILURE' }
  | {
      status: 'COMPLETED';
      bytes: Uint8Array;
      mimeType: string;
      usage?: { videoSeconds: number };
    };
export interface VideoProvider {
  start(request: {
    model: string;
    prompt: string;
    durationSeconds: number;
    aspectRatio: string;
    sourceImage?: { bytes: Uint8Array; mimeType: string };
  }): Promise<{ operationId: string }>;
  retrieve(operationId: string): Promise<VideoResult>;
}
