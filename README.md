# SYNVARO

**Open-source AI content studio — Create. Orchestrate. Publish.**

SYNVARO is an independent Apache-2.0 open-source AI Content Studio in development for multi-brand social content. It brings together brand profiles, drafts, private media and controlled AI-assisted creation. [Explore the project page](https://spexop.com/synvaro/).

**Development status (2026-10-30):** Brand profiles, drafts, private media, AI adapters, local Reels assembly, social account connectors and controlled **Facebook Page, Instagram professional, LinkedIn member and YouTube video publishing code** are merged, including the YouTube upload-safety repair. **One owner-approved Qos Facebook Page text post has been verified live.** Facebook image, Instagram, LinkedIn and YouTube live publication are not yet verified. The latest Meta OAuth session-return and permission-reporting fix is [merged in PR #44](https://github.com/synvaro/synvaro/pull/44); post-fix live browser acceptance remains outstanding. Scheduling and analytics are not implemented. This is **not a generally available production product**. See the [milestone roadmap](docs/roadmap.md), [Engineering Master](ENGINEERING_MASTER.md) and [test evidence](docs/testing.md).

## Initial use cases
- International Safety Inspection Services Türkiye (ISIS) corporate communications and delicatessen stores: verified product photos, offers and short videos.
- Qos Workspace and Spexop-UI: factual product announcements grounded in approved releases.

## Principles
- Human approval before publishing; no invented product features, prices, stock or offers.
- Community edition must work independently with self-hosting and bring-your-own-key AI.
- Multi-brand design; commercial hosting/advanced automation deferred.
- Modular monolith, provider adapters and simple operations.

Start with [Product](docs/product.md), [Architecture](docs/architecture.md), [Domains](docs/domains.md), [Data model](docs/data-model.md), [Decisions](docs/decisions.md), [Roadmap](docs/roadmap.md) and [Testing](docs/testing.md).

Contributions are welcome under the [contribution guide](CONTRIBUTING.md). License: [Apache-2.0](LICENSE).

## Development

See [Foundation development](docs/development.md) for setup, environment variables,
verification commands, behavior IDs and migration conventions. Use Node 22.23.4
and pnpm 10.34.9. No Docker is required.

NestJS-owned authentication is accepted for the current development stage. See
[authentication setup](docs/auth-spike.md) and the [Organization & Brand contract](docs/contracts/organization-brand.md). Production registration is closed until
security hardening; the existing rate limiter is development-only.
