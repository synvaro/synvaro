# Brand Profile — SYN-003

## Purpose and owned entity

BRP-001 — Manage Brand Profile. One Brand has zero or one BrandProfile, holding
owner-authored context for future content generation. This slice stores and edits
context only: no AI, marketing strategy, approvals or version history.

Brand.description remains the short brand-card summary (existing 2000-character
limit unchanged). BrandProfile.description is detailed context about what the
brand does and offers. Neither field overwrites or automatically copies the other.

## Business rules

- BrandProfile has UUID id, unique brandId FK, description, targetAudience,
  toneOfVoice, defaultLanguage, contentGuidelines, createdAt and updatedAt.
- The four text fields are trimmed, bounded to 4000 characters each; omitted
  fields on creation start empty. Empty string clears a text field. Text is stored
  as plain text and rendered as text, not HTML.
- Default language starts null rather than inferring a business preference.
  Supplied language is trimmed, at most 100 characters, validated and canonicalized
  using Node's [`Intl.getCanonicalLocales`](https://tc39.es/ecma402/#sec-intl.getcanonicallocales) (Unicode BCP 47 locale tags, e.g. tr-TR,
  en-GB, zh-Hant). Null clears it; an empty string is invalid at the API boundary.
  This is structural validation, not an IANA registry or translation-support check.
  Private-use-only and grandfathered tags outside the Intl locale grammar are not supported.
- GET `/brands/:id/profile` returns `{ profile: null }` for an owned brand without
  a profile. Otherwise it returns `{ profile }`.
- PUT on the same path creates or updates only supplied fields, returning 200.
  At least one field is required. Omitted existing fields are preserved; this
  partial-update PUT semantics is deliberate to support independent field edits.
- Authentication is required. Ownership comes only from the session; unknown
  fields/ownership injection are rejected. Unknown and foreign brand UUIDs return
  the same 404 for reads and writes. Malformed UUIDs return 400.
- The parent Brand write includes organization owner scope and a nested profile
  upsert. PostgreSQL enforces unique brandId; its FK cascades on Brand removal.
  No deletion endpoint or ownership changes are added.
- Existing Origin/CSRF checks remain. Only profile payloads have a 64 KiB JSON
  body cap in both Next proxy and Nest; existing 8 KiB limits remain elsewhere.
  Oversized requests return 413; field-limit violations return 400.

## Acceptance criteria and test subjects

| ID | Scenario | Expected result / evidence subject |
|---|---|---|
| BRP-001-A1 | Owner opens brand without profile | 200 null; clear empty state in Studio |
| BRP-001-A2 | Owner saves first fields | One persisted profile for that brand; no invented defaults |
| BRP-001-A3 | Owner saves individual fields, clears values, repeats save | Omitted fields and Brand summary unchanged; one row; language canonicalized |
| BRP-001-A4 | Unknown/foreign brand GET or PUT, including brand without profile | Identical 404; no read disclosure or write |
| BRP-001-A5 | Invalid language, type, extra fields, excessive text/body | 400/413 and no mutation; valid multilingual text accepted |
| BRP-001-A6 | Anonymous or missing/foreign Origin mutation | 401/403; existing session and CSRF protections preserved |
| BRP-001-A7 | OpenAPI and clean database | Documented GET/PUT, response/input schemas; all migrations apply |
| BRP-001-A8 | Save through Next Studio, then refresh | Values persist through Next → Nest → PostgreSQL and refreshed SSR |
| BRP-001-A9 | Edit without saving, discard or leave | Unsaved status; explicit discard confirmation; link/logout and page-unload warnings |
| BRP-001-A10 | Desktop and 390px viewport | Readable labeled fields, save/error feedback, no horizontal overflow |

## Verification and known limitations

`apps/api/src/test/brand-profile.test.ts` covers A1–A7 through real HTTP/PostgreSQL.
The existing auth and organization/brand regression suites remain enabled.
`scripts/smoke.mjs` covers Next proxy, Unicode payload, partial update and refresh
persistence. CI replays migrations on a clean PostgreSQL 16 service. Actual results
and desktop/mobile observations are recorded in the SYN-003 PR, not assumed here.

The editor sends changed fields only, preserves draft values on failure and warns
before discarding/leaving. Drafts are not autosaved or persisted offline. Browser
unload prompts depend on browser support and prior user interaction; forced app
termination cannot be guarded. Concurrent edits to the same field are last-write-wins;
there is no versioning or conflict-resolution workflow. No profile completeness
requirement, approval or AI use is implemented. Production auth hardening remains
outside this slice.
