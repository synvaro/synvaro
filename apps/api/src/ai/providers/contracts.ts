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
  aspectRatio?: string;
}
export interface ImageResult {
  bytes: Buffer;
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTokens?: number;
  imageOutputTokens?: number;
  providerGenerationId?: string;
}
export interface ImageProvider {
  configured(): boolean;
  generate(request: ImageRequest): Promise<ImageResult>;
}

// Future contracts: intentionally no implementations or runtime registrations.
export interface ImageEditProvider {
  configured(): boolean;
  edit(
    request: ImageRequest & {
      aspectRatio: string;
      source: Uint8Array;
      mimeType: string;
    },
  ): Promise<ImageResult>;
}
export interface SpeechProvider {
  configured(): boolean;
  voices(): Promise<
    ReadonlyArray<{ id: string; name: string; languages: string[] }>
  >;
  generate(request: {
    model: string;
    text: string;
    voiceId: string;
    format: string;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    model: string;
    providerGenerationId?: string;
    characterCost?: number;
  }>;
}
export type VideoRequest = {
  model: string;
  prompt: string;
  duration: string;
  aspectRatio: string;
  resolution: string;
  source?: { bytes: Uint8Array; mimeType: string };
};
export type VideoObservation =
  | { status: 'RUNNING'; operationId: string }
  | { status: 'FAILED'; operationId: string }
  | {
      status: 'SUCCEEDED';
      operationId: string;
      bytes: Buffer;
      inputTokens?: number;
      outputTokens?: number;
      outputVideoTokens?: number;
    };
export interface VideoProvider {
  configured(): boolean;
  start(request: VideoRequest): Promise<VideoObservation>;
  retrieve(operationId: string): Promise<VideoObservation>;
}
