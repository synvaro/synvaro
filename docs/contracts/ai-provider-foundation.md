# AI Provider Foundation — SYN-AI-001

## Purpose and scope

A provider is an API service, a model is its named implementation, a capability is
one supported task, and execution is an explicit request to a supported model.
A catalog row represents one provider/model/capability combination. A vendor's
advertised capabilities do not imply an implemented SYNVARO adapter.

This owner-requested refinement of ADR-007 preserves SYN-007/008 endpoints,
preferences, records and behavior. No database migration or new provider SDK is
required. No automatic routing, orchestration, publishing or provider discovery.

## Behaviors and acceptance

| ID | Rule | Acceptance / test subjects |
|---|---|---|
| AIP-001 | Backend owns a typed catalog | Authenticated GET /ai/models returns model, provider, capability, settings, verification date and cost capability; no secrets; Studio uses it |
| AIP-002 | Availability is truthful | AVAILABLE requires an implemented adapter, credentials and required storage/pricing configuration; NOT_CONFIGURED is implemented but missing prerequisites; PLANNED never executes even when its key exists |
| AIP-003 | Execution is capability-specific | Text/image interfaces bind existing OpenAI adapters; unknown models, wrong capabilities and provider injection rejected before paid requests; no fallback |
| AIP-004 | Preserve usage and workflows | Existing PostgreSQL preferences/ledger, shared budget, uncertain charges, duplicate prevention, context isolation, text Apply and image Save/Attach regressions pass |
| AIP-005 | Studio selection is safe | Only implemented models appear in selectors; unavailable options are disabled; planned integrations informational only; desktop/390px remain usable |

## Implemented versus planned (verified 2026-10-27)

Executable combinations are Google `gemini-3.8-flash` text, OpenAI `gpt-6-luna` text and
`gpt-image-2.5-flare` image generation. Parameters and prices are unchanged:
Responses API, reasoning none, standard tier, store false; Images API n=1 PNG,
opaque, moderation auto, three existing sizes and low/medium/high quality.
[Text model](https://developers.openai.com/api/docs/models/gpt-6-luna) and
[image model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare).

Google `gemini-nano-banana-2.1` image generation/editing and ElevenLabs
`eleven_multilingual_v2` speech are implemented adapters, subject to local
configuration and the selected-budget fail-closed rules. See
[Google images](google-image-generation-editing.md) and
[ElevenLabs voice](elevenlabs-voice-generation.md).

Reference-only planned combinations:
- Google `gemini-omni-1.1-flash` video and image-to-video:
  [official model](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash).
  Veo 3.1 preview was shut down October 22; it is not a supported selection.
- OpenAI Flare image editing is reference-only. Other video providers remain
  future research, without speculative executable model identifiers.

These references are not commitments to a next model or proof of account access.
Reverify model access, parameters and pricing when implementing each adapter.

## Adapter and configuration contracts

Capability-specific TypeScript interfaces live under the API AI providers folder.
Nest injection tokens bind the existing concrete text/image SDK adapters through
useExisting; business services depend on interfaces. Explicit supported-model
checks prevent passing arbitrary identifiers to the SDK. No dynamic registry.
Future asynchronous video contracts are types only: no fake adapters, API routes
or polling loops. Video start returns a provider
operation ID; retrieval returns pending, failed or completed bounded bytes/usage.
Future callers must authorize and reserve before start, preserve uncertain charges
across interruption, and validate/store results privately. Provider operation IDs
are server-side provenance, not authorization credentials.

OPENAI_API_KEY, GOOGLE_API_KEY and ELEVENLABS_API_KEY are consumed server-side
by their implemented adapters. The ElevenLabs speech adapter lists premade
voices and makes one bounded, non-retried synchronous TTS call.
No credentials in catalog, browser, database or logs. AVAILABLE means local
prerequisites are present, not a paid health check or proof of provider entitlement.
Catalog reads never contact providers and use no-store responses.

## Accounting responsibilities

The domain services retain authorization, context construction, transactions,
preferences, reservations, usage settlement and private preview lifecycle.
Adapters perform bounded provider calls with no retries. OpenAI text can reserve a conservative bound. Google text and images are estimate-only; selected-budget execution fails closed. Missing/invalid usage remains uncertain, never free.
The catalog distinguishes CONSERVATIVE_BOUND, ESTIMATE_ONLY and UNAVAILABLE.
Any selected spending ceiling continues to block image generation before dispatch.
Text and image charges share the existing user ledger and lock. Catalog availability
is independent of user enablement, selected budget and active request conflicts.
Pricing review expiry remains November 25; catalog verification does not extend it.

## Limitations

OpenAI text/image, Google text/image/editing and ElevenLabs speech have
implemented adapters; video and image-to-video are unimplemented. No database-managed credentials,
voice cloning, billing system, automatic retries or live provider claims. Future
adapters must implement their own validated pricing/reservation semantics before
being admitted to budgeted execution. Existing development-only auth limitations
and SYN-008 cleanup/uncertain-charge limitations remain in their canonical contracts.

Google details and counting limitation: [SYN-AI-002](google-gemini-text.md).
