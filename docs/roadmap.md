# SYNVARO Roadmap — 2026-10-30

**Purpose:** Evidence-based development plan. No committed delivery dates. A merged PR or passing CI does **not** establish production readiness, provider authorization, or live acceptance. Sources: [Engineering Master](../ENGINEERING_MASTER.md), [testing evidence](testing.md), and linked GitHub PRs.

| Milestone | Implemented in `main` | Remaining acceptance or implementation | Status |
|---|---|---|---|
| M0 — Foundation and security | TypeScript monorepo, PostgreSQL, CI, owner bootstrap, TOTP ([#1](https://github.com/synvaro/synvaro/pull/1), [#40](https://github.com/synvaro/synvaro/pull/40), [#41](https://github.com/synvaro/synvaro/pull/41)) | Production security/operations and independent installation acceptance | Implemented; release acceptance open |
| M1 — Studio | Organizations and Brands, Brand Profile, drafts, private Media Library, media attachments ([#4](https://github.com/synvaro/synvaro/pull/4), [#6](https://github.com/synvaro/synvaro/pull/6), [#8](https://github.com/synvaro/synvaro/pull/8), [#11](https://github.com/synvaro/synvaro/pull/11), [#13](https://github.com/synvaro/synvaro/pull/13)) | Full owner desktop/390px acceptance; calendar is **not** implemented | Core implemented; acceptance open |
| M2 — AI and Reels | OpenAI text/images, Gemini text/images/video, ElevenLabs voice, local FFmpeg Reels ([#15](https://github.com/synvaro/synvaro/pull/15), [#17](https://github.com/synvaro/synvaro/pull/17), [#19](https://github.com/synvaro/synvaro/pull/19), [#23](https://github.com/synvaro/synvaro/pull/23), [#24](https://github.com/synvaro/synvaro/pull/24), [#25](https://github.com/synvaro/synvaro/pull/25), [#26](https://github.com/synvaro/synvaro/pull/26)) | OpenAI text has live acceptance; other AI provider acceptance, uncertain Gemini usage and budget constraints remain open | Implemented; live acceptance partial |
| M3 — OAuth and controlled publishing | Brand-scoped Meta/LinkedIn/YouTube connections; Facebook text/photo, Instagram professional photo, LinkedIn member text/photo, YouTube video and resumable-safety correction ([#27](https://github.com/synvaro/synvaro/pull/27), [#28](https://github.com/synvaro/synvaro/pull/28), [#30](https://github.com/synvaro/synvaro/pull/30), [#32](https://github.com/synvaro/synvaro/pull/32), [#34](https://github.com/synvaro/synvaro/pull/34), [#37](https://github.com/synvaro/synvaro/pull/37), [#39](https://github.com/synvaro/synvaro/pull/39)) | One Qos Facebook Page **text post** accepted live (2026-10-30). Post-fix Meta OAuth acceptance, Facebook photo, Instagram, LinkedIn and YouTube live acceptance still open. Scheduling not implemented | Implemented; live acceptance partial |
| M4 — Planning and insights | No scheduling/calendar or reconciled analytics implementation claimed | Scope and implement scheduling/calendar and platform-reconciled basic analytics after provider acceptance | Planned |
| M5 — Community 1.0 | Public Apache-2.0 repository, documentation and contributor guidance | Independent self-host installation, security, provider setup, release support and real browser acceptance | Not released |

## Immediate sequence

1. **[SYN-ACC-001 — Meta connection acceptance](https://github.com/synvaro/synvaro/issues/46):** Verify the return/session/permission changes merged in [PR #44](https://github.com/synvaro/synvaro/pull/44) in the running environment. Preserve the existing Qos Facebook Page connection. A real image post requires separate owner approval for the exact content.
2. **[SYN-ACC-002 — Other platform acceptance](https://github.com/synvaro/synvaro/issues/47):** Establish account/app access for Instagram professional, LinkedIn member and YouTube, then verify real OAuth, scopes, tokens and controlled publication separately. Never infer live authorization from deterministic provider mocks.
3. **[SYN-ACC-003 — Studio acceptance and readiness](https://github.com/synvaro/synvaro/issues/48):** Validate desktop and 390px user journeys, current owner MFA and runtime release, without assuming CI means deployment acceptance.
4. **Documentation alignment (also [SYN-ACC-003](https://github.com/synvaro/synvaro/issues/48)):** Keep this roadmap, [README](../README.md), [Engineering Master](../ENGINEERING_MASTER.md), GitHub public profile and the [Synvaro project page](https://spexop.com/synvaro/) consistent with evidence.

## Non-goals for this acceptance phase

No automatic posts, new social adapters, generalized orchestration, premature public signup or release claims. LinkedIn **organization** publishing is not yet implemented (member publishing is); Instagram requires a Page-linked professional account in the implemented flow. Shorts is a YouTube classification, not a separate upload endpoint.

## Status vocabulary

**Planned → Implemented / merged → Owner accepted → Production verified** are distinct gates. Mark individual provider, UI and runtime acceptance independently. GitHub PR/CI history is authoritative for merges and automated tests; actual provider/production acceptance requires direct evidence.
