# Organization & Brand — SYN-002B

Status: implemented development slice, subject to PR review. Owner decisions are
recorded in `decisions.md`; this is not production security/release acceptance.

## Ownership and inputs

One authenticated user owns at most one organization; each organization has one
owner and many brands. Session identity supplies ownership. Request-body ownership
IDs, extra fields and unsupported edits are rejected. No membership, RBAC, invitations,
delete operations or unrelated domain entities exist.

Names are trimmed, 1–120 characters. Create accepts an optional slug: trimmed,
lowercase ASCII letters/digits separated by single hyphens, 1–80 characters.
When omitted, the server derives a slug from the name (accent folding, hyphenation,
80-character bound; fallback `organization` or `brand` for names without ASCII
letters/digits). Collisions return 409; a caller can retry with an explicit slug.
Organization names/slugs and brand slugs are not editable in this slice. Brand
patches contain name and/or description, with at least one field. Description is
optional, trimmed and at most 2000 characters; empty/null clears it.

## Behaviors and acceptance

| ID | Given / when | Expected result |
|---|---|---|
| ORG-001-A1 | Authenticated owner without organization submits a valid name | 201, organization owned by session user |
| ORG-001-A2 | Same owner tries again, including concurrent requests | Exactly one organization; later/losing writes return 409 via DB uniqueness |
| ORG-001-A3 | Another owner uses an existing global slug | 409, sanitized conflict; no raw DB details |
| ORG-002-A1 | Owner reads `/organizations/me` | 200 with own organization only |
| ORG-002-A2 | User without organization reads | 200 `{ organization: null }`; Studio shows creation form |
| ORG-002-A3 | Caller supplies another owner/org ID | Cannot alter read scope; no arbitrary organization read endpoint |
| BRD-001-A1 | Owner creates one or multiple brands | 201, server-assigned organization FK |
| BRD-001-A2 | Duplicate slug in same organization / same slug in another organization | 409 / allowed respectively |
| BRD-001-A3 | User has no organization | 409 `Create an organization first` |
| BRD-002-A1 | Owner lists brands | 200 with only owned organization brands; empty array if none |
| BRD-002-A2 | Owner patches brand name/description | 200 with persisted changes; slug/ownership unchanged |
| BRD-002-A3 | Patch foreign or unknown UUID | Identical 404 `Brand not found`, no mutation |
| ORG-BRD-SEC-A1 | Unauthenticated call to any of the five endpoints | 401 when Origin is valid for mutations |
| ORG-BRD-SEC-A2 | Invalid/extra fields, ownership injection, invalid UUID, empty patch | 400; no persistence change |
| ORG-BRD-SEC-A3 | Missing/foreign Origin on mutation | Existing 403 protection preserved |

## API and persistence

- `POST /organizations` → `{ organization }`; `GET /organizations/me` → `{ organization | null }`.
- `POST /brands` and `PATCH /brands/:id` → `{ brand }`; `GET /brands` → `{ brands: [] }`.
- Input and response schemas, cookie auth and error statuses are documented in OpenAPI.
- PostgreSQL enforces unique owner, global organization slug and per-organization
  brand slug. Updates include owner scope in the write predicate itself.
- Public projections exclude User/Session records and internal DB errors.
- Existing session expiry/revocation, cookie attributes, body limits and Origin
  protections remain in force. Production registration is closed.

## Verification and limits

`apps/api/src/test/organization-brand.test.ts` exercises these behaviors with real
HTTP and PostgreSQL, including concurrent creation and cross-owner access.
`scripts/smoke.mjs` verifies the built Next → Nest → PostgreSQL path and persistence
across reloads. CI applies all migrations to a clean PostgreSQL service before tests.
Actual local/CI outcomes and desktop/390px browser evidence are recorded in the PR.
No mocked persistence is used. Tests create unique accounts and clean only their
own records. API test databases must end in `_test`.

The list is deliberately unpaginated for this first small slice. No organization
settings, membership, slug editing, brand deletion or production readiness claim.
Next scope requires its own behavior contract; the current auth limiter remains
development-only and security hardening is required before public production use.
