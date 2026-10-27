# AI Image Generation — SYN-008

## Purpose and decisions (2026-10-26)

Generate one conceptual social visual from an owned saved draft and its Brand
Profile, review it, then explicitly save and optionally attach it. No approval
entity exists: the owner's saved profile and explicit request supply context;
this slice does not add a profile approval workflow. No editing, reference-image
reproduction, real-product photography claims, video, agents or publishing.

OpenAI Image API `/v1/images/generations`, official SDK, model
`gpt-image-2.5-flare`. Sunburst was evaluated but adds no required workflow benefit
for this initial slice. Supported subset: `1024x1024`, `1536x1024`, `1024x1536`;
`low`, `medium`, `high` quality; PNG, opaque background, moderation auto, n=1,
no streaming/partials, no retries, 120-second provider timeout. Defaults: disabled,
Flare, square, low. Verified against [model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare),
[API](https://developers.openai.com/api/reference/resources/images/methods/generate)
and [cost guide](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency).
These are scoped implementation choices for review, not new unrelated accepted ADRs.

## IMG-001 — Generate brand-aware image

Require an authenticated owned Content and existing Brand Profile. Include saved
draft title/body, brand name/summary, all profile context and explicit instruction
(1–1000 characters). Context is untrusted JSON within a fixed visual instruction;
no secrets, user identifiers, media bytes or outside brands. Bound the complete
prompt to 32000 characters / 64 KiB. Never invent verified certifications, labels,
packaging, discounts, product details or release claims. Prompts ask for conceptual,
editorial, atmospheric or generic imagery, not authentic shop products. Human
review remains necessary; instructions cannot guarantee factual output.

Acceptance/tests: valid owned context; language/tone/guidelines included; missing
profile, invalid instruction and foreign/unknown draft rejected before provider.

## IMG-002 — Respect preferences

Extend AiPreference with imageEnabled, imageModel, imageSize and imageQuality.
Reuse the existing optional monthly spending preference and shared account usage;
no second budget system or generation-count quota. Every image request requires
explicit paid confirmation even when text confirmation is disabled.

The verified rates are USD 5/M text-input tokens, 8/M image-input tokens and 30/M
image-output tokens. Direct Images API does not use cached-input discounts. The
published calculator is an estimate, not a documented guaranteed output-token
ceiling; this endpoint has no max-output-token parameter. Therefore no trustworthy
pre-request total bound is claimed. **Any selected monthly budget (including zero)
blocks image generation before the paid request.** The UI explains this rather
than silently bypassing the budget. An owner may explicitly unset the shared
budget in preferences; the application never does so automatically. Existing text
budget behavior is preserved. Pricing expires 2026-11-25 pending review.

Acceptance/tests: defaults, supported settings, explicit consent, selected-limit
fail-closed behavior with zero provider calls, concurrent preference/generation
locking. Live verification requires separate owner spending permission; a selected
local budget is not disabled for testing.

### PR #17 budget review — 2026-10-26

**Finding: a trustworthy pre-request total reservation was not established from
current official documentation. Retain the existing fail-closed rule.** This is
a documented usability limitation, not evidence that budgeted images are impossible
in a future provider contract.

- The [Flare model page](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
  publishes token rates; it also warns against transferring GPT Image 2 calculator
  consumption to GPT Image 2.5. Older-model per-image tables are not Flare bounds.
- The [current cost guide](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)
  labels its size/quality calculator as an estimate and excludes input tokens from
  image-output cost. It recommends measuring actual response usage. It does not
  establish a guaranteed maximum billable token count for our nine combinations.
- The [Images generation request schema](https://developers.openai.com/api/reference/resources/images/methods/generate)
  exposes size, quality and image count, but no maximum output-token or request-cost
  control. Our fixed n=1, no partial images, bounded prompt and timeout constrain
  requests; they do not independently prove a monetary ceiling.

| Supported size | low | medium | high |
|---|---|---|---|
| 1024x1024 | No verified total bound | No verified total bound | No verified total bound |
| 1536x1024 | No verified total bound | No verified total bound | No verified total bound |
| 1024x1536 | No verified total bound | No verified total bound | No verified total bound |

Engineering conclusion: a guessed multiplier or a few live samples cannot prove
coverage of future requests. Do not reserve an arbitrary value, silently remove
a USD 1 text budget, or treat explicit confirmation as permission to bypass it.
No paid research requests were made. Model, prices and runtime behavior are unchanged.

Reopening criterion: verified model-specific bounds for the complete input and
output cost, including failure/uncertain-charge handling. Only then reserve against
shared text/image spending under the existing user-row lock before dispatch,
settle from returned usage, and test concurrency at the selected budget boundary.
The current regression covers all nine settings with concurrent requests, zero
provider calls, an unchanged USD 1 preference and unchanged existing usage ledger.

## IMG-003 — Preview and accept

POST `/contents/:id/image-generations` takes requestId, instruction and confirmed.
GET `/image-generations/:id` returns safe status/usage and protected preview availability;
GET `/image-generations/:id/file` streams validated PNG. No public provider URLs.
DELETE `/image-generations/:id` discards only an unaccepted preview. Use unique
(userId, requestId) and the existing per-user row lock; one active text/image
request per user. One unaccepted preview per user bounds retained output; save,
discard or expiry permits the next request. This is a transient storage safety
limit, not a monthly content quota. A failed/lost browser response can be recovered
with GET `/contents/:id/image-generations/latest` without another provider call (JSON object with `generation: null` when none exists).

Acceptance/tests: independent protected preview, discard, recovery, duplicates,
no Content mutation; unknown/foreign result IDs share 404.

## IMG-004 — Save to Media Library

POST `/image-generations/:id/accept` creates one MediaAsset with AI_GENERATED
origin. Repeated acceptance is idempotent. Revalidate format/dimensions/size before
accepting. Provenance includes OpenAI, configured model, generation ID, timestamps,
size/quality and conceptual authenticity label. No complete prompt persisted.
Reuse the same storage key atomically in metadata; no copy or overwrite.

Acceptance/tests: binary integrity, one asset after concurrent/repeated acceptance,
provenance, no library visibility before Save, no duplicate file.

## IMG-005 — Attach saved image

Use the existing ContentMedia POST API with the saved asset ID. Only same-brand
owned drafts may receive it. Save and Attach are separate explicit actions;
attachment failures do not remove the saved asset. Draft text is untouched.

Acceptance/tests: same-brand attach, cross-brand/organization rejection, media
survives detach and refresh, unsaved text preserved by UI state.

## IMG-006 — Usage, cost and error handling

Reuse AiGeneration with kind TEXT/IMAGE. Image request output settings, provider,
optional real token counts and conservative estimated micro-USD are recorded.
No text-token pricing rule is reused for image output. Valid usage estimates use
text input × 5 + image input × 8 + image output × 30 micro-USD; unsupported usage
breakdowns yield unknown cost, never a fabricated estimate. Charges also appear
in shared usage and subsequent text budget checks.

An image call cannot reserve an unknown bound: its record starts RUNNING with
costUncertain=true, charge=0 explicitly meaning unknown, not free. Successful
known usage settles that flag; failures/missing usage retain uncertainty and
block subsequent budgeted text generation until operator reconciliation. API
errors are sanitized. No automatic retries, refunds, or reset of uncertain/active
records. A crashed RUNNING record requires operator reconciliation.

Acceptance/tests: success usage, failure/timeout, missing/invalid usage, shared
accounting, duplicate/concurrent requests; mocks and live evidence distinguished.

## IMG-007 — Isolation, bytes and cleanup

All operations enforce sessions, exact Origin/CSRF for mutations, and ownership.
Output is base64 from the official SDK, never an arbitrary remote URL fetch.
Bound the provider JSON body to 30 MiB before buffering, decoded output to the
existing 20 MiB media maximum. Validate signature, full sharp decode, static PNG,
exact requested dimensions and existing pixel limits before exposing/saving.
Use the existing private MediaStorage staging/publish/read/remove implementation.
Opaque server UUID keys; no filesystem paths or keys in browser metadata.

Preview expires after one hour; expired bytes are inaccessible immediately. API
startup and a 60-second sweep remove expired unaccepted staged/published output
in batches of 50, using the same user-row lock as acceptance/discard. Ordinary
failures compensate files. Save retains the original; discard/expiry never remove
accepted assets. If the API is stopped cleanup resumes on restart. A process
crash during a filesystem/DB boundary can leave an inaccessible file for the next
sweep; keep record keys until successful removal and reconcile interrupted active
charges manually. No generic queue or independent storage subsystem.

Acceptance/tests: real PostgreSQL and dedicated temporary storage; malformed,
oversized/wrong-dimension output, discard/expiry cleanup, interrupted records,
accept/cleanup race, ownership, no keys in responses, auth/media/text regressions.

## Limits

One provider/model; three sizes/qualities; no generation history UI beyond latest
result recovery, no profile approval/versioning, semantic authenticity guarantee,
editing, processing, public links, billing reconciliation UI or publishing.
A saved AI visual is clearly labelled conceptual and must not be represented as
an authentic product photo. Selected-budget image generation remains unavailable
until a trustworthy reservation strategy is verified and reviewed.
