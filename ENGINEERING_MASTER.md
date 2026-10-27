# SYNVARO Engineering Master

**Version:** 0.8 · **Updated:** 2026-10-27 · **Status:** Working engineering index

> **Purpose:** One human-readable entry point for owners, contributors and AI agents. This is an **index, not a second specification**. The linked source documents, code, migrations, CI and PRs remain authoritative for their respective subjects. If sources disagree, raise the conflict; do not silently resolve it here.

## 1. Product and boundaries

SYNVARO is an independent Apache-2.0 open-source AI content studio for preparing, reviewing, scheduling and publishing multi-brand social content. Initial target platforms: Instagram, Facebook, LinkedIn and YouTube; **none of their publishing integrations are implemented yet**. Users bring their own AI provider keys in the planned Community edition. Real pilot contexts are International Safety Inspection Services Türkiye (ISIS), its delicatessen stores, Qos Workspace and Spexop-UI.

**Authoritative references:** [Product](docs/product.md) · [OSS governance](docs/oss-governance.md) · [README](README.md) · [License](LICENSE) · [NOTICE](NOTICE).

## Visual design source

- **Canonical design reference:** [SYNVARO — Design System (Figma)](https://www.figma.com/design/Ft685RzJAeyWKcWkaozawE/SYNVARO-%E2%80%94-Design-System?node-id=0-1). The approved **Chorus / Commons** visual direction and its assets are maintained in Figma.
- **Approved palette:** primary dark `#203D32`, primary light `#C7EE93`, neutral background `#F5F7F2`, main text `#182720`, secondary text `#526158`. Logo wordmark: Outfit Medium 500; exported paths are the implementation source.
- **Implementation boundary:** Do not redraw the logo from generic icons or silently redesign the application. Production assets must be explicitly added to the repository and reviewed in a separate brand-implementation PR; a Figma reference alone does not mean the UI has been updated.

## 2. Development snapshot

| ID       | Scope                                                           | Development state                                               | Evidence and boundary                                                                                                                                                             |
| -------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYN-001  | TypeScript monorepo, web shell, health/OpenAPI, idle worker, CI | Merged into `main`                                              | [PR #1](https://github.com/synvaro/synvaro/pull/1); no product domain functionality                                                                                               |
| SYN-002A | NestJS session-auth technical spike with real PostgreSQL        | Merged into `main`                                              | [PR #2](https://github.com/synvaro/synvaro/pull/2); not unrestricted-public-production auth approval                                                                              |
| SYN-002B | Owner-scoped organization and multiple brands                   | Merged into `main`; local owner walkthrough reported successful | [PR #4](https://github.com/synvaro/synvaro/pull/4) · [Organization & Brand contract](docs/contracts/organization-brand.md)                                                        |
| SYN-003  | Persistent Brand Profile (five context fields)                  | Merged into `main`; owner acceptance not separately recorded    | [PR #6](https://github.com/synvaro/synvaro/pull/6) · [BRP-001 contract](docs/contracts/brand-profile.md) · [CI](https://github.com/synvaro/synvaro/actions/runs/40295510010)      |
| SYN-004  | Brand-scoped manual content drafts (create/list/read/edit)      | Merged into `main`; owner acceptance not separately recorded    | [PR #8](https://github.com/synvaro/synvaro/pull/8) · [CNT-001–004 contract](docs/contracts/content-drafts.md) · [CI](https://github.com/synvaro/synvaro/actions/runs/40301531909) |

**SYN-005 — Private Brand Media Library:** Merged into `main` ([PR #11](https://github.com/synvaro/synvaro/pull/11), [MED-001–004 contract](docs/contracts/media-library.md), [CI](https://github.com/synvaro/synvaro/actions/runs/40311904288)). Private local filesystem uploads, owner-scoped browsing and preview are implemented; no public release or production security acceptance is implied.

**SYN-006 — Content Media Attachments:** Merged into `main` ([PR #13](https://github.com/synvaro/synvaro/pull/13), [CMA-001–005 contract](docs/contracts/content-media.md), [CI](https://github.com/synvaro/synvaro/actions/runs/40318392921)). Same-brand media linking, ordering and detaching are implemented; no AI or publishing features are claimed.

**SYN-007 / SYN-007A — AI text drafts and live acceptance:** Merged into `main` ([PR #15](https://github.com/synvaro/synvaro/pull/15), [PR #16](https://github.com/synvaro/synvaro/pull/16), [AIG-001–005 contract](docs/contracts/ai-draft-generation.md)). Controlled live text-provider acceptance is recorded in [testing evidence](docs/testing.md#syn-007a-live-acceptance--2026-10-26); this does not verify image generation.

**SYN-008 — AI Image Generation:** Merged into `main` ([PR #17](https://github.com/synvaro/synvaro/pull/17), [IMG-001–007 contract](docs/contracts/ai-image-generation.md), [test evidence](docs/testing.md#syn-008-ai-image-generation), [CI](https://github.com/synvaro/synvaro/actions/runs/40369542983)). Private preview, explicit save/attach and provenance are implemented. Selected-budget image requests remain blocked; live image quality/cost acceptance is still unperformed.

**SYN-AI-001 — Multi-Provider AI Foundation:** Merged ([PR #18](https://github.com/synvaro/synvaro/pull/18), [AIP contract](docs/contracts/ai-provider-foundation.md), [CI](https://github.com/synvaro/synvaro/actions/runs/40465572435)). Capability interfaces and an authenticated catalog support existing OpenAI flows.

**SYN-AI-002 — Google Gemini Text:** Merged ([PR #19](https://github.com/synvaro/synvaro/pull/19), [contract](docs/contracts/google-gemini-text.md), [CI](https://github.com/synvaro/synvaro/actions/runs/40471372079)). Selected-budget Gemini requests remain blocked pending a verified upper bound.

**SYN-AI-002A — Live Google acceptance:** **PARTIAL — one live Gemini attempt failed with uncertain usage**; [evidence](docs/testing.md#syn-ai-002a-live-google-acceptance--preflight-2026-10-27). Backup/migration, Free-tier model listing and authenticated Safari desktop/390px preflight passed. The one owner-authorized real request returned no suggestion; its reservation remains uncertain. Original USD 1.00 preference was restored. No Apply or owner acceptance.

**SYN-AI-002B — Gemini failure correction:** Merged ([PR #22](https://github.com/synvaro/synvaro/pull/22), [Google contract](docs/contracts/google-gemini-text.md), [test evidence](docs/testing.md#syn-ai-002b-gemini-failure-correction--2026-10-27)). The 30-second SDK timeout was consistent with the failed 29-second attempt but cannot be confirmed retrospectively. The correction extends deadlines, classifies safe diagnostics and adds audited reservation reconciliation. No paid retest or change to the owner's USD 1 preference.

**SYN-AI-003 — Google images:** **Implemented — PR pending review**; [IMG-G001/002 contract](docs/contracts/google-image-generation-editing.md), [test evidence](docs/testing.md#syn-ai-003-google-image-generation-and-editing--2026-10-27). Google Nano Banana 2.1 adds conceptual generation and same-brand image editing with private preview, explicit save/attach and source provenance. No paid live Google image request; current Synvaro Free-tier project is not locally enabled. The selected USD 1 budget remains fail-closed for images.

**Status vocabulary:** Planned → In development → PR ready → Merged → Owner accepted → Production verified (where applicable). Never infer a later state from an earlier one. `Implemented — PR pending review` denotes code on an open feature PR, not merge or acceptance. GitHub is the authority for current PR/merge/CI state; actual tests and deployment evidence must be checked separately.

## 3. Architecture and decisions

- **Architecture:** TypeScript + pnpm, Next.js/React Studio, NestJS modular monolith API, Prisma/PostgreSQL, independently runnable worker; private local filesystem media; future S3-compatible storage (Cloudflare R2 first cloud candidate) and FFmpeg. No Docker requirement, microservices or Kubernetes in MVP.
- **Current authentication:** NestJS-owned database sessions; one owner per organization and at most one organization per user, with multiple brands. No membership table or RBAC engine at this stage.
- **Security limit:** Process-local rate limiting is accepted **only for development**; production registration is disabled pending hardening. No production launch approval.
- **Still open:** Background queue technology (PostgreSQL vs Redis/BullMQ), brand location scope, infrastructure/secrets/observability vendors, future commercial modules.
- **Storage direction:** Local storage remains the self-host baseline; Cloudflare R2 is the preferred future cloud adapter, not implemented. Google Drive is a planned optional one-way import source; OneDrive/Dropbox are later options, not storage backends. No synchronization is committed.
- **AI usage preference:** The owner has chosen user-controlled generation limits rather than a fixed product-wide content quota. Current AI controls expose user spending/generation preferences, estimated usage and explicit paid intent; image requests with a selected budget remain blocked pending a reliable reservation bound. Operational security protections remain mandatory and separate from user preferences. Environment keys remain server-side; current provider foundation extends SYN-007/008 without changing budget semantics.
- **Publishing invariant:** No publication without approval of the exact immutable content revision; never fabricate real-world product facts or deployed feature claims.

**Source of truth:** [ADR register](docs/decisions.md) (decision statuses) · [Architecture](docs/architecture.md) · [Security](SECURITY.md). **Do not record a new architectural decision by editing this index alone.**

## 4. Domain and data references

| Area                                                 | Current state                                                                                             | Contract / reference                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity & Access                                    | Development implementation (users, sessions)                                                              | [Auth spike](docs/auth-spike.md) · [ADR-013](docs/decisions.md)                                                                                                                                                                                                                            |
| Organization & Brand                                 | Development implementation (single owner, brand CRUD subset)                                              | [Organization & Brand](docs/contracts/organization-brand.md)                                                                                                                                                                                                                               |
| Brand Profile                                        | Development implementation; detailed brand context consumed by explicit AI requests; no approval workflow | [BRP-001](docs/contracts/brand-profile.md) · [Prisma schema](packages/database/prisma/schema.prisma)                                                                                                                                                                                       |
| Content Planning / Production                        | Manual drafts and brand-scoped content–media attachments merged; other features planned                   | [CNT-001–004](docs/contracts/content-drafts.md) · [CMA-001–005](docs/contracts/content-media.md)                                                                                                                                                                                           |
| Media Library / AI Generation                        | Private Media Library and OpenAI text/images merged; Google image generation/editing on review PR         | [MED-001–004](docs/contracts/media-library.md) · [AIG-001–005](docs/contracts/ai-draft-generation.md) · [IMG-001–007](docs/contracts/ai-image-generation.md) · [IMG-G001/002](docs/contracts/google-image-generation-editing.md) · [AIP-001–005](docs/contracts/ai-provider-foundation.md) |
| Review / Publishing                                  | Planned                                                                                                   | [Publishing draft contract](docs/contracts/publishing.md)                                                                                                                                                                                                                                  |
| Social channels, Analytics, Engagement, Integrations | Planned                                                                                                   | [Domain map](docs/domains.md)                                                                                                                                                                                                                                                              |

**Authoritative model:** [Data model](docs/data-model.md) for design intent; [Prisma schema and migrations](packages/database/prisma/) for _implemented_ persistence. These may intentionally differ while features are planned.

## 5. Testing and acceptance

- **Strategy:** [Testing](docs/testing.md) · [Local development](docs/development.md).
- **SYN-001:** [PR #1](https://github.com/synvaro/synvaro/pull/1) / [CI](https://github.com/synvaro/synvaro/actions/runs/40282280351).
- **SYN-002A:** [PR #2](https://github.com/synvaro/synvaro/pull/2) / [CI](https://github.com/synvaro/synvaro/actions/runs/40287587104).
- **SYN-002B:** [PR #4](https://github.com/synvaro/synvaro/pull/4) / [CI](https://github.com/synvaro/synvaro/actions/runs/40291538045). Owner reported a successful local UI edit/persist walkthrough on 2026-10-26.
- **SYN-003:** [PR #6](https://github.com/synvaro/synvaro/pull/6) / [CI](https://github.com/synvaro/synvaro/actions/runs/40295510010). 34 API + 1 worker tests and desktop/390px browser checks reported in PR; separate production acceptance not recorded.
- **SYN-004:** [PR #8](https://github.com/synvaro/synvaro/pull/8) / [CI](https://github.com/synvaro/synvaro/actions/runs/40301531909). PR reports 43 API + 1 worker tests, clean migrations and desktop/390px browser checks; separate production acceptance not recorded.
- **SYN-005:** [PR #11](https://github.com/synvaro/synvaro/pull/11) / [CI](https://github.com/synvaro/synvaro/actions/runs/40311904288). PR reports 58 API + 1 worker tests, five clean PostgreSQL migrations and desktop/390px media tests. The 20 MiB limit, preserved EXIF/container metadata and crash-orphan cleanup limitation remain documented.
- **SYN-006:** [PR #13](https://github.com/synvaro/synvaro/pull/13) / [CI](https://github.com/synvaro/synvaro/actions/runs/40318392921). PR reports 68 API + 1 worker tests, six clean migrations and desktop/390px attachment and isolation checks.
- **SYN-007A:** [Live text acceptance evidence](docs/testing.md#syn-007a-live-acceptance--2026-10-26); two controlled Responses API suggestions. No image-provider acceptance is inferred.
- **SYN-008:** [PR #17](https://github.com/synvaro/synvaro/pull/17) / [implementation CI at 5c06668](https://github.com/synvaro/synvaro/actions/runs/40363544906) / [test evidence](docs/testing.md#syn-008-ai-image-generation). Evidence includes 84 API + 1 worker tests, eight clean PostgreSQL migrations and desktop/390px mock-provider walkthroughs. Follow-up budget regression is linked in the same test evidence; current-head CI belongs to the PR checks. Zero paid image requests; live quality/cost acceptance remains open.
- **SYN-AI-001:** [Evidence](docs/testing.md#syn-ai-001-provider-foundation): 89 API + 1 worker tests, eight clean PostgreSQL migrations, format/lint/typecheck/Prisma/build/smoke and desktop/390px mock-provider flows passed. No live paid provider calls. PR CI is tracked separately.
- **SYN-AI-002:** [Test evidence](docs/testing.md#syn-ai-002-google-gemini-text): real PostgreSQL, deterministic Google/OpenAI SDK and domain mocks, build/smoke and desktop/390px checks; no live Gemini request. PR CI tracked separately. Selected-budget Gemini remains blocked.
- **SYN-AI-002A:** [Preflight and single live-attempt evidence](docs/testing.md#syn-ai-002a-live-google-acceptance--preflight-2026-10-27); backup and eight migrations, Free-tier model listing and Safari desktop/390px check verified. One Gemini request failed with unknown provider charge; original budget restored. Preview and Apply remain open.
- **SYN-AI-002B:** [Correction evidence](docs/testing.md#syn-ai-002b-gemini-failure-correction--2026-10-27) and [PR CI](https://github.com/synvaro/synvaro/actions/runs/40508766641): deterministic delay/timeout/status tests, real PostgreSQL ledger/reconciliation tests and all quality gates passed. No paid Gemini retest; old charge remains uncertain.
- **SYN-AI-003:** [Google image/editing evidence](docs/testing.md#syn-ai-003-google-image-generation-and-editing--2026-10-27): 96 API + 1 worker tests on real PostgreSQL, ten clean migrations, format/lint/typecheck/Prisma/build/smoke; desktop/390px model and editing controls checked. Browser generation click was rejected by automatic approval review, so preview/Save/Attach has integration-test evidence only. PR CI tracked separately. No paid Google image request or live model acceptance.
- CI success means checks ran successfully, **not** live provider integration, production readiness or deployment acceptance.

## 6. Roadmap and next decision gate

[Roadmap](docs/roadmap.md) governs milestone scope. Current progression: OpenAI text/images, provider foundation and Google text merged → Google image generation/editing under review → separately authorized live provider acceptance and spending-bound research. Social publishing remains open. This is sequencing guidance, **not** evidence of implementation or a committed deadline.

Before any new development slice:

1. Read [AGENTS.md](AGENTS.md), this index, and only the relevant contract/ADR.
2. Confirm current `main`, open PRs, existing code and migrations.
3. Define behavior IDs, acceptance criteria and test subjects in the relevant domain contract.
4. Implement narrowly, verify with appropriate evidence, and open a PR.
5. Update the canonical contract/decision/test docs first; update this index in the same PR for every development slice with status, contract, evidence, limitations and next slice.
6. Never deploy or merge based solely on AI claims; owner acceptance is distinct.

## 7. Pending owner / maintainer items

- Verify Google project usage/billing for 2026-10-27 12:23:28–12:23:57 UTC, then reconcile SYN-AI-002A's uncertain reservation only with evidence. The owner reports no connected billing account and an empty invoice, but the conclusion of zero charge is tentative. A second live request needs new owner authorization; the owner's USD 1.00 preference remains unchanged. Preserve the SYN-008 budget limitation and arrange separately authorized image acceptance; mock tests cannot establish live provider success.
- Keep authentication production hardening tracked before any public registration.
- Select job queue only when background generation/publishing requires it; Redis remains an option, not an approved dependency.
- Confirm vulnerability-reporting and main-branch ruleset settings via GitHub administration.
- Avoid introducing duplicated roadmaps, generated status registries or a second source of truth.

**Maintenance rule:** This file should stay concise and navigational. Domain-level detail belongs in the linked human-readable contracts, not here.
