# Local development

This development build includes session authentication, owner-scoped organizations and brands, brand profiles, manual content drafts and the SYN-005 private Media Library. AI generation and publishing remain planned.
For current authentication setup and security boundaries, read [Authentication spike](auth-spike.md).
Existing specifications and ADR statuses remain authoritative.

## Local setup

Use Node **22.23.3** (`nvm use`) and **pnpm 10.34.9**. Node 22 is a supported
maintenance LTS line; the pinned version matches local and CI verification.
Install pnpm with your preferred package manager or Corepack.
No Docker, Redis or global Nest/Prisma CLI is required.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# Configure the dedicated PostgreSQL DATABASE_URL in .env first.
pnpm db:deploy
pnpm dev:web
# Separate terminals, from the repository root:
pnpm dev:api
pnpm dev:worker
```

Open <http://127.0.0.1:3000>, <http://127.0.0.1:3001/health>,
<http://127.0.0.1:3001/docs> and <http://127.0.0.1:3001/openapi.json>.
The worker stays idle and exits cleanly on SIGINT/SIGTERM. It has no queue,
polling work or publishing capability.

API and worker scripts load the root `.env` through Node's environment-file
support. Existing process environment variables take precedence. Prisma loads
the same file relative to its config. Next.js uses its standard per-app `.env.local`
convention, and the auth transport uses `WEB_ORIGIN` and `API_INTERNAL_URL` (see `apps/web/.env.example`). Never put secrets in
`NEXT_PUBLIC_*`: those values are public browser configuration.

| Variable       | Default / requirement                                                     |
| -------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`     | API: `development`, `test` or `production`; defaults to `development`     |
| `API_HOST`     | `127.0.0.1`; explicitly set `0.0.0.0` when a network listener is needed   |
| `API_PORT`     | `3001`; integer 1–65535                                                   |
| `DATABASE_URL` | Required for API and Prisma; local example is not a production credential |

The web development/start scripts bind to loopback. Override Next's hostname
argument when intentionally hosting on a network. Do not commit environment files.
`/health` is **process liveness**, not database or provider readiness. Unknown API
routes and errors return `{ statusCode, message }`; unexpected failures return a
sanitized 500 response. OpenAPI documents health and the authentication spike.
The Studio and API auth identity endpoint now require a valid database session.

## Database and migrations

Install PostgreSQL natively or use an existing development instance. Create a
dedicated database/user and set `DATABASE_URL` before future database work. For
example, with PostgreSQL command-line tools and appropriate local permissions:

```sh
createuser --pwprompt synvaro
createdb --owner=synvaro synvaro
pnpm db:validate
```

The Prisma 7 schema contains User, Session, Organization, Brand, BrandProfile, Content and MediaAsset. Ownership follows the approved single-owner scope; no membership/role tables exist. The [auth spike](auth-spike.md) documents migration setup and limitations.
The API and auth integration tests require PostgreSQL; mocks are not substituted.

Generate subsequent migrations only for explicitly scoped schema changes:

```sh
pnpm db:migrate --name <descriptive_change>
pnpm --filter @synvaro/database migrate:status
```

Review and commit generated SQL under `packages/database/prisma/migrations/`
together with the schema. `migrate dev` is for a disposable development database
and needs a shadow database (or appropriate create-database permission). Never use
it against shared or production data. Do not edit already-applied migrations.
Release automation will use `pnpm db:deploy` after review and backup/recovery
planning. Production deployment remains outside this spike. Migration replay is verified
on an isolated PostgreSQL test database and in CI.

## Quality and behavior evidence

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:validate
pnpm test
pnpm build
pnpm smoke
```

CI runs these commands after a frozen-lockfile install on Ubuntu with the pinned
Node/pnpm versions. Tests use Node's built-in test runner after TypeScript compilation.
No external social or AI providers are called. Authentication tests need a real
PostgreSQL database ending in `_test` with committed migrations applied. `smoke` uses loopback ports 43100
and 43101; these ports must be free.

| Behavior ID | Expected result                                                                    | Evidence command                       |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| SYN-001-A1  | HTTP health returns 200 and the documented liveness body; OpenAPI describes health | `pnpm test` (real local HTTP)          |
| SYN-001-A2  | Valid API config loads; malformed ports/environment/host are rejected              | `pnpm test` (unit)                     |
| SYN-001-A3  | 404 is consistent; unexpected errors do not expose internal details                | `pnpm test` (HTTP 404 and unit filter) |
| SYN-001-A4  | Worker starts without API/database/queue and terminates cleanly                    | `pnpm test` (child process)            |
| SYN-001-A5  | Built web/API start; home and four placeholder routes work; unknown section is 404 | `pnpm smoke` (real local HTTP)         |

Actual run outcomes and CI links are recorded in the SYN-001 PR. These checks
prove foundation behavior only, not domain, database, provider or owner acceptance.

## Boundaries and next work

`apps/web`, `apps/api`, `apps/worker`, `packages/database` and `packages/contracts`
match the requested structure. Contracts currently hold health/error and public auth types;
the API owns their OpenAPI representation. A shared strict TypeScript baseline
uses NodeNext for server packages and Next's bundler mode for the web.

Queue choice (ADR-012), location semantics (ADR-014),
commercial modules (ADR-015) and vendors (ADR-016) remain unresolved or proposed.
Auth (ADR-013) is accepted for current development. One owner per organization
and one organization per user are enforced; no membership or RBAC engine exists.
See the [Organization & Brand contract](contracts/organization-brand.md) for current
behaviors. No Spexop-UI, provider adapters or AI generation capabilities are included.

## Private media storage (SYN-005)

Set `MEDIA_STORAGE_ROOT` in the API environment to an **absolute, persistent**
directory outside the repository and every publicly served directory. There is no
fallback. Provision it for the API service account with mode `0700`; files are
created `0600` with opaque UUID names. Root symlinks and group/world access are
rejected. The API account needs read/write access; the web server must never serve
this directory directly. For example, an operator can provision `/var/lib/synvaro/media`
with the correct service-account ownership and set that exact path. Do not put it
in `/tmp`, the checkout or a web public folder for permanent use.

Install a maintained FFmpeg package providing `ffprobe` (e.g. `brew install ffmpeg`
on macOS, `apt-get install ffmpeg` on Ubuntu). `FFPROBE_PATH` can override its executable
path. This is used only for MP4 metadata/packet inspection; uploads are never
transcoded. JPEG/PNG/static WebP are fully decoded for validation by sharp. Limits:
20 MiB per original file (keeps the initial single-host library conservative),
16 million image/video pixels, two active uploads per API process, 120-second upload
and 10-second MP4 probe deadlines. MP4 preview supports H.264 with optional AAC.
The API and the narrow Next media proxy enforce streamed byte limits; configure any
front proxy to allow the same 20 MiB plus 64 KiB multipart envelope, without raising
JSON/auth body limits. Missing storage or ffprobe fails media operations closed;
other Studio features remain usable. User-facing failures do not include server paths.

Back up **both PostgreSQL metadata and the entire media directory**, preserving
ownership/permissions. Pause uploads and stop the API while taking a coordinated
backup; restore the matching pair before restarting. Test restores separately.
Monitor disk capacity and keep the storage filesystem persistent across releases.
Do not prune files based only on age. Normal failed uploads remove staged/published
bytes; a process/host crash can leave an unreferenced UUID or `.part` object between
filesystem publication and DB commit. Reconcile such objects offline against
`MediaAsset.storageKey` after backup, with uploads stopped. No automatic orphan
sweeper or distributed transaction is claimed. Brand deletion is restricted while
media metadata exists. No deletion endpoint is provided in this slice.

Authenticated `/api/media/:id/file` streams originals with private/no-store headers
and byte-range support; there are no public media URLs. Preserve cookies and same-origin
routing through Next. Originals may retain EXIF/location metadata: this is intentional
provenance preservation, not metadata stripping. Authentication hardening, quotas,
antivirus scanning and isolated hostile-file inspection are future production work;
keep public production registration closed as already decided.
