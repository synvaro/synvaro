# ElevenLabs voice generation — SYN-AI-004

Verified 2026-10-27 against the official [model guide](https://elevenlabs.io/docs/overview/models/),
[synchronous TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[voice listing API](https://elevenlabs.io/docs/api-reference/voices/search),
[response cost headers](https://elevenlabs.io/docs/api-reference/introduction/) and
[billing guidance](https://elevenlabs.io/docs/overview/administration/billing).
`eleven_multilingual_v2` supports Turkish, up to 10,000 characters per provider
request. This slice limits a single narration to 2,000 Unicode characters and
12 KiB UTF-8. The synchronous endpoint returns `mp3_44100_128`; no queue or
automatic retry is used. Generated MP3 is capped at 5 MiB and 10 minutes.
Commercial use requires the applicable paid ElevenLabs plan and rights to the
input text. A Creator subscription does not by itself prove this API key has
available credits or a particular voice entitlement.

| Behavior | Business rule and acceptance/test subject |
|---|---|
| VOC-001 — Text to speech | Authenticated owner opens a saved draft, copies its saved body into an independently editable narration field and explicitly generates one MP3. The Content row is unchanged. Turkish sample and saved-body separation are tested. |
| VOC-002 — Voice selection | Backend lists account-visible **premade** voices; only IDs from a fresh list can be used. Names and model-specific verified languages are displayed when returned; no language inferred from names. If listing is restricted, an optional configured ID is accepted only after the provider's voice detail endpoint confirms it is premade. Missing/invalid ID and empty list are tested. |
| VOC-003 — Private preview | Output is validated as MP3 by signature and ffprobe, stored in private MediaStorage, owner-only streamed, and expires after one hour. Discard and expiry remove preview bytes but keep usage history. Unauthorized, foreign, malformed and expired results are tested. |
| VOC-004 — Save and associate | Save creates one new `AI_VOICE` MediaAsset with ElevenLabs model, voice ID, source Content ID and provider request ID where supplied. Existing ContentMedia attaches it without copying bytes. Save is idempotent; source draft and other brands remain unchanged. |
| VOC-005 — Spending and usage | Shared `AiPreference.speechEnabled` controls use. An explicit paid confirmation and one request ID are required. A selected USD budget blocks TTS before dispatch: `character-cost` is provider usage, **not** a reliable USD invoice or reservation bound. Successful/failed usage stays `costUncertain` with null USD estimate; reported character cost is shown separately. Concurrent active requests and duplicate IDs are rejected. No fixed count quota. |
| VOC-006 — Security and isolation | Session, Origin/CSRF, owner-scoped draft/result/file access, bounded text/audio and sanitized errors. Credentials, narration text and raw provider error bodies never appear in API responses, logs or generation records. Only premade voices are admitted; cloning and impersonation are outside scope. |

## Persistence and endpoints

One forward-only migration adds `SPEECH` to the generation kind, `AI_VOICE` to
MediaOrigin, an opt-in speech preference, and generation voice/character-cost
metadata. Existing AiGeneration preview, request uniqueness, shared ledger,
MediaAsset and ContentMedia relationships are reused. The narration text is
sent to ElevenLabs but is **not** persisted in the generation row.

- GET `/ai/voices`
- POST `/contents/:id/speech-generations`
- GET `/contents/:id/speech-generations/latest`
- GET `/speech-generations/:id` and `/speech-generations/:id/file`
- POST `/speech-generations/:id/accept`
- DELETE `/speech-generations/:id`
- Existing POST `/contents/:id/media` attaches the accepted asset.

## Limitations

The `character-cost` response header may be absent; absence stays unknown.
Provider account quota and billable USD cannot be established from a server key
alone. The selected monthly USD ceiling therefore blocks voice generation,
including the owner's existing $1 preference. No paid ElevenLabs call, voice
quality judgment or account entitlement is claimed by mock tests. A process
crash between private file publication and metadata commit can leave an orphan,
as with existing generated images; backup storage and PostgreSQL together.
No voice cloning, subtitles, audio editing, publishing or public media URLs.
