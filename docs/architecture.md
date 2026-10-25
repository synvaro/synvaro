# Architecture v0.1

## Shape
Single pnpm TypeScript monorepo; **modular monolith** NestJS REST/OpenAPI backend plus a worker process and responsive Next.js/React studio.

```text
Next.js Web Studio
       |
   NestJS REST API ----- PostgreSQL / Prisma
       |               S3-compatible object storage
    Worker
       +-- AI adapters (text/image/video/voice)
       +-- Social adapters (Meta, LinkedIn, YouTube)
       +-- FFmpeg (assembly, captions, transcoding)
       +-- scheduled publishing / retries
```

## Baseline stack
TypeScript, pnpm, NestJS, Next.js/React, PostgreSQL, Prisma, S3-compatible storage, FFmpeg, REST/OpenAPI. Node 22 compatibility is a starting preference; select a supported LTS for production.

## Decisions requiring confirmation
- Background jobs: PostgreSQL-backed queue versus BullMQ/Redis. No selection finalized.
- Auth implementation: Auth.js versus NestJS-owned authentication.
- Hosting and storage vendor, observability stack, secrets service, AI model defaults.
- Exact social channel scopes, review status and permitted media types per API.

## Security and correctness
Organization-scoped access; encrypted OAuth token references; least-privilege scopes; immutable approved revisions; idempotent publish requests and recovery after ambiguous provider timeouts; brand-level AI budgets; audit records. External social APIs may require app review and permissions.

## Repo direction (not yet created)
```text
apps/{web,api,worker}
packages/{database,contracts,ai-providers,social-providers,media}
docs/
AGENTS.md
```
