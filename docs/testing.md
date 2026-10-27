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

## SYN-AI-002A live Google acceptance — preflight 2026-10-27

**Preflight result: PARTIAL — no real Gemini request at this stage.**
PR [#19](https://github.com/synvaro/synvaro/pull/19) merged at
`febc64bcc099537e7e5bf837976cab12da9ad44f`; its [CI](https://github.com/synvaro/synvaro/actions/runs/40471372079)
passed. Model `gemini-3.8-flash`, `@google/genai` 2.31.0, LOW thinking,
30-second timeout and no retries remain unchanged. Current official
[model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[pricing](https://ai.google.dev/gemini-api/docs/pricing) and
[thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
documentation were checked; no provider configuration was changed.

- The repository-root launch environment contains `GOOGLE_API_KEY`; its value was
  not read out, logged or transmitted. Availability to the running API process and
  authenticated `/ai/models` status were not verified. Studio displayed login.
- Read-only PostgreSQL inspection found one AI preference: OpenAI `gpt-6-luna`,
  enabled, 512 output tokens, USD 1.00 monthly estimate and confirmation enabled.
  No preference was changed. Only seven migrations are applied locally; the
  `20261026161445_ai_image_generation` migration is absent. A current Prisma read
  including image preference fields failed because those columns are absent. No
  migration, restart or database repair was performed.
- Google AI Studio showed the Synvaro project on Free tier and its spend view
  said billing is not set up. The local key's association with that project was
  not verified, and applicable project-level spending controls were not established. Do not infer the configured key's tier
  from that display. No billing or project settings were modified.
- There was no authorization in this preflight to unset the spending preference or
  send a paid request. There are no live input/output/thinking counts, estimated
  costs, provider responses, Apply/persistence, desktop/mobile live acceptance or
  budget restoration results to report. A separate owner decision and verified
  project controls are required before proceeding.
- Existing [SYN-AI-002 mock and real-PostgreSQL evidence](#syn-ai-002-google-gemini-text)
  remains regression evidence only, not proof of live Gemini or current local setup.
  The current usage record combines candidate and thinking tokens as `outputTokens`;
  it does not independently persist the thinking-token breakdown.

### Infrastructure continuation — 2026-10-27

**Result: PARTIAL; zero generation requests.** The repository remained on the
documentation-only SYN-AI-002A branch. The owner authorized local backup,
forward-only migration, API restart and non-generating provider checks; the
USD 1.00 monthly preference was not changed.

- PostgreSQL 16 source `synvaro` had seven of eight committed migrations.
  Before migration, a mode-0600 custom-format backup was written to
  `/private/tmp/synvaro-2026-10-27T08-59-30-606Z.dump` (SHA-256
  `e8fb766d317f0b266e615772eb05a3303fb18435aa25ffc056fecad30499ef3b`).
  A full `pg_restore` into a disposable database succeeded; counts matched
  across User 1, Session 3, Organization 1, Brand 3, BrandProfile 1,
  Content 1, ContentMedia 0, MediaAsset 0, AiPreference 1, AiGeneration 2
  and migration history 7. The disposable database was removed. A verified
  SHA-identical, mode-0600 copy is retained outside the repository at
  `~/Library/Application Support/Synvaro/backups/synvaro-2026-10-27-pre-image-migration.dump`
  in a mode-0700 directory; it was not committed.
- `pnpm db:deploy` applied only `20261026161445_ai_image_generation`;
  `prisma migrate status` now reports eight migrations and an up-to-date
  schema. Post-migration Prisma reads succeeded. Existing record counts were
  unchanged; AI preference remained `gpt-6-luna`, 512 output tokens,
  `monthlyBudgetMicros=1000000`, confirmation enabled, image generation
  disabled. No database reset or preference edit occurred.
- The local `GOOGLE_API_KEY` matched the **masked suffix** of the Synvaro
  project key shown in Google AI Studio, and did not match the other listed
  project key. The key value was not printed or copied. With that key, the
  non-generating Gemini `ListModels` call returned HTTP 200 and listed
  `gemini-3.8-flash` with `generateContent` support. This establishes
  key/model listing access, not a successful generation response.
- Google AI Studio showed this Synvaro project on **Free tier**, with no
  billing set up. Its model-specific rate-limit table showed Gemini 3.8 Flash
  at 5 RPM, 250K input TPM and 20 RPD, with zero peak use in the displayed
  28-day period. Google's [billing](https://ai.google.dev/gemini-api/docs/billing),
  [pricing](https://ai.google.dev/gemini-api/docs/pricing) and
  [rate-limit](https://ai.google.dev/gemini-api/docs/rate-limits) docs confirm
  Free-tier input/output for this model, per-project quotas, and that
  billing setup is required to enter a paid tier. Free-tier content may be
  used to improve Google products. These observations are time-sensitive;
  Free tier is not a SYNVARO budget guarantee and project spend caps are
  not a billing hard cap.
- The API was rebuilt and restarted from the repository-root `.env`;
  `GET /health` returned 200 and the Nest startup log mapped
  `GET /ai/models`. An unauthenticated request through NestJS and Next.js
  returned 401. The Chrome session was at `/login`; the owner then signed
  in normally through Safari. The authenticated Safari session loaded
  `/api/ai/models` and the existing hypothetical test draft. The Studio
  model selector showed OpenAI and selectable
  `google · gemini-3.8-flash` (its UI only enables `AVAILABLE` entries
  from the backend catalog). Model selection was reverted before saving.
  The USD 1.00 preference, paid confirmation, draft title and body remained
  unchanged. Safari Responsive Design Mode at 390×874 showed the AI controls
  in a single-column layout; no visible horizontal overflow was observed.
  The desktop view was also usable. No database session token was extracted
  or substituted.

The owner confirmed the local Google credential is a test key and chose to
retain it for this acceptance. Its full value is not included in this
evidence or PR. The owner subsequently authorized temporarily removing the
USD 1.00 preference, keeping paid confirmation enabled, sending at most one
real Gemini generation request, and restoring the original preference.

Before any preference save or generation, Safari computer use was stopped by
an automatic approval review usage-limit error while opening the model menu.
The review could not complete; it did not judge the action unsafe. No alternate
control path was used. Read-only PostgreSQL verification afterward showed
`gpt-6-luna`, 512 output tokens, `monthlyBudgetMicros=1000000`, paid
confirmation enabled and two existing AI generation records. API health
remained 200. **Zero live Gemini generation requests** were sent; no usage,
cost, preview, Apply or persisted Gemini result is claimed. Resume the
approved one-request flow only after the computer-use approval limit clears.

### Single live attempt — 2026-10-27

**Current result: PARTIAL — one real Gemini generation attempt failed with
uncertain provider usage; no suggestion or Apply.** After the owner requested
a retry, Safari computer use worked again. A separate Studio tab preserved
an existing OpenAI suggestion preview. The authenticated hypothetical
`SYN007A Test Kitchen` draft had a `tr-TR` Brand Profile, tone and guidelines.
Before the Gemini attempt, one additional successful OpenAI usage row was
observed; it was not attributed to this acceptance.

- The Studio saved `gemini-3.8-flash` with the monthly SYNVARO limit temporarily
  unset, while paid-generation confirmation remained enabled and the
  512-token output preference remained unchanged. The owner-approved
  hypothetical Turkish breakfast instruction was entered. The Studio showed
  its confirmation screen; **Confirm paid generation was clicked once**.
  No automatic or manual retry followed.
- The single `AiGeneration` row
  `a7cd1e7e-5898-4c19-8acd-3b2b9d00826f` identifies provider `google`,
  model `gemini-3.8-flash`, status `FAILED`, error code `PROVIDER_FAILED`
  and `costUncertain=true`. It ran from 12:23:28 to 12:23:57 UTC.
  Pre-request token counting recorded 319 input tokens; no actual
  generation output or thinking usage was returned. The provider may have
  processed the request before failure, so actual billing is **unknown**.
  The existing USD 0.004319 reservation remains in `budgetChargeMicros`;
  it was not cleared or represented as a billed cost. The elapsed time is
  consistent with the configured 30-second timeout but does not establish
  the provider-side cause.
- Studio displayed a sanitized provider-unavailable/timeout message and
  reported one uncertain-cost request. No suggestion preview was returned,
  so Discard and Apply could not be tested. The draft title remained
  `Weekend Breakfast Inspiration`; its body SHA-256 remained
  `4f883fc8d1c0091087f98c19539c6f7d868ca07b79337f5468aa5dfd2a7cdb72`.
  No publishing action occurred.
- Immediately after the failed attempt, the Studio restored and PostgreSQL
  confirmed the original preference: OpenAI `gpt-6-luna`, 512 output tokens,
  `monthlyBudgetMicros=1000000`, paid confirmation enabled, and unchanged
  image settings. The uncertain row now blocks budgeted generation until
  operator reconciliation. Do not clear its reservation automatically or
  issue another potentially charged request without new owner authorization.

No provider response text, actual output/thinking tokens, billed USD amount,
successful Apply or persisted Gemini draft can be claimed from this attempt.

## SYN-AI-002B Gemini failure correction — 2026-10-27

**Diagnosis:** The 2026-10-27 Gemini attempt lasted 29.4 seconds and the
installed `@google/genai` 2.31.0 adapter had a 30-second HTTP deadline.
The SDK source confirms that deadline aborts a single HTTP attempt, while
`retryOptions.attempts=1` disables retries. Timeout is the leading cause, but
the old row contains only `PROVIDER_FAILED`; no historical HTTP status or
exception category was retained, so the exact cause cannot be proven. The
Next.js proxy had a separate 70-second deadline for both sequential phases:
up to 30 seconds of counting and 30 seconds of generation, plus application
work. The Studio itself sets no shorter fetch deadline.

**Correction:** Gemini generation now has a 60-second SDK deadline, token
counting remains 30 seconds, and the Next.js text generation proxy has a
105-second deadline (15 seconds beyond the two phase limits). Automatic
retries remain disabled. Google failures are classified into timeout, rate
limit, authentication, permission, unsupported request, server error,
malformed response or other provider error. The row stores a category code;
logs contain only generation ID, provider, model, phase, elapsed milliseconds,
category and HTTP status where available. Raw provider bodies, prompts and
credentials are excluded. Failed generation retains its reservation.

**Persistence and regression:** An isolated local PostgreSQL database
`synvaro_auth_test` was created and all nine forward-only migrations applied
from empty. Deterministic Google SDK tests passed for delayed response,
timeout with exactly one transport call, HTTP error classes, malformed output
and sanitized diagnostics. Real PostgreSQL tests passed for HTTP generation
failure classification, retained uncertain reservation and the operator-only
reconciliation transaction. The new audit row records the prior reservation,
verified charge, evidence reference and operator, and rejects a second
reconciliation. Full local suite: **94 API + 1 worker tests passed**; format,
lint, typecheck, Prisma validation and build passed. Built Next/Nest smoke
passed against the isolated test database with mocked providers. CI is
tracked on the corrective PR. No paid Gemini call was made for this fix.

**Historical usage review:** Google AI Studio usage/billing for the Synvaro
project at 2026-10-27 12:23:28–12:23:57 UTC remains unverified in this task.
A broad Safari state read was rejected by automatic approval review because
the browser might expose the open API-key details tab; a narrowly targeted
`aistudio.google.com/usage` tab lookup could not run because Safari was not
available through the computer-use browser interface. No credential was
retrieved, no charge was inferred, and generation
`a7cd1e7e-5898-4c19-8acd-3b2b9d00826f` remains `FAILED` with
`costUncertain=true` and its USD 0.004319 reservation intact. The existing
USD 1 monthly preference was not changed. An authorized operator must obtain
independent provider usage/billing evidence before running
`node --env-file=.env scripts/reconcile-ai-generation.mjs <generation-id> <charged-micros> <evidence-reference> <operator>`
after applying the migration and building the API/database packages. A zero
charge requires explicit evidence. A further paid live request requires new
owner authorization; the corrected flow has not passed live acceptance.

The owner subsequently reported that no billing account was connected to the
Synvaro Google project and its invoice was empty. This supports a zero-charge
hypothesis but is not request-level usage/billing evidence; the owner described
the conclusion as tentative. The historical reservation remains unchanged.
The corrective PR's [CI](https://github.com/synvaro/synvaro/actions/runs/40508766641)
passed with nine clean PostgreSQL migrations and all quality gates.

## SYN-AI-003 Google image generation and editing — 2026-10-27

**Scope and provider evidence:** The official Google Gen AI SDK 2.31.0 adapter
uses the `gemini-nano-banana-2.1` Interactions image API for generation and
image-plus-text editing. The implemented subset is PNG at 1K with 1:1, 4:5 or
9:16 aspect ratio. Model, request and Standard pricing were checked against
the [model reference](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1),
[image guide](https://ai.google.dev/gemini-api/docs/image-generation) and
[pricing](https://ai.google.dev/gemini-api/docs/pricing) on 2026-10-27.
The local project has no confirmed paid-tier model access; no Google image
request was made. SDK wire and application acceptance use deterministic mocks,
not live provider evidence.

**Database and tests:** All ten forward-only migrations applied to a fresh,
isolated PostgreSQL database `synvaro_google_image_test`. The same new migration
was also applied to the existing isolated `synvaro_auth_test` without resetting
its data. The full suite passed with **96 API + 1 worker tests** on real
PostgreSQL. Google image SDK tests check request settings, inline image input,
response/usage extraction, malformed responses and one-call rate-limit failure.
Integration tests check brand context, Google generation and editing, preserved
source bytes, new `AI_EDITED` asset provenance, private preview/save/attach,
same-brand authorization and shared-budget blocking. Existing OpenAI image,
OpenAI/Gemini text, Media Library, auth and CSRF regressions also passed.
Format, lint, typecheck, Prisma validation and production build passed. Built
Next/Nest smoke passed against the isolated database; it exercises the existing
auth, organization, content and media path with mocked AI providers. The
initial [PR #23 CI run](https://github.com/synvaro/synvaro/actions/runs/40514622449)
passed all gates, including clean migration, tests, build and smoke.

**Browser check:** A dedicated hypothetical account, organization, brand,
profile and draft were created through local Next.js/NestJS on the isolated
test database. On desktop, the Studio displayed the backend-supplied OpenAI
and Google image models, saved the Google model and 1K/aspect preference, and
showed the editing source selector with the correct empty state. At 390px,
model/settings, generation action and cost notice remained visible and usable
without horizontal overflow. The browser automation's automatic approval
review rejected clicking Generate because it could not establish from the
page that the action was mock-only. The backing API was the test-only
`ai-preview` executable with both Google image methods replaced by deterministic
PNG mocks, but this did not establish approval for that browser action. Thus
browser preview/Save/Attach was **not** verified in this walkthrough; API and
real-PostgreSQL integration tests provide separate mock-flow evidence. The
test servers were stopped afterward.

**Spending and acceptance boundary:** The existing USD 1 monthly preference
was not changed. Image requests remain blocked while any monthly budget is
selected because a conservative total pre-request bound is not established.
Missing or ambiguous usage is recorded as uncertain; it is not claimed as a
zero provider charge. No paid Google image calls, live model acceptance or
production verification occurred. Desktop and 390px browser verification is
reported separately from the mocked API tests.
## SYN-AI-004 ElevenLabs voice generation — 2026-10-27

- Branch: `feat/syn-ai-004-elevenlabs-voice`; implementation is pending PR review.
- Official API/model verification: `eleven_multilingual_v2` Turkish TTS,
  synchronous `/v1/text-to-speech/:voice_id`, premade voice listing via
  `/v2/voices`, `mp3_44100_128`, response `character-cost` and `request-id`
  where available. References and limits are in
  [VOC-001–006](contracts/elevenlabs-voice-generation.md).
- Applied all 11 forward-only Prisma migrations on a **clean isolated real
  PostgreSQL** `synvaro_voice_test` database. No existing user data was reset.
- Format, lint, typecheck, Prisma validate and build passed. Full tests:
  **102 API + 1 worker**, zero failures. The new real-PostgreSQL voice test
  covers preferences, selected-budget block, session and organization isolation,
  voice/model validation, Turkish MP3 preview, exact bytes, save/attach, draft
  preservation, concurrent request rejection, discard, expiry and malformed
  output. Deterministic HTTP adapter tests cover voice filtering, bounded MP3,
  timeout and provider errors.
- [PR #24 CI at implementation commit](https://github.com/synvaro/synvaro/actions/runs/40528145948)
  passed its PostgreSQL migration, test, build and smoke gates. CI uses
  deterministic provider responses and no paid ElevenLabs key.
- Built Next.js → NestJS → PostgreSQL smoke passed with a deterministic local
  audio provider. It checked selected-budget refusal before generation, Origin
  rejection, voice listing, protected preview, save to private Media Library,
  attachment without copying bytes and unchanged saved draft body. This is
  **mock-provider evidence**, not a live ElevenLabs response.
- Chrome desktop and 390px walkthrough on the isolated test database: registered
  a hypothetical account/brand/draft, enabled the voice preference, selected
  the mock premade Turkish voice, explicitly confirmed generation, saw the
  protected player and character usage, saved the MP3, attached it and
  refreshed. The saved title/body and audio attachment remained visible.
  The 390px voice selector, narration field, player and attach control stayed
  usable without horizontal overflow. This verifies rendered Studio behavior
  with a deterministic provider, not real ElevenLabs voice quality.
- No paid ElevenLabs request was made. Account entitlement, voice quality,
  commercial-use rights and actual USD charges remain unverified. The owner's
  existing USD 1 monthly preference and historical Gemini uncertainty were
  not altered. With any selected USD ceiling, voice generation stays blocked.

## SYN-AI-005 Google video generation — 2026-10-27

[VID-001–006](contracts/ai-video-generation.md) maps text-to-video,
same-brand image-to-video, private preview, explicit save/attach, recovery,
spending and isolation to real PostgreSQL and deterministic Google responses.
All 12 forward-only migrations applied to a **clean isolated real PostgreSQL**
`synvaro_video_test` database. Existing user data and the owner's USD 1
preference were not touched.

Local integration suite: **104 API + 1 worker tests, zero failures**. The
video test exercises session/Origin checks, brand context, foreign draft/source
404s, selected-budget refusal before a provider call, duplicate request IDs,
concurrent admission with only one provider start, pending-to-completed
observation after refresh, private byte/range retrieval, usage estimate,
missing-usage uncertainty, invalid MP4 rejection, preview expiry, AI_VIDEO
provenance, save/attach, source/draft preservation and discard. A separate SDK
test verifies background create/get request parameters,
one call per action, timeout/rate classification, rejection before network for
unsupported settings and no raw provider error in the safe classification.
Credit-only ElevenLabs uncertainty remains recorded while USD budgeted OpenAI
text remains usable; an uncertain USD image charge still blocks admission.

Built Next.js → NestJS → PostgreSQL smoke passed with a deterministic Google
video provider. Chrome desktop walkthrough on the isolated test database used
a hypothetical account, brand profile and saved draft: explicitly generated a
text-to-video preview, played the protected MP4, saved and attached it, then
refreshed and observed the attachment. A synthetic PNG was uploaded to the
same brand; image-to-video showed the unchanged source beside the protected
result and saved the new MP4 privately. At 390px the source and video previews,
model/settings and controls remained usable with no horizontal overflow
(`innerWidth` and document scroll width both 390px). The browser used local
deterministic output, not Google. No publication or draft-text modification
occurred. The owner's account and USD 1 preference were not used or changed.

These are **mock-provider tests**; they do not demonstrate live Google model
access, actual video quality, actual token usage or billed cost. The current
Google project has no confirmed paid video access. No paid video request was
made. CI results remain separate from local tests and browser evidence.
