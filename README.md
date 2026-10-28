# SYNVARO

**Open-source AI content studio — Create. Orchestrate. Publish.**

SYNVARO is an independent Apache-2.0 open-source AI Content Studio in development for multi-brand social content. It brings together brand profiles, drafts, private media and controlled AI-assisted creation. [Explore the project page](https://spexop.com/synvaro/).

**Status:** brand and content management, AI creation adapters, social account connection adapters, and controlled Facebook Page, Instagram professional and LinkedIn member publishing code are merged. These are development slices, not a public product release or verified live platform integration. Meta, LinkedIn and Google app consent and real platform publication remain open. YouTube channel connection code is merged; YouTube video publishing has no merged public PR. Scheduling and broader analytics remain roadmap work. See the [engineering status](ENGINEERING_MASTER.md), [testing evidence](docs/testing.md) and [roadmap](docs/roadmap.md).

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
verification commands, behavior IDs and migration conventions. Use Node 22.23.3
and pnpm 10.34.9. No Docker is required.

NestJS-owned authentication is accepted for the current development stage. See
[authentication setup](docs/auth-spike.md) and the [Organization & Brand contract](docs/contracts/organization-brand.md). Production registration is closed until
security hardening; the existing rate limiter is development-only.
