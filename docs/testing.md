# Test strategy v0.1

## Test levels
1. Domain: behavior and invariant checks.
2. Integration: PostgreSQL, storage, queues, provider adapter contracts with mocked provider responses.
3. Live acceptance: real authorized social account, actual remote post ID and media validation.

## Initial subjects
| ID | Subject | Evidence |
|---|---|---|
| ORG-T01 | Cross-organization isolation | access test results |
| BRD-T01 | Brand tone and asset scope | sample previews |
| MED-T01 | Asset provenance | upload metadata |
| AI-T01 | Provider failure and cost recording | job trace |
| REV-T01 | Approval invalidated by content changes | revision and review records |
| PUB-T01..T04 | Publishing contract scenarios | tests and live post IDs |
| SEC-T01 | Token confidentiality | secrets handling test |

Every test must cite behavior/acceptance IDs, expected result, actual result, environment and evidence. A mocked integration test is **not** proof of successful production publishing.

## Implemented SYN-002B verification

The [Organization & Brand contract](contracts/organization-brand.md) defines
ORG-001/002 and BRD-001/002 acceptance IDs. Real PostgreSQL HTTP tests cover owner
uniqueness (including concurrent writes), slug uniqueness, isolation, invalid
inputs, session protection and CSRF. CI replays migrations into a clean PostgreSQL
service. The built Next/Nest smoke verifies organization and multi-brand creation,
editing, reload persistence and logout. Desktop and 390px browser evidence and
actual command results are recorded in the SYN-002B PR, separately from owner
acceptance and production readiness. No mocked database evidence is substituted.

## SYN-003 Brand Profile verification

[BRP-001](contracts/brand-profile.md) maps profile creation, reads, independent
updates, isolation, validation and migration checks to real PostgreSQL tests. The
built Next/Nest smoke covers profile persistence across refreshed SSR. Desktop and
390px browser checks cover form feedback and unsaved-change handling. Command and
CI outcomes are recorded in the PR; no mocked database substitutes are used.

## SYN-004 Manual Content Drafts

[CNT-001–004](contracts/content-drafts.md) maps creation, per-brand lists, retrieval,
partial saves, immutable brand/status, invalid fields, ownership isolation and
session/CSRF regression to real PostgreSQL HTTP tests. Built Next/Nest smoke tests
cover create/save, selected-brand isolation and refreshed SSR. Desktop and 390px
acceptance uses hypothetical copy for Qos Workspace and ISIS Türkiye. CI replays
all migrations on clean PostgreSQL. Actual outcomes and limitations are recorded
in the PR; no mocked persistence or production acceptance is inferred.

## SYN-005 Brand Media Library

[MED-001–004](contracts/media-library.md) maps real PostgreSQL, temporary private
filesystem and HTTP tests to uploads of synthetic JPEG/PNG/WebP/H.264 MP4, binary
integrity, metadata, per-brand lists, range streaming, malformed signatures,
20 MiB boundaries, traversal, interrupted uploads, database rejection cleanup,
owner isolation, expired/revoked sessions and Origin/CSRF regression.
Small generated fixtures under `apps/api/src/test/fixtures/media` contain no customer
media. `ffprobe` must be installed; integration tests never substitute SQLite or
mock persistence. Test storage uses a dedicated `mkdtemp` directory, removed after
execution; that convention is not a production storage default.

`pnpm smoke` exercises the built Next → Nest streaming path, protected original
retrieval and logout. CI installs ffprobe and replays migrations on clean PostgreSQL.
Desktop/390px real browser results and exact command/CI outcomes are recorded in
the SYN-005 PR, separately from production or owner acceptance.

## SYN-006 Content Media Attachments

[CMA-001–005](contracts/content-media.md) maps real HTTP/PostgreSQL tests to image
and video attachments, shared originals, duplicate prevention, ordered retrieval,
atomic reorder validation, detach without deleting bytes, same-brand isolation,
unknown/foreign resources, session/CSRF protection and parent FK cascades.
Concurrent attach/reorder/detach requests exercise the per-content row lock and
stale-membership policy. Existing media/draft regression suites remain enabled.
Tests upload tiny synthetic fixtures into dedicated temporary storage and compare
file inventories and retrieved bytes; no mocked persistence is used.

Built Next/Nest smoke covers all four attachment operations and preserves draft
text. Browser acceptance on desktop and 390px covers two attachments, reorder,
refresh, detach/library retention, Qos/ISIS picker isolation and dirty text across
attachment changes. All migrations are replayed on clean PostgreSQL. Exact results
and CI/browser evidence belong in the SYN-006 PR; production acceptance is separate.

## SYN-007 AI draft generation

[AIG-001–005](contracts/ai-draft-generation.md) is tested against real PostgreSQL
and HTTP with deterministic **mocked external provider** responses. Tests cover
configuration/defaults, strict preferences, profile language/tone, ownership,
CSRF, no automatic Content write, explicit PATCH application, usage persistence,
zero/exhausted budgets, concurrent admission and preference locking, duplicate
request IDs, UTC month rollover, stale pricing, provider failure/timeout and
uncertain reservations. Test time is fixed only on the injected service instance;
production has no clock or mock-provider environment switch.

`pnpm smoke` uses the dedicated `dist/test/ai-preview.js` test executable (guarded
by NODE_ENV=test and a database name ending in `_test`). Only OpenAI is replaced;
Next/Nest/session/PostgreSQL remain real. The normal `dist/main.js` never imports
this executable. CI requires no paid API key and replays all migrations on clean
PostgreSQL. Live provider evidence, if available, must be reported separately from
these tests. Browser desktop/390px review/discard/apply and dirty-edit evidence is
recorded in the SYN-007 PR. No live provider or owner acceptance is inferred.

2026-10-26 local evidence: 76 API tests and 1 worker test passed; format, lint,
typecheck, build, Prisma validation and built Next/Nest smoke passed. All seven
migrations applied to a newly created PostgreSQL 16 test database. Chrome desktop
and 390px covered login, Qos preferences/model/budget, discard first suggestion,
generate again, dirty-body cancel/confirm, preservation of unsaved title, explicit
apply, refresh persistence, ISIS isolation and logout/protected-route redirect.
Mobile document width equalled the 390px viewport. Browser AI responses used the
test provider, not OpenAI. No local OpenAI key was available, so live paid API
verification remains unperformed. CI result is recorded against the PR commit.
