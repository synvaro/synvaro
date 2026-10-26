# Decision register v0.1

These are **working decisions from product discussion**, pending consolidated owner sign-off. Accepted means agreed in discussion, not proof of implementation.

| ID | Decision | Status |
|---|---|---|
| ADR-001 | Independent OSS project under synvaro/synvaro | Accepted |
| ADR-002 | Apache-2.0 Community license | Accepted |
| ADR-003 | Modular monolith; no microservices in MVP | Accepted |
| ADR-004 | TypeScript, NestJS, PostgreSQL, Prisma, pnpm | Accepted |
| ADR-005 | Next.js responsive web studio | Accepted |
| ADR-006 | Multi-organization, multi-brand data model; no billing in MVP | Accepted |
| ADR-007 | Provider adapters for AI and social APIs | Accepted |
| ADR-008 | Human approval required for exact revision before publishing | Accepted |
| ADR-009 | BYO AI API keys for Community; meaningful self-hosted use | Accepted |
| ADR-010 | Instagram, Facebook, LinkedIn, YouTube as initial channels | Accepted |
| ADR-011 | S3-compatible media storage and FFmpeg processing | Accepted |
| ADR-012 | PostgreSQL-backed job queue instead of Redis/BullMQ | Proposed |
| ADR-013 | NestJS-owned authentication with Prisma/PostgreSQL sessions | Accepted for current development stage by owner in SYN-002B; production hardening pending |
| ADR-014 | Brand locations in MVP or R1.1 | Open |
| ADR-015 | Future Open Core commercial modules | Proposed; not implemented |
| ADR-016 | Hosting, secrets and observability vendors | Open |

To change an accepted decision: add rationale, alternatives, consequences and owner decision. Never silently overwrite history.

## SYN-002B owner decisions (2026-10-26)

These explicit owner decisions refine the current scope; they do not approve a
production authentication release or overwrite unrelated decisions.

- ADR-013 was Open during SYN-002A. Its NestJS + Prisma + PostgreSQL session
  approach is now accepted for the current development stage.
- ADR-006 remains the multi-organization/multi-brand direction across the system.
  Current scope: one owner per organization, at most one organization per user,
  many brands per organization. No membership table, roles or RBAC engine.
- The existing process-local rate limiter is accepted for development only.
  Redis/distributed limiting, email verification and session cleanup are deferred;
  this does not promote the separate queue proposal ADR-012.
- Unrestricted public production registration is prohibited until security
  hardening. The API rejects registration in production; no runtime opt-in switch
  is supplied by SYN-002B.
- Team management, invitations, organization settings and social/AI domains are
  outside SYN-002B. Ownership and brand slugs cannot be edited in this slice.

## SYN-007 AI usage direction (2026-10-26)

- **Accepted product principle:** Generation frequency and optional spending limits belong to user preferences. Do not impose an arbitrary fixed product-wide monthly generation quota on self-hosted Community users.
- **Accepted boundary:** User controls do not replace mandatory security safeguards, provider restrictions, request validation, or protection from runaway retries and unexpectedly costly single requests.
- **Still open for SYN-007 design:** First provider/model, credential storage scope, availability of trustworthy usage/pricing data, and behavior when a user-configured spending limit is reached. Do not mark implementation choices accepted without review.
