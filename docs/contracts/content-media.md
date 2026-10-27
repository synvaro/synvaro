# Content Media Attachments — SYN-006

## Purpose and owned entity

ContentMedia links an existing Content draft to an existing MediaAsset. No file is
copied, transformed or uploaded by this domain. Ownership follows each parent's
Brand → Organization → User. Both parents must belong to the same brand.
The same relation also attaches accepted `AI_VOICE` MP3 assets; attachment
ordering and isolation rules are unchanged.

## Rules and concurrency

- Composite primary key `(contentId, mediaAssetId)` prevents duplicates. Position
  is a zero-based dense sequence. Order is position then mediaAssetId. Foreign keys
  cascade relationship deletion when a parent is removed; detaching never deletes
  the MediaAsset or its file. Existing parent deletion APIs are not introduced.
- The API explicitly validates ownership and same-brand membership inside a
  transaction. All relationship mutations lock the Content row with PostgreSQL
  `FOR UPDATE`, serializing changes to that draft. Parent brand assignments are
  immutable through existing APIs. No redundant brand FK or trigger is added;
  direct SQL writers must honor this domain invariant.
- Attach appends; duplicate attach returns 409. Detach compacts positions and
  returns the current list. Unknown/foreign/wrong-brand/not-attached resources
  return the same 404 without disclosing metadata.
- Reorder supplies the complete ordered `mediaAssetIds` list. Duplicate IDs or
  malformed/unsupported input return 400; unknown/foreign/unattached IDs return
  404. Missing current IDs return 409 and require reloading the list. Validation
  completes before any update. Empty order is valid only for an empty draft.
- Concurrent mutations execute in lock order. Reorders of the same membership are
  last-committed-order-wins. A stale membership list is rejected (404/409), never
  silently dropped or partially applied. Each successful mutation returns its
  transaction's ordered list; another session may subsequently change it.
- Relationship writes do not change draft text or Content.updatedAt. Studio saves
  attachment changes immediately, separately from Save draft; text state is kept
  locally without navigation/reload. Existing dirty-text departure prompts remain.
- Sessions, exact Origin/CSRF checks and existing bounded JSON parsing apply.
  No ownership fields, filename, file bytes or position are accepted from clients.

## Behaviors, acceptance and test subjects

| ID | Behavior / business rule | Acceptance and test subjects |
|---|---|---|
| CMA-001-A1 | Attach existing media | Owned same-brand image/video appends; multiple assets; shared asset across drafts; no file duplication |
| CMA-001-A2 | Duplicate attachment | 409, including concurrent duplicate requests; one relationship remains |
| CMA-002-A1 | List attached media | Ordered safe metadata; empty list; persistence across refresh; no storage keys |
| CMA-003-A1 | Reorder attachments | Complete permutation persists atomically; deterministic dense order |
| CMA-003-A2 | Invalid/stale/concurrent reorder | Duplicate/unknown/foreign/missing IDs rejected without partial writes; concurrent mutations serialize |
| CMA-004-A1 | Detach media | Only relationship removed; other drafts, original metadata and bytes remain; positions compact |
| CMA-005-A1 | Enforce brand and organization isolation | Unknown/foreign content/media and same-owner different-brand media return identical 404s |
| CMA-005-A2 | Authentication and input boundary | Missing/expired/revoked sessions, bad Origin, invalid IDs and ownership injection rejected |
| CMA-005-A3 | Migration and Studio regression | Real PostgreSQL replay, existing draft/media tests; desktop/390px attach/reorder/refresh/detach; dirty text preserved |

## API

- GET `/contents/:id/media` → 200 `{ attachments }`.
- POST `/contents/:id/media` with `{ mediaAssetId }` → 201 `{ attachments }`.
- PUT `/contents/:id/media/order` with `{ mediaAssetIds: [...] }` → 200 `{ attachments }`.
- DELETE `/contents/:id/media/:mediaAssetId` with `{}` → 200 `{ attachments }`.

Each attachment contains contentId, mediaAssetId, position, createdAt and safe
public `asset` metadata. Existing authenticated file endpoints serve previews.

## Limitations

No drag-and-drop, versions, approval/publishing variants, AI, media processing,
asset deletion, quotas or collaborative live synchronization. Picker lists the
current brand's existing library without pagination, matching SYN-005. Save the
new draft before attaching media. No new production authentication approval.
Actual PostgreSQL, browser and CI results are recorded in the PR.
