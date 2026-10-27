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

### SYN-007A live acceptance — 2026-10-26

PASS for the real Next.js → NestJS → PostgreSQL → OpenAI workflow on merged
SYN-007 (`97baa62`). A dedicated hypothetical brand/draft in the existing local
organization was used; existing business drafts were not modified. Only synthetic
brand context was sent, with Turkish language, a natural tone and restrictions on
invented commercial claims. No media bytes or personal/customer data were sent.

Provider: OpenAI Responses API, official SDK 7.43.0, model `gpt-6-luna`, standard
tier, reasoning none. Official model/pricing and input-token-count documentation
were rechecked; implementation assumptions were unchanged. No pre-existing AI
preference row existed. The UI saved AI enabled, 512 maximum output tokens,
USD 1.00 monthly estimated budget and confirmation before each paid generation.

| Live suggestion | Input tokens | Output tokens | Estimated USD | State |
|---|---:|---:|---:|---|
| First, discarded | 344 | 44 | 0.000065 | SUCCEEDED |
| Second, explicitly applied | 344 | 41 | 0.000064 | SUCCEEDED |
| Total | 688 | 85 | 0.000129 | No uncertain reservation |

Exactly two generation requests were made, each after the UI confirmation; no
retries or deliberately induced paid failures. The token-count step reserved
USD 0.000299 before each request, then settled to the observed-token estimate.
These are SYNVARO estimates, not provider billed costs or an OpenAI hard cap.

Desktop: preview and discard left the original persisted body unchanged. A second
explicit request on the 390px viewport produced another Turkish suggestion;
Apply saved it through the draft API, and refresh preserved it. The draft remained
DRAFT and no publishing occurred. Mobile document width was 390px. Browser
warning/error logs were empty; visible UI had no credential-like text. Generation
records contain usage/metadata, not keys or complete prompts. Server error handling
was inspected: count failures have no generation reservation; paid failures retain
it; missing usage marks uncertainty; interrupted active requests require operator
reconciliation. No active or uncertain record was cleared. Failure paths were not
provoked live. The existing server terminal does not retain an acceptance log file,
so server-log non-disclosure evidence is limited to the inspected logging code and
previous deterministic security tests, not a captured live terminal transcript.

A minor UI defect was found: Brand Profile still claimed AI was unavailable.
The scoped follow-up replaces that stale sentence with the implemented draft
context behavior. No model, pricing, provider, authentication or generation logic
changes are included. Local browser evidence is kept outside the repository;
no credentials, complete prompts or confidential context are in this report.

## SYN-008 AI image generation

`image.test.ts` exercises IMG-001–007 through authenticated Nest HTTP, real
PostgreSQL and dedicated temporary private storage. Only the image provider is
replaced. Coverage includes disabled/missing configuration, unsupported settings,
strict input/ownership, profile context, explicit confirmation, selected-budget
rejection before any provider call, shared text/image admission locking, request
replay, concurrent idempotent acceptance, no automatic draft mutation, protected
preview bytes, provenance, same-brand attachment, cross-brand/organization
rejection, failure/timeout, malformed/oversized/wrong-size output, unknown usage,
expiry, retryable cleanup failure and preservation of interrupted charge evidence.
Accepted and retrieved bytes are compared exactly; saved/attached files are not
copied. Existing text AI, auth, content and media integration tests remain active.

`image-provider.test.ts` drives the official SDK against deterministic fetch
responses: Images API parameters, base64-only output, unsupported usage breakdown,
no retries on rate limiting and a 30 MiB response-stream boundary. These are wire
contract tests, not proof of a live model response. `pnpm smoke` covers the built
Next → Nest → PostgreSQL → test-provider → private preview → MediaAsset →
ContentMedia flow, binary equality and unchanged draft text. CI has no paid key.

2026-10-26 local acceptance: 84 API tests and 1 worker test passed. All eight
migrations applied to a new PostgreSQL 16 database; the existing test schema also
upgraded forward without resets. Browser Chrome desktop and 390px used a disposable
hypothetical test organization with Qos Workspace and ISIS Türkiye. Four mocked
image requests: first discarded, second saved/attached and recovered after refresh,
third landscape/medium preview discarded on mobile; fourth portrait/high preview
verified immediate shared-usage refresh without making text preferences dirty, then
was discarded. Dirty draft text survived
image actions; text was saved only through its separate Save button. Media Library
and attachments show AI provenance; ISIS lists/pickers exclude Qos assets. Mobile
document width was exactly 390px and protected PNGs decoded correctly. Setting a
USD 1 budget in this disposable account disabled generation with an explicit
explanation. Logout followed by direct file access returned 401. Browser warning/
error logs were empty. A browser-discovered no-result JSON bug was fixed and
covered by a regression test.

**Live image provider evidence: not performed; zero paid image requests.** The
existing real owner's USD 1 preference was not changed. A trustworthy pre-request
cost bound is unavailable, so that selected budget cannot authorize this image
path. Real OpenAI image availability, visual quality and actual usage remain for
a separately authorized limited live acceptance. Mock token/cost values are not
provider billing evidence. Screenshots and local test logs remain outside source;
CI result is recorded against the PR commit. No owner/product acceptance is implied.

### SYN-008 PR #17 review follow-up — 2026-10-26

Rechecked official Flare model, pricing, Images API schema and the current image
cost guide. The [reservation research](contracts/ai-image-generation.md#pr-17-budget-review--2026-10-26)
distinguishes output-cost estimates from a verified total request upper bound.
No reliable bound was established; existing selected-budget blocking and runtime
model/pricing are unchanged. No paid requests or owner preference changes.

Added a real PostgreSQL regression for IMG-002/006: each of the nine supported
size/quality combinations receives two concurrent confirmed requests with a USD 1
monthly preference, prior settled text usage, and text paid-confirmation disabled.
All 18 requests return the documented 409 cost-bound explanation. Provider call
count, the complete preference row and existing shared usage ledger remain
unchanged. API preferences expose the limitation and retain the USD 1 value.

Local suite: 85 API tests and 1 worker test passed. Browser runtime/UI is unchanged;
no new browser or live-provider acceptance is claimed. Current-head CI is linked
from PR #17; earlier screenshots/CI remain evidence for their recorded commit.

## SYN-AI-001 provider foundation

- AIP-001–005: authenticated `/ai/models`, capability-specific selections,
  unavailable configuration and planned-provider exclusion; SDK boundary rejects
  unsupported model/capability/settings before a network call.
- Existing real PostgreSQL text/image/auth/media tests remain the regression suite.
  Catalog reads and invalid preference/model updates are checked against persisted
  preferences and uncertain spending records; no ledger rewrites or migrations.
- API test files run sequentially: each starts an application with a preview
  sweeper against the shared test database. Parallel files with different test
  clocks previously could clear another file's preview metadata. Serial execution
  isolates these sweeps without disabling production cleanup or relaxing assertions.
- Smoke also exercises the authenticated catalog through built Next.js → NestJS;
  existing text Apply and image preview/Save/Attach checks are retained.
- Deterministic provider fixtures are not live API acceptance. No paid calls or
  new Google/ElevenLabs integrations are claimed.

Verification on 2026-10-27:
- Format, lint, typecheck, Prisma validation, build and Next/Nest smoke passed.
- 89 API tests + 1 worker test passed; real PostgreSQL 16, deterministic providers.
- All eight existing migrations applied successfully to a new disposable database;
  no migration or existing-record rewrite introduced by this slice.
- Chrome desktop: login, Qos hypothetical draft, backend-derived model selection,
  planned integrations not selectable, USD 1 image block, explicit text confirmation,
  suggestion Apply and refresh persistence passed.
- Chrome 390×844: preferences retained; only the disposable mock account's budget
  was explicitly cleared to test image confirmation → preview → Save → Attach;
  attachment persisted after refresh. Planned catalog and image panel measured
  document width 390px (no horizontal overflow); logout returned to login.
- Mock usage: one text suggestion (100 input / 50 output, $0.000038 estimate) and
  one synthetic solid-color PNG (100 text input / 0 image input / 200 output,
  $0.006500 estimate). These figures verify UI/accounting only, not billed costs.
- Zero live provider calls. Owner development data, credentials and preferences
  were untouched. Browser test application used ports 43300/43301 and a dedicated
  temporary storage directory; test processes were stopped after verification.
- Local screenshots: `/tmp/syn-ai-001-desktop.png`,
  `/tmp/syn-ai-001-mobile-catalog.png`, `/tmp/syn-ai-001-mobile.png`.

## SYN-AI-002 Google Gemini text

AIG-G001/G002 verification, 2026-10-27: real PostgreSQL 16 and deterministic
OpenAI/Google provider mocks; the Google SDK wire test intercepts HTTP and makes
no live request. Tests cover model selection, ownership, shared accounting,
selected-budget rejection, duplicate/concurrent admission, failure uncertainty,
usage including thinking tokens and SDK no-retry behavior. Existing auth, content,
media and OpenAI regressions remain enabled. No database migration was introduced.

Built Next/Nest smoke verifies Google selection, selected-budget rejection and a
mock suggestion after the disposable account explicitly unsets its limit; OpenAI
text and image regressions remain in the same smoke. Chrome desktop and 390×844
show both text choices, the budget block, Google data notice, mock confirmation,
Discard → Generate Again → Apply and refresh persistence. The mobile document width
was 390px. Browser test data and processes were removed afterward. Only mock output
was used; the local Google key was not configured and no paid or live Gemini test
was attempted. [Contract](contracts/google-gemini-text.md) records the open bound.
