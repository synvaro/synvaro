/** SYN-001-A1: process liveness only; not database/provider readiness. */
export interface HealthResponse {
  status: 'ok';
  service: 'synvaro-api';
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
}

/** SYN-002A public auth projection. No password/session fields. */
export interface AuthUser {
  id: string;
  email: string;
}
export interface AuthResponse {
  user: AuthUser;
}

/** ORG-001/002 and BRD-001/002: public response shapes, ISO timestamps. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}
export interface Brand {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface OrganizationResponse {
  organization: Organization | null;
}
export interface BrandsResponse {
  brands: Brand[];
}
export interface BrandResponse {
  brand: Brand;
}

/** BRP-001: detailed brand context, separate from the Brand card summary. */
export interface BrandProfile {
  id: string;
  brandId: string;
  description: string;
  targetAudience: string;
  toneOfVoice: string;
  defaultLanguage: string | null;
  contentGuidelines: string;
  createdAt: string;
  updatedAt: string;
}
export interface BrandProfileResponse {
  profile: BrandProfile | null;
}

/** CNT-001–004: manual drafts only. */
export interface ContentSummary {
  id: string;
  brandId: string;
  title: string;
  status: 'DRAFT';
  createdAt: string;
  updatedAt: string;
}
export interface Content extends ContentSummary {
  body: string;
}
export interface ContentResponse {
  content: Content;
}
export interface ContentsResponse {
  contents: ContentSummary[];
}

/** MED-001–004: public metadata; storage keys and server paths are private. */
export interface MediaAsset {
  id: string;
  brandId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  origin: 'UPLOADED' | 'AI_GENERATED' | 'AI_EDITED' | 'AI_VOICE';
  generation?: {
    id: string;
    provider: string;
    model: string;
    imageSize: string | null;
    imageQuality: string | null;
    imageAspectRatio: string | null;
    sourceMediaAssetId: string | null;
    providerGenerationId: string | null;
    voiceId: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
}
export interface MediaResponse {
  asset: MediaAsset;
}
export interface MediaListResponse {
  assets: MediaAsset[];
}

export interface ContentMedia {
  contentId: string;
  mediaAssetId: string;
  position: number;
  createdAt: string;
  asset: MediaAsset;
}
export interface ContentMediaResponse {
  attachments: ContentMedia[];
}

export type AiCapability =
  | 'TEXT_GENERATION'
  | 'IMAGE_GENERATION'
  | 'IMAGE_EDITING'
  | 'VIDEO_GENERATION'
  | 'IMAGE_TO_VIDEO'
  | 'SPEECH_GENERATION';
export type AiProviderId = 'openai' | 'google' | 'elevenlabs';
export interface AiModelBase {
  provider: AiProviderId;
  model: string;
  verifiedAt: string;
  reference: string;
  cost: {
    capability: 'CONSERVATIVE_BOUND' | 'ESTIMATE_ONLY' | 'UNAVAILABLE';
    reference: string;
  };
}
export type AiModelDefinition = AiModelBase &
  (
    | {
        implemented: true;
        capability: 'TEXT_GENERATION';
        settings: {
          outputFormats: readonly string[];
          minOutputTokens: number;
          maxOutputTokens: number;
        };
      }
    | {
        implemented: true;
        capability: 'IMAGE_GENERATION';
        settings: {
          outputFormats: readonly string[];
          sizes: readonly string[];
          qualities: readonly string[];
          aspectRatios?: readonly string[];
        };
      }
    | {
        implemented: true;
        capability: 'IMAGE_EDITING';
        settings: {
          inputFormats: readonly string[];
          outputFormats: readonly string[];
          sizes: readonly string[];
          qualities: readonly string[];
          aspectRatios: readonly string[];
        };
      }
    | {
        implemented: true;
        capability: 'SPEECH_GENERATION';
        settings: {
          outputFormats: readonly string[];
          maxCharacters: number;
        };
      }
    | { implemented: false; capability: AiCapability }
  );
export type AiModel = AiModelDefinition & {
  status: 'AVAILABLE' | 'NOT_CONFIGURED' | 'PLANNED';
  configured: boolean;
  unavailableReason: string | null;
};
export interface AiModelCatalog {
  models: AiModel[];
}
