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
  origin: 'UPLOADED';
  createdAt: string;
}
export interface MediaResponse {
  asset: MediaAsset;
}
export interface MediaListResponse {
  assets: MediaAsset[];
}
