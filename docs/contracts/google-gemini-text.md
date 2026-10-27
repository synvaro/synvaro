# Google Gemini text — SYN-AI-002

## Scope and behavior

AIG-G001: authenticated owners explicitly select Google `gemini-3.8-flash` or
existing OpenAI text in the same preferences and draft workflow. No automatic
fallback; no client key or database credential. Context, user confirmation,
preview/apply, idempotency, sessions, Origin and tenant checks remain AIG-001–005.
Google image/video and other providers remain planned.

AIG-G002: the official `@google/genai` 2.31.0 SDK sends a single non-streaming
GenerateContent request, one candidate, LOW thinking, selected maxOutputTokens,
fixed system instruction, untrusted context, store false, default Standard tier,
30-second timeout and attempts=1. No tools, caching or automatic retries.
An unfinished, blocked, malformed or unexpected model response fails safely.
Provider exceptions and prompts are not exposed or logged. The SDK's Developer API
countTokens mapper rejects systemInstruction, so the adapter uses the official
[REST countTokens endpoint](https://ai.google.dev/api/tokens) with a complete
`generateContentRequest` for input counting. It uses the same context and system
instruction, fixed Google endpoint, API-key header, timeout, no redirects/retries.

## Cost and limits (verified 2026-10-27)

[Model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[thinking and output cap](https://ai.google.dev/gemini-api/docs/generate-content/thinking),
[usage metadata](https://ai.google.dev/api/generate-content),
[pricing](https://ai.google.dev/gemini-api/docs/pricing).
Standard prices are $0.75/M input and $3.75/M output including thinking through
2026-12-31; $1.50/M and $7.50/M thereafter. Estimates and unbudgeted reservations
use the higher future rates, rounded up, with no caching discount. This is an
estimate, not an invoice. Pricing maintenance still expires 2026-11-25.

The counting endpoint documents full-input counting but its own example shows
countTokens 10 versus generation prompt usage 11. No documented conservative
upper bound for that difference was established. Therefore **any selected monthly
spending limit blocks Gemini before dispatch**, including zero; users may explicitly
unset the limit, and the application never unsets it. The catalog says ESTIMATE_ONLY.
This preserves the shared user budget rather than claiming an unsupported hard cap.
OpenAI's existing budget admission and image fail-closed rules are unchanged.

When no budget is selected, returned prompt, candidate and thought usage are
validated together against total and output maximum; candidate+thought tokens are
recorded as output. Missing/ambiguous usage is unknown, not zero. Failed or
uncertain requests retain reservations and block later budgeted OpenAI requests
until reconciled. Shared locks and one active request prevent duplicate paid calls.
Existing rows store provider `google`, model and combined billed output tokens;
no migration. Pricing/usage are estimated, not a provider billing cap.

## Acceptance subjects and limitations

- AIG-G001: catalog status from actual Google configuration, explicit selection,
  missing key, ownership/isolation, shared preferences/ledger and disabled budgets.
- AIG-G002: SDK wire parameters, exact count request including system instruction,
  no retries, correct reasoning usage, missing or malformed usage, model/output
  rejection, failure sanitization and persistence without automatic draft changes.
- Existing real PostgreSQL auth/content/image/OpenAI tests and built Next/Nest
  smoke use deterministic mock providers. Paid live Gemini acceptance is separate
  and was not authorized or performed. Local configuration checks cannot verify
  account entitlement or the actual model response.
- Google free-tier usage may be used to improve its products; account tier and data
  terms must be reviewed before sending sensitive brand context. `store: false`
  controls request logging where supported; it is not a promise about training.
- The conservative bound problem remains open. Future enabling of selected-budget
  Gemini requests requires a documented trustworthy input bound plus tests across
  OpenAI/image charges, concurrent calls and uncertain outcomes.
