# Data model v0.1

## Implemented development schema (SYN-007)

The Prisma schema and migrations implement only these ten models. UUID keys and
UTC timestamps are used; authentication secrets are hashes, not plaintext.

| Model | Fields and constraints |
|---|---|
| User | id, unique email, passwordHash (Argon2id), createdAt, updatedAt |
| Session | id, unique tokenHash (SHA-256), userId FK, createdAt, expiresAt, revokedAt |
| Organization | id, unique ownerUserId FK to User, name, globally unique slug, createdAt, updatedAt |
| Brand | id, organizationId FK, name, slug, nullable description, createdAt, updatedAt; unique (organizationId, slug) |
| BrandProfile | id, unique brandId FK, description, targetAudience, toneOfVoice, nullable defaultLanguage, contentGuidelines, createdAt, updatedAt |
| Content | id, brandId FK, title (200), body text (empty allowed), status DRAFT, createdAt, updatedAt; index (brandId, updatedAt DESC, id DESC) |
| MediaAsset | id, brandId FK (RESTRICT delete), originalFilename (255), unique opaque UUID storageKey, mimeType, sizeBytes Int (20 MiB max), nullable width/height/durationMs, origin UPLOADED, AI_GENERATED or AI_EDITED, createdAt; index (brandId, createdAt DESC, id DESC) |

| ContentMedia | composite PK (contentId, mediaAssetId), cascading FKs to Content and MediaAsset, position Int, createdAt; indexes (contentId, position, mediaAssetId), (mediaAssetId) |

Content N:M MediaAsset through ContentMedia. Same-brand validation and per-content row locking happen in atomic API transactions; parent brand assignments are immutable through existing APIs. Detach removes only the relationship; no file duplication.

Brand 1:N MediaAsset. Original bytes live in private configured filesystem storage, not PostgreSQL. No owner/organization FK duplication.

Brand 1:N Content. Content brand is immutable through the API; no duplicate owner/organization FKs.

Brand 1:0..1 BrandProfile. Profile text is detailed context; Brand.description remains a separate short summary.

User 1:0..1 Organization; Organization 1:N Brand. There are no membership,
role or permission tables. Other foreign keys cascade on parent removal; MediaAsset restricts brand removal to prevent orphaned files; no user/organization/brand deletion API is exposed in this slice.


User 1:0..1 AiPreference: enabled (false), supported model, maxOutputTokens (512), optional monthlyBudgetMicros (BigInt), confirmPaid (true), updatedAt. No provider credentials.

AiGeneration: UUID, userId and contentId (RESTRICT foreign keys for attributable usage), unique (userId, requestId), model, maxOutputTokens, COUNTING/RUNNING/SUCCEEDED/FAILED/BLOCKED status, optional input/output tokens and estimatedCostMicros, budgetChargeMicros, costUncertain, sanitized errorCode, createdAt/completedAt. Indexes (userId, createdAt) and contentId. No prompt, instruction, suggestion text or media bytes are persisted. The explicit owner reference supports per-user preferences and budget locking; authorization still follows Content → Brand → Organization → User.

See [AIG-001–005](contracts/ai-draft-generation.md) for reservation and uncertainty semantics. Generation never updates Content; explicit application uses the existing draft PATCH.

SYN-008 extends AiPreference with imageEnabled (false), imageModel (gpt-image-2.5-flare), imageSize (1024x1024), imageQuality (low). The monthly budget remains shared with text generation.

AiGeneration adds kind (TEXT default / IMAGE), provider (openai), imageSize/quality, inputImageTokens, unique nullable previewKey, previewExpiresAt (indexed), and unique nullable mediaAssetId FK (RESTRICT). Existing text rows and accounting are preserved. For images, inputTokens is text input usage; inputImageTokens tracks image input separately; maxOutputTokens is zero (not an image API setting). An unknown image charge is costUncertain=true, not a free request, even when budgetChargeMicros is zero.

Accepted MediaAsset has one optional generation provenance relation, including provider/model/settings/time. The same private object becomes the accepted asset; no image duplication. No prompt or instruction is persisted. See [IMG-001–007](contracts/ai-image-generation.md).

SYN-AI-003 adds `AI_EDITED` MediaOrigin, optional AiPreference.imageAspectRatio,
and AiGeneration.imageAspectRatio, sourceMediaAssetId (RESTRICT FK to MediaAsset)
and providerGenerationId. One source can have many edited outputs. The source
object and metadata remain untouched; accepting an edit creates a new
MediaAsset from its private preview. The generation record links both source
and accepted output, without storing prompts or image bytes in PostgreSQL.
See [IMG-G001/002](contracts/google-image-generation-editing.md).

## Remaining design draft (not migrated)

The historical broader draft below is not an implementation commitment. Current
single-owner scope supersedes its former membership model. Other planned domain
entities remain unchanged. Every draft table has UUID id and timestamps unless
otherwise noted.

| Entity | Key fields / foreign keys |
|---|---|
| organizations | Implemented as Organization above; status remains outside current scope |
| users | Implemented as User above; profile name/status remain outside current scope |
| brands | Implemented as Brand above; status remains outside current scope |
| brand_profiles | Implemented as BrandProfile above; future AI use remains planned |
| brand_locations | brand_id, name, address, status |
| social_accounts | brand_id, platform, external_account_id, status |
| social_credentials | social_account_id, encrypted_token_ref, scopes, expires_at |
| campaigns | brand_id, title, dates, objective |
| content_ideas | brand_id, campaign_id?, brief, status |
| contents | Implemented as Content above; idea/type and non-draft states remain outside this slice |
| content_revisions | content_id, revision_no, body, created_by, immutable_snapshot |
| content_variants | content_revision_id, platform, caption, status |
| assets | Uploaded originals implemented as MediaAsset above; accepted AI images implemented in SYN-008; other origins remain planned |
| content_assets | Current draft attachments implemented as ContentMedia above; publication variants/purpose remain planned |
| generation_jobs | brand_id, content_id?, type, provider, model, status, cost_usd |
| generation_outputs | generation_job_id, asset_id?, text_output?, metadata |
| publications | content_variant_id, social_account_id, scheduled_at, published_at, status, external_post_id, idempotency_key |
| publication_attempts | publication_id, attempted_at, status, error_code, response |
| products | brand_id, sku?, name, description, status |
| product_facts | product_id, key, value, verified_at, valid_until |
| offers | brand_id, product_id?, location_id?, price, currency, starts_at, ends_at |
| content_reviews | content_revision_id, reviewer_id, decision, reviewed_at |
| audit_events | organization_id, actor_id?, entity_type, entity_id, action, metadata |
| notifications | organization_id, recipient_id, type, payload, read_at |

## Cardinalities
Organization 1:N Brands; User 1:0..1 Organization; Brand 1:N Accounts, Contents, Assets, Campaigns, Products, Locations; Content 1:N Revisions; Revision 1:N Variants and Reviews; Variant 1:N Publications and Content Assets; Account 1:N Publications; Publication 1:N Attempts; Generation Job 1:N Outputs; Product 1:N Facts and Offers.

## Constraints to implement
Implemented: unique organization owner and global slug; unique brand slug within organization. Planned: unique (platform, external_account_id) pending shared-account policy; unique (social_account_id, external_post_id) when present; unique idempotency_key scoped to publication intent. Reviews reference immutable revisions. OAuth secrets never stored in plaintext.

**Open questions:** shared social accounts across brands; whether shops are locations or independent brands; multi-product offers; how generated media is linked to source facts.

### SYN-AI-001 compatibility

The provider catalog is typed backend configuration, not a new database entity.
Existing AiPreference model strings and AiGeneration provider/kind/usage/reservation
records are retained without migration or backfill. Planned provider references
create no records and cannot execute. See [provider foundation](contracts/ai-provider-foundation.md).
