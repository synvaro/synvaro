# Google image generation and editing — SYN-AI-003

## Purpose and verified provider scope

`gemini-nano-banana-2.1` supports image generation and image-plus-text editing
through the official Google Gen AI SDK Interactions API. Verified 2026-10-27:
[model](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1),
[generation/editing API](https://ai.google.dev/gemini-api/docs/image-generation),
[pricing](https://ai.google.dev/gemini-api/docs/pricing). The initial supported
subset is one inline PNG at `1K` with `1:1`, `4:5` or `9:16` aspect ratio. The
API has no quality parameter; `default` in Studio is only a preference marker.
No tools, search grounding, background jobs, multi-image fusion or retries.
SDK timeout is 120 seconds; the Next.js proxy deadline is 150 seconds.

The model is unavailable on the Google API free tier. The catalog reports
`NOT_CONFIGURED` until a server key, private media storage and an explicit
operator confirmation of paid-tier model access are configured. This local
readiness setting does not prove a live request will succeed. There is no
credential or paid model probe.

## IMG-G001 — Generate image

- An authenticated owner chooses the Google image model for a saved draft with
  Brand Profile, enters a visual instruction and confirms one paid action.
- The result is a protected preview for one hour. It is labeled AI-generated,
  and is neither saved nor attached automatically.
- Discard removes preview bytes but keeps usage history. Save adds a new private
  MediaAsset; optional Attach uses the existing ContentMedia API.
- Unknown and foreign drafts yield the same not-found response. Brand and draft
  context is untrusted input, not authority for product claims.

Acceptance/test subjects: model/catalog readiness, settings, prompt context,
confirmation, idempotency, private preview, save/attach, expiry and isolation.

## IMG-G002 — Edit owned image

- The source must be an existing JPEG, PNG or WebP MediaAsset of the draft's
  brand, at most 10 MiB. The server checks ownership, metadata, signature and
  bytes before sending it to Google. The source ID is recorded on the image
  generation row.
- The user gives a specific edit instruction and explicitly confirms. Studio
  compares the original with the protected preview. AI can alter details:
  packaging, labels, appearance, quantity and identity require human review.
- Save creates a **new** `AI_EDITED` MediaAsset and leaves the source file and
  metadata untouched. Its provenance includes provider, model, provider
  interaction ID, source asset ID, output setting and timestamp. Attach links
  the new asset without copying bytes.
- Unknown, foreign and cross-brand source IDs return the same not-found result.

Acceptance/test subjects: same-brand source, cross-brand and cross-org rejection,
source preservation, provenance, preview/discard, save/attach and file safety.

## Shared spending and limitations

The 2026-10-27 Standard rates are $1.50/M input tokens, $7.50/M text/thinking
output and $30/M image output tokens; a 1K image is listed as 1120 image tokens
or about $0.0336 before input/other output. The model has no free API tier.
The application estimates actual cost only when returned total and modality
usage form a coherent breakdown. Missing or ambiguous usage remains uncertain,
never a billed zero. A conservative total pre-request upper bound, including
variable image input and failure charges, has not been established. Therefore
**any selected shared monthly budget blocks Google image generation and editing
before dispatch**, exactly as for existing OpenAI images. The user's current
USD 1 preference is not changed. Without a selected budget, explicit paid
confirmation remains required; one user action makes one provider request.
No invoice-level guarantee is claimed.

Google may fail despite local readiness due to project/model access or quota.
No real paid Google image request is part of CI or this development slice.
Generated/edited outputs are not guaranteed to preserve product identity or
show an authentic item. No publishing, image variants or asynchronous job
engine is implemented.
