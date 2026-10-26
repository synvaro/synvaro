# SYNVARO Engineering Master

**Version:** 0.4 · **Updated:** 2026-10-26 · **Status:** Working engineering index

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

**Status vocabulary:** Planned → In development → PR ready → Merged → Owner accepted → Production verified (where applicable). Never infer a later state from an earlier one. GitHub is the authority for current PR/merge/CI state; actual tests and deployment evidence must be checked separately.

## 3. Architecture and decisions

- **Architecture:** TypeScript + pnpm, Next.js/React Studio, NestJS modular monolith API, Prisma/PostgreSQL, independently runnable worker; private local filesystem media; future S3-compatible storage (Cloudflare R2 first cloud candidate) and FFmpeg. No Docker requirement, microservices or Kubernetes in MVP.
- **Current authentication:** NestJS-owned database sessions; one owner per organization and at most one organization per user, with multiple brands. No membership table or RBAC engine at this stage.
- **Security limit:** Process-local rate limiting is accepted **only for development**; production registration is disabled pending hardening. No production launch approval.
- **Still open:** Background queue technology (PostgreSQL vs Redis/BullMQ), brand location scope, infrastructure/secrets/observability vendors, future commercial modules.
- **Storage direction:** Local storage remains the self-host baseline; Cloudflare R2 is the preferred future cloud adapter, not implemented. Google Drive is a planned optional one-way import source; OneDrive/Dropbox are later options, not storage backends. No synchronization is committed.
- **AI usage preference:** The owner has chosen user-controlled generation limits rather than a fixed product-wide content quota. Future AI UI must allow user-configured spending/generation preferences, show estimated and observed usage when available, and require explicit intent for paid requests. Operational security protections remain mandatory and separate from user preferences. Detailed provider/key implementation is scoped to SYN-007.
- **Publishing invariant:** No publication without approval of the exact immutable content revision; never fabricate real-world product facts or deployed feature claims.

**Source of truth:** [ADR register](docs/decisions.md) (decision statuses) · [Architecture](docs/architecture.md) · [Security](SECURITY.md). **Do not record a new architectural decision by editing this index alone.**

## 4. Domain and data references

| Area                                                 | Current state                                                                                                 | Contract / reference                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Identity & Access                                    | Development implementation (users, sessions)                                                                  | [Auth spike](docs/auth-spike.md) · [ADR-013](docs/decisions.md)                                      |
| Organization & Brand                                 | Development implementation (single owner, brand CRUD subset)                                                  | [Organization & Brand](docs/contracts/organization-brand.md)                                         |
| Brand Profile                                        | Development implementation; detailed description, target audience, tone, language, guidelines; no AI behavior | [BRP-001](docs/contracts/brand-profile.md) · [Prisma schema](packages/database/prisma/schema.prisma) |
| Content Planning / Production                        | Manual drafts and brand-scoped content–media attachments merged; other features planned                      | [CNT-001–004](docs/contracts/content-drafts.md) · [CMA-001–005](docs/contracts/content-media.md)    |
| Media Library / AI Generation                        | Private local Media Library implemented; AI Generation planned                                                | [MED-001–004](docs/contracts/media-library.md) · [Domain map](docs/domains.md)                       |
| Review / Publishing                                  | Planned                                                                                                       | [Publishing draft contract](docs/contracts/publishing.md)                                            |
| Social channels, Analytics, Engagement, Integrations | Planned                                                                                                       | [Domain map](docs/domains.md)                                                                        |

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
- CI success means checks ran successfully, **not** live provider integration, production readiness or deployment acceptance.

## 6. Roadmap and next decision gate

[Roadmap](docs/roadmap.md) governs milestone scope. Candidate progression: SYN-007 opt-in AI draft text generation → later AI media creation → social channels and publishing. This is sequencing guidance, **not** evidence of implementation or a committed deadline.

Before any new development slice:

1. Read [AGENTS.md](AGENTS.md), this index, and only the relevant contract/ADR.
2. Confirm current `main`, open PRs, existing code and migrations.
3. Define behavior IDs, acceptance criteria and test subjects in the relevant domain contract.
4. Implement narrowly, verify with appropriate evidence, and open a PR.
5. Update the canonical contract/decision/test docs first; update this index **only if milestone status or links materially change**.
6. Never deploy or merge based solely on AI claims; owner acceptance is distinct.

## 7. Pending owner / maintainer items

- Define SYN-007 AI text-draft contract: explicit user action, user-configurable generation/spending preferences, bring-your-own-key, safe provider failure handling and no automatic publishing.
- Keep authentication production hardening tracked before any public registration.
- Select job queue only when background generation/publishing requires it; Redis remains an option, not an approved dependency.
- Confirm vulnerability-reporting and main-branch ruleset settings via GitHub administration.
- Avoid introducing duplicated roadmaps, generated status registries or a second source of truth.

**Maintenance rule:** This file should stay concise and navigational. Domain-level detail belongs in the linked human-readable contracts, not here.
