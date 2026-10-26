# SYNVARO

**Open-source AI content studio — Create. Orchestrate. Publish.**

SYNVARO helps teams prepare, review, schedule and publish brand-safe social content across Instagram, Facebook, LinkedIn and YouTube. AI text, image, video and voice generation use configurable providers and user-owned API credentials.

**Status:** development foundation with session authentication and owner-scoped organization/brand management and persistent brand profiles (SYN-003). Content, AI and publishing capabilities remain planned, not released functionality.

## Initial use cases
- International Safety Inspection Services Türkiye (ISIS) corporate communications and delicatessen stores: verified product photos, offers and short videos.
- Qos Workspace and Spexop-UI: factual product announcements grounded in approved releases.

## Principles
- Human approval before publishing; no invented product features, prices, stock or offers.
- Community edition must work independently with self-hosting and bring-your-own-key AI.
- Multi-brand design; commercial hosting/advanced automation deferred.
- Modular monolith, provider adapters and simple operations.

Start with [Product](docs/product.md), [Architecture](docs/architecture.md), [Domains](docs/domains.md), [Data model](docs/data-model.md), [Decisions](docs/decisions.md), [Roadmap](docs/roadmap.md) and [Testing](docs/testing.md).

Contributions welcome after initial governance and CI are established. License: [Apache-2.0](LICENSE).

## Development

See [Foundation development](docs/development.md) for setup, environment variables,
verification commands, behavior IDs and migration conventions. Use Node 22.23.3
and pnpm 10.34.9. No Docker is required.

NestJS-owned authentication is accepted for the current development stage. See
[authentication setup](docs/auth-spike.md) and the [Organization & Brand contract](docs/contracts/organization-brand.md). Production registration is closed until
security hardening; the existing rate limiter is development-only.
