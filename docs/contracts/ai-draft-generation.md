# AI Draft Generation — SYN-007

## Scope and decision status

Owner-approved task choices: OpenAI first; server environment API key only; explicit
user requests and review; user-controlled preferences/budget, no fixed monthly
content quota. These refine ADR-007/009 and the SYN-007 principle already recorded
by PR #14. No unrelated ADR or Engineering Master semantic changes; one existing table row is normalized by the required formatter.

Implementation choices for review in this PR: official OpenAI TypeScript SDK,
Responses API, supported model `gpt-6-luna`, reasoning none, standard service tier,
no tools, store false, and no SDK retries. No provider registry or agent framework.
The model/pricing and token-count API were verified on 2026-10-26 against
[model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna),
[pricing](https://developers.openai.com/api/docs/pricing) and
[token counting](https://developers.openai.com/api/docs/guides/token-counting).
These are scoped implementation choices, not a claim of additional owner ADR approval.

## Context and review

- Authenticate and verify Content → Brand → Organization ownership before reading
  context. Require an existing Brand Profile; missing profile gives an actionable
  error. Empty profile fields remain empty, never fabricated.
- Use the saved draft title/body, brand name/short description, all five profile
  fields and ordered attached media metadata. No file bytes, private storage keys,
  user email or other brand data are sent. Metadata is not visual understanding.
- Optional instruction is bounded to 1000 characters. Context is serialized as
  untrusted data in a user message, separate from fixed safety instructions. Brand
  text cannot override system rules. Never invent product facts, prices, discounts
  or released capabilities; hypothetical examples stay explicitly hypothetical.
- Generation returns a separate plain-text suggestion and never mutates Content.
  Discard drops the browser preview; Generate Again is another explicit request.
- Apply calls the existing PATCH draft endpoint only after explicit action. Dirty
  body replacement requires a second explicit decision; unsaved title remains.
  The generation context uses saved text, clearly stated in the UI.

## Preferences and budget semantics

- One AiPreference per User: enabled (default false), model (`gpt-6-luna`),
  maxOutputTokens (default 512, technical range 128–2048), optional monthly USD
  budget (default unset) and confirmPaid (default true). No generation-count quota.
- Budget uses the UTC calendar month of request admission. Zero budget prevents
  paid generation. Lowering budget below existing charge prevents further requests.
- Count exact input tokens through the provider before generation; refuse inputs
  over 16384 tokens or serialized context over 64 KiB. Reserve conservative input
  cost plus the requested maximum output cost before the paid request. Rate version
  2026-10-26: $0.125/M input (covers documented cache-write uplift), $0.50/M output;
  discounts are intentionally ignored. USD micro-units are rounded upward.
- The UI calls this an estimated-spend ceiling, **not billed cost or a provider
  hard cap**. It covers only this SYNVARO user's requests, not external use of the
  shared key, taxes or future pricing changes. Pricing expires after 30 days;
  generation fails closed until a maintainer verifies/updates the rate definition.
- A User row lock serializes preference changes/admission/reservation. At most one
  generation is active per owner across API processes. Preferences cannot change
  during an active request. No lock is held across network calls. A client request
  UUID prevents the same request being submitted twice (409, no second provider call).
- Records progress COUNTING → RUNNING → SUCCEEDED/FAILED; blocked budget requests
  are BLOCKED. Token counting failure incurs no generation reservation. Successful
  usage replaces reservation with observed-token conservative estimate. Missing
  usage or uncertain provider failure retains the full reservation. No automatic
  retry or automatic release after timeout. A crash can leave an active record;
  operator reconciliation after checking provider usage is required, never blindly
  release a reservation that may already have been billed.
- If observed usage exceeds the reservation or the model differs from the requested
  model, mark cost uncertainty and block subsequent budgeted generation until
  reconciled. All uncertain records, including failures and missing usage, block budgeted generation until reconciled, across month boundaries. Missing usage is explicitly labelled; never manufacture token counts.

## Persistence and API

AiPreference stores only preferences. AiGeneration stores owner/content attribution,
request UUID, model, output limit, state, timestamps, usage if supplied, conservative
cost/reservation and a safe error code. No key, complete prompt, instruction, media
bytes or generated text is persisted. A response lost after completion cannot be
replayed; a deliberate new request is needed. Records have restrictive parent FKs
so future deletion must address usage history deliberately.

- GET `/ai/preferences`: preferences, supported model/configuration and current
  UTC-month usage/reservation summary (including uncertainty).
- PUT `/ai/preferences`: strict preference fields only.
- POST `/contents/:id/ai-generations`: `{ requestId, instruction?, confirmed? }`;
  returns suggestion text, model, generation ID, usage and estimated cost details.

All endpoints require sessions. Mutations retain exact Origin/CSRF checks. Foreign
and unknown draft IDs share 404. Provider failures are mapped to safe messages;
raw provider errors, keys, prompts and stack traces are never returned or logged.

## Behaviors and acceptance subjects

| ID | Rule / acceptance and tests |
|---|---|
| AIG-001-A1 | Explicit enabled/configured request generates one editable suggestion; disabled/missing config cannot call provider |
| AIG-002-A1 | Authorized saved draft/profile context includes language/tone/guidelines; metadata only, untrusted user message; missing profile fails |
| AIG-003-A1 | No automatic overwrite; preview/discard/regenerate; explicit Apply persists via existing API; dirty body decision and unsaved title preservation |
| AIG-004-A1 | Read/update conservative preferences, supported model/output validation, optional zero/monthly budget and confirmation semantics |
| AIG-004-A2 | Atomic reservation, concurrent request exclusion, duplicate request UUID, boundary/month rollover and uncertain costs cannot bypass budget |
| AIG-005-A1 | Provider timeout/failure/usage omissions produce sanitized outcomes and durable usage/reservation records |
| AIG-005-A2 | Unknown/foreign resources, unauthenticated access, session/CSRF, strict inputs, no credential/prompt leakage |
| AIG-005-A3 | Real PostgreSQL migration/regressions and deterministic mock provider in CI; desktop/390px preview/apply/isolation; live evidence separate |

## Limitations

No live collaboration/version check, billing integration, per-user keys, provider
billing reconciliation UI, automatic recovery worker, prompt/output history, AI
images/video, publishing or agents. AI suggestions can be inaccurate despite
instructions and must be reviewed. Existing development auth limits remain.
