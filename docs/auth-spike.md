# SYN-002A — authentication spike

**Historical SYN-002A spike record.** The owner subsequently accepted this approach for current development in SYN-002B (see ADR-013); production hardening remains pending. NestJS owns authentication;
Next.js is a web client with a narrow same-origin transport. No organization,
role, invitation, recovery, OAuth or external identity service is implemented.

## Request path

Browser → Next.js `/api/auth/{register,login,me,logout}` → NestJS `/auth/*` → PostgreSQL.
The Next route only forwards the four allowed operations, the session cookie,
JSON body and Origin/Fetch Metadata. It forwards neither arbitrary URLs nor
client-supplied forwarding headers. It never creates or validates sessions.
Authenticated server-rendered Studio layouts call NestJS `/auth/me` with the
cookie and `cache: no-store`; unauthenticated users are redirected to `/login`.
The API global guard is deny-by-default. Health and the three public auth
mutations are explicit exceptions; Origin checks still apply to public mutations.

Development/test registration responds with the same 201/message for new and duplicate normalized
emails, without signing in or overwriting an existing password. Users then log
in explicitly. Login always performs an Argon2 verification (a dummy hash for
unknown emails) and returns the same 401 for invalid credentials. The public
user projection contains only `id` and `email`.

## Database

Only `User` and `Session` are created by the `auth_spike` Prisma migration.

| Model   | Fields and constraints                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| User    | UUID id; unique normalized email (max 254); Argon2id passwordHash; createdAt/updatedAt                                                      |
| Session | UUID id; unique SHA-256 tokenHash; userId FK with cascade delete; createdAt; expiresAt; nullable revokedAt; indexes on userId and expiresAt |

Passwords use Argon2id with a random salt, 19 MiB memory, two iterations and one
lane, matching the [OWASP minimum configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Inputs are strictly validated: email, password 12–128 characters, no additional
fields and an 8 KiB JSON body limit. Passwords are not trimmed. Email is trimmed
and lowercased, including its local part; this is an explicit spike normalization
policy, not an approved product identity policy.

Sessions use independent 32-byte CSPRNG tokens (256 bits), base64url in the cookie,
SHA-256 only in PostgreSQL. A successful login always creates a new token and
revokes a previously presented session in the same transaction. Every protected
request checks the database for expiry/revocation. Sessions expire absolutely
after eight hours; there is no sliding renewal. Logout revokes the presented
session and expires its cookie, even if already invalid. Other devices remain
signed in. No token is placed in URLs, JSON responses or browser storage.

## Local development

Use native PostgreSQL 16+ or an existing dedicated development instance; no local
Docker requirement. Create a database and role with a password as described in
`development.md`. Do not reuse production credentials or databases.

```sh
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# Set DATABASE_URL in .env to your dedicated development PostgreSQL database.
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm dev:api
# Separate terminal:
pnpm dev:web
```

Both services must agree on `WEB_ORIGIN` (default `http://127.0.0.1:3000`).
Next loads its server-only settings from `apps/web/.env.local` or process env;
Nest/Prisma load root `.env`. `API_INTERNAL_URL` defaults to
`http://127.0.0.1:3001`. Never prefix these settings or credentials with
`NEXT_PUBLIC_`. Do not alternate `localhost` and `127.0.0.1` during a session.

Migration generation uses `pnpm db:migrate --name <change>` on a disposable
development DB with shadow-database privileges. Review and commit the SQL and
schema together. Deployment/test replay uses `pnpm db:deploy`. Never use a schema
push or modify an already-applied migration. Generated Prisma source is ignored;
build/typecheck generate it reproducibly from the schema.

## Cookie and CSRF strategy

| Setting                    | Local loopback HTTP, development/test | Production HTTPS         |
| -------------------------- | ------------------------------------- | ------------------------ |
| Cookie                     | `synvaro-session`                     | `__Host-synvaro-session` |
| HttpOnly / SameSite / Path | true / Strict / `/`                   | true / Strict / `/`      |
| Secure                     | false (loopback only)                 | true, mandatory          |
| Domain                     | omitted, host-only                    | omitted, host-only       |
| Max-Age                    | eight hours                           | eight hours              |

HTTPS development also uses the Secure `__Host-` cookie. API production startup
requires an explicit HTTPS `WEB_ORIGIN`; remote HTTP origins are rejected in all
modes. Production must use `NODE_ENV=production` for NestJS. Terminate public TLS
at a reverse proxy for Next.js, keep NestJS on loopback, and use TLS if the internal
API is on another host. The proxy must preserve the browser Origin. Cookie Path
is `/` so authenticated server rendering can receive it. No cross-origin CORS
credentials or shared-domain cookie is needed.

All API mutations require an exact configured Origin and JSON content type.
Missing, `null`, mismatched Origins and `Sec-Fetch-Site: cross-site` are rejected.
The Next transport repeats the boundary check and preserves Origin; it does not
invent an Origin for missing requests. SameSite is an extra layer, not the sole
CSRF defense. See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
API/proxy responses use no-store; body validation and unexpected failures do not
return submitted data, database diagnostics, password hashes or tokens.

## Tests and evidence

Tests fail if PostgreSQL is absent; no SQLite or database mocks exist. Use a
**dedicated database whose name ends in `_test`**, apply migrations, then export
`DATABASE_URL`, `NODE_ENV=test` and `WEB_ORIGIN=http://127.0.0.1:43100` before:

```sh
pnpm db:deploy
pnpm --filter @synvaro/database migrate:status
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

Integration tests create uniquely named accounts and delete only those accounts
in cleanup. The smoke test uses loopback ports 43100/43101 and exercises the built
Next transport and server-rendered Studio against the built Nest API and real DB.
It does not substitute HTTP cookie handling for manual browser verification.
CI uses an ephemeral PostgreSQL 16 service with test-only credentials, applies
the committed migration, and executes the same gates. The service container is
CI infrastructure, not a Docker requirement for self-hosting.

| ID           | Expected behavior / evidence                                           |
| ------------ | ---------------------------------------------------------------------- |
| SYN-002A-A1  | Register/duplicate normalization and Argon2id storage; real PostgreSQL |
| SYN-002A-A2  | Generic invalid-credential errors and protected access denial          |
| SYN-002A-A3  | Random token, hashed persistence and public-only response              |
| SYN-002A-A4  | Login rotation revokes old session (fixation prevention)               |
| SYN-002A-A5  | Expired and revoked sessions rejected by DB-backed guard               |
| SYN-002A-A6  | Logout revokes persisted session, clears cookie and is idempotent      |
| SYN-002A-A7  | Cross-origin/missing-Origin/cross-site mutations rejected              |
| SYN-002A-A8  | Invalid, oversized and extra-field payloads rejected without echo      |
| SYN-002A-A9  | Login/registration account and IP limits; window recovery              |
| SYN-002A-A10 | Production HTTPS config and cookie attributes                          |
| SYN-002A-A11 | Built Next → Nest → PostgreSQL register/login/reload/logout flow       |
| SYN-002A-A12 | Captured application logs exclude passwords, tokens and DB credentials |

Actual command results, migration replay and manual browser evidence belong in
the spike PR, separate from owner acceptance.

## Trade-offs and unresolved issues

- Rate limits are bounded in-memory fixed windows: five attempts per normalized
  account and 60 per socket peer per 15 minutes, shared across login/register.
  At most four password computations run concurrently. Forwarded IPs are not
  trusted, so users behind the Next proxy share the IP bucket. This intentionally
  conservative spike can deny legitimate users; restart resets buckets and
  replicas do not coordinate. Resolve durable/shared limiting and trusted ingress
  before production or horizontal scaling; no Redis choice is made here.
- Public registration is available only in development/test; production registration is rejected. No email ownership verification,
  recovery or abuse operations are implemented. Do not treat an email as verified.
- Revoked/expired rows remain for inspection; a retention/cleanup policy is not
  selected. No queue, background cleanup, sliding sessions or device management.
- Eight-hour lifetime, password bounds and normalization are spike parameters
  needing owner review. Production TLS/ingress, load resistance, XSS hardening,
  proxy log redaction and operational secret/backup controls need deployment review.
- A browser/session compromise can still use a live cookie; hashing at rest does
  not prevent XSS from making requests or an attacker modifying database records.

SYN-002A findings remain relevant. Current owner decisions are recorded in ADR-013 and the SYN-002B decision addendum.
