# Manual Content Drafts — SYN-004

## Purpose and owned entity

Owners manually write and manage Content drafts for their brands. No AI, provider
connections, approvals, publishing, revisions, variants or campaigns are implemented.
Content belongs to exactly one Brand; authorization follows Brand → Organization → User.

## Business rules

- Content has UUID id, brandId FK, required title, body, status DRAFT and timestamps.
  No duplicate owner/organization foreign keys. Brand removal cascades to its content;
  this slice exposes no deletion endpoint.
- Title is trimmed, 1–200 characters. Body is plain text, up to 20,000 characters;
  whitespace/newlines are preserved and an empty body is valid. Omitted body on
  creation defaults to empty. Duplicate titles are allowed.
- Status is assigned server-side and constrained to DRAFT in PostgreSQL. Brand and
  status cannot be changed through PATCH. Unknown fields/ownership injection fail 400.
- POST requires brandId and title; PATCH accepts title and/or body, at least one.
  Omitted fields remain unchanged. A content request is bounded to 128 KiB JSON;
  existing auth and profile limits are unchanged. Excessive bodies fail 413.
- GET list requires exactly one valid brandId query parameter; no implicit first
  brand. An owned brand without drafts returns an empty array. Unknown/foreign
  brands return identical 404 for creation/listing; unknown/foreign contents return
  identical 404 for retrieval/update. Malformed IDs fail 400.
- Lists return metadata only (no full body), ordered by updatedAt descending then
  id descending, backed by a (brandId, updatedAt, id) index. This first slice is
  unpaginated; pagination is deferred, not silently truncated.
- All endpoints require the existing session. Mutations retain Origin/CSRF checks.
  Ownership is checked server-side, including scoped write predicates.

## Behaviors and acceptance criteria

| ID | Scenario | Expected result / test subject |
|---|---|---|
| CNT-001-A1 | Owner creates draft for owned brand | 201, persisted title/body, server-assigned DRAFT |
| CNT-001-A2 | Empty/omitted body or multiple drafts | Allowed; independent records, duplicate titles permitted |
| CNT-002-A1 | Owner lists selected brand | Only that brand's drafts, metadata/status/updated date; empty array if none |
| CNT-002-A2 | Owner opens a draft | 200 with body and immutable brandId; unknown/foreign same 404 |
| CNT-003-A1 | Save title/body or one field | Persist supplied fields, preserve omitted field and brand/status |
| CNT-003-A2 | Save through Studio, refresh and reopen | Persisted text, save feedback, owning brand always visible |
| CNT-003-A3 | Unsaved edits, invalid input or failed save | Unsaved indicator, departure/discard choice, validation; keep text on failure |
| CNT-004-A1 | Foreign/unknown brand create/list or content read/update | Same 404, no disclosure or write |
| CNT-004-A2 | Missing session, expired/revoked session, foreign/missing Origin | Existing 401/403 protection; no mutation |
| CNT-004-A3 | Invalid fields/IDs, unsupported ownership/status/brand updates | 400 without database details; no mutation |
| CNT-004-A4 | Switch Qos Workspace → ISIS Türkiye → Qos Workspace | No cross-brand listing or reassignment; original Qos draft intact |

## API

- POST `/contents` → 201 `{ content }`.
- GET `/contents?brandId=...` → 200 `{ contents: [...] }` (metadata only).
- GET `/contents/:id` → 200 `{ content }`.
- PATCH `/contents/:id` → 200 `{ content }`.

OpenAPI documents request/response schemas and authentication/error statuses.

## Verification and limitations

Real HTTP/PostgreSQL integration tests cover the behavior IDs above; existing auth,
organization and profile regressions remain enabled. Built Next/Nest smoke verifies
proxy security and refreshed SSR persistence. CI applies all forward migrations to a
clean PostgreSQL service. Desktop and 390px browser acceptance uses explicitly
hypothetical copy for Qos Workspace and ISIS Türkiye; actual outcomes belong in the PR.

No autosave, offline drafts, deletion, search, pagination or conflict resolution.
Concurrent edits to the same field are last-write-wins. Browser unload prompts depend
on browser support; forced termination cannot be prevented. In-app departure uses
an explicit keep/discard choice. This is not production authentication acceptance.
