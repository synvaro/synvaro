# Data model v0.1

## Implemented development schema (SYN-004)

The Prisma schema and migrations implement only these six models. UUID keys and
UTC timestamps are used; authentication secrets are hashes, not plaintext.

| Model | Fields and constraints |
|---|---|
| User | id, unique email, passwordHash (Argon2id), createdAt, updatedAt |
| Session | id, unique tokenHash (SHA-256), userId FK, createdAt, expiresAt, revokedAt |
| Organization | id, unique ownerUserId FK to User, name, globally unique slug, createdAt, updatedAt |
| Brand | id, organizationId FK, name, slug, nullable description, createdAt, updatedAt; unique (organizationId, slug) |
| BrandProfile | id, unique brandId FK, description, targetAudience, toneOfVoice, nullable defaultLanguage, contentGuidelines, createdAt, updatedAt |
| Content | id, brandId FK, title (200), body text (empty allowed), status DRAFT, createdAt, updatedAt; index (brandId, updatedAt DESC, id DESC) |

Brand 1:N Content. Content brand is immutable through the API; no duplicate owner/organization FKs.

Brand 1:0..1 BrandProfile. Profile text is detailed context; Brand.description remains a separate short summary.

User 1:0..1 Organization; Organization 1:N Brand. There are no membership,
role or permission tables. Foreign keys cascade on parent removal to avoid
orphans; no user/organization/brand deletion API is exposed in this slice.

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
| assets | brand_id, storage_key, mime_type, origin, metadata |
| content_assets | content_variant_id, asset_id, position, purpose |
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
