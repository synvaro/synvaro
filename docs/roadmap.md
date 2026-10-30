# SYNVARO roadmap — evidence snapshot (2026-10-30)

No release dates are committed. **Merged code is not the same as owner-accepted or live-verified behavior.** Current implementation and evidence are indexed in [Engineering Master](../ENGINEERING_MASTER.md); the [test record](testing.md) describes actual acceptance. This roadmap tracks milestone outcomes and outstanding gates, not individual PR states.

| Milestone | Scope | Implementation state | Remaining exit gate |
|---|---|---|---|
| **M0 — Foundation** | repository, contracts, governance, CI and authentication | **Merged** — [PR #1](https://github.com/synvaro/synvaro/pull/1), [PR #40](https://github.com/synvaro/synvaro/pull/40), [PR #41](https://github.com/synvaro/synvaro/pull/41) | Independent installation/security and production acceptance are not yet complete |
| **M1 — Studio** | organization, brands, profiles, media, drafts, calendar | **Partial** — organization, brands, profiles, media, attachments and drafts merged; calendar planning/scheduling not accepted | Full owner desktop/390px workflow and calendar capability acceptance |
| **M2 — AI creation** | BYO-key text/image/video/voice adapters, usage preferences, local Reels | **Implemented in code; partial live acceptance** — OpenAI text live accepted; other adapters tested primarily with deterministic mocks | Provider-by-provider live samples, consent/cost accounting, unresolved Gemini usage evidence |
| **M3 — Social publishing** | Facebook, Instagram, LinkedIn member, YouTube OAuth and controlled publishing | **Implemented in code; partial live acceptance** — four publishing slices merged, plus [YouTube safety repair #39](https://github.com/synvaro/synvaro/pull/39). One owner-approved Qos **Facebook Page text** post verified on 2026-10-30 | Last merged [OAuth fix #44](https://github.com/synvaro/synvaro/pull/44) post-fix live acceptance; Facebook image, Instagram, LinkedIn member, YouTube live authorization/publishing; scheduling is **not implemented** |
| **M4 — Insights** | platform analytics and reconciled reporting | **Planned** | Choose minimal metrics and verify live provider access/data |
| **M5 — Community 1.0** | self-host install, security, contributor docs, stable contracts | **In progress** — open-source repository, tests and docs exist | Independent install, operational safety, public registration decision and owner acceptance |

## Immediate execution priorities

1. **M3 — Qos Facebook post-fix acceptance:** verify that the merged OAuth session-return and Meta permission-check changes work in the actual owner browser; retain the existing verified connection; any new public post requires explicit approval of exact content/account.
2. **M3 — Four platform live gates:** Facebook single-image; Instagram professional Page-linked JPEG; LinkedIn **member** (not organization Page); YouTube video/Shorts-eligible upload with **private** default. Verify third-party OAuth/app permissions separately. Mock CI is not live acceptance.
3. **M1/M3 — Studio user experience:** desktop and 390px browser acceptance for account connection and publishing workflows; retain NOT VERIFIED wherever actual evidence is absent.
4. **M2 — AI provider acceptance:** verify costs and unresolved Gemini reservation with independent evidence before another paid request; preserve owner's USD budget preference.
5. **M5 — Public documentation consistency:** align README, Engineering Master and the [Synvaro project page](https://spexop.com/synvaro/) with current evidence; do not imply general production availability.

## Boundaries

Qos is an **industry-independent enterprise management and operations platform**; any use of Qos as a pilot Brand must not misrepresent it as hospitality-specific. SYNVARO itself is an independent multi-brand social content studio.

LinkedIn organization publishing, automatic posting/scheduling, analytics, public multi-user enrollment and commercial hosting are **not delivered features**. No external provider app-review approval or production launch follows from a successful local test.

Commercial SaaS, autonomous campaigns and engagement inbox remain future exploration, not MVP commitments.
