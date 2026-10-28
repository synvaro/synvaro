# Facebook Page text publishing — SYN-SOC-002

**Status:** Implemented on feature branch; PR pending review. **Owner:** Publishing domain. **Scope:** immediate plain-text posts to a Brand-owned Facebook Page only. The saved draft body is the exact publication text. The draft title and unsaved editor changes are never sent.

This narrow first slice uses the owner's explicit confirmation of an immutable saved-draft snapshot. The broader [publishing draft contract](publishing.md) still describes future review, revisions, scheduling and media workflows; those are not implemented here.

## Provider contract and prerequisites

The adapter targets Meta Graph API `v26.0`, `POST /{page-id}/feed`, using the encrypted Page access token. The separate explicit Facebook reauthorization requests `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`; ordinary Facebook and Instagram connection scopes do not change. Before preparing and again before confirming, the server checks the live user grant for `pages_manage_posts`, the chosen Page's `CREATE_CONTENT` or `PROFILE_PLUS_CREATE_CONTENT` task, and a read using the stored Page token. A stored token alone never proves publishing access. Meta app access level, review, Page role/task and live authorization must be verified for the actual account; local configuration cannot prove them.

Official references checked 2026-10-28: [Meta Facebook API collection — Page tokens and tasks](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api), [Meta Pages API posts](https://developers.facebook.com/docs/pages-api/posts), [Meta Page feed reference](https://developers.facebook.com/docs/graph-api/reference/page/feed/). The two developer-documentation pages returned HTTP 429 in this environment; their latest text could not be independently read. The Graph version follows the repository's existing SYN-SOC-001 Meta adapter. Live Page publishing and App Review remain separate acceptance evidence.

## Behaviors

| ID | Rule and acceptance | Test subject / limitation |
| --- | --- | --- |
| PUB-001 Select authorized Page | Only connected Facebook `PAGE` accounts for the draft's Brand appear. Live grant, Page task and token read must pass. Missing grant offers explicit publishing reauthorization. | Real-PostgreSQL ownership and permission tests; Meta live grant unverified. |
| PUB-002 Prepare immutable snapshot | `POST` stores the saved body, draft timestamp, Brand, Content, Page ID/name and unique owner request ID. Empty text is rejected. No provider post is made. | Snapshot and invalid-input tests. No content-versioning system. |
| PUB-003 Explicit confirmation | A separate confirmation request with `confirm:true` is required. Changed draft timestamp/body rejects stale review. | Stale-draft and no-post-before-confirm tests. |
| PUB-004 Publish once | One fixed Graph Page feed request with form `message`, Bearer Page token, 15-second timeout and redirects/retries disabled. Only a valid Page post ID confirms success. | Deterministic adapter and HTTP integration tests; no real post during development. |
| PUB-005 Persist result | `READY`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `UNCERTAIN`, safe error category, timestamps and post ID where known remain in PostgreSQL. | History/result persistence tests. |
| PUB-006 Idempotency and uncertainty | Unique `(userId, requestId)` and a database compare-and-set admit one send. Network timeout, 5xx or malformed success are uncertain, never automatically retried. A crashed `PUBLISHING` intent becomes `UNCERTAIN` on read after 45 seconds. Same-text active uncertainty blocks a new intent. | Concurrent confirmation, timeout, duplicate and recovery tests. Operator reconciliation requires independent Page evidence; no self-service retry. |
| PUB-007 Permissions and isolation | Session, Origin/CSRF and Content→Brand→Organization ownership are enforced. Page tokens remain encrypted; disconnect scrubs active credentials while retaining publication history. Provider bodies and tokens are never returned. | Isolation, Origin, encryption and sanitized-error tests. |
| PUB-008 History and evidence | Owned draft history lists immutable snapshots and provider result. A post ID is shown only after a valid provider response or audited reconciliation. | Real PostgreSQL history tests. Live test post requires separate owner approval. |

## API

- `GET /contents/:id/facebook-publications/readiness` — safe Page readiness, no mutation.
- `POST /contents/:id/facebook-publications` — prepare with `socialAccountId` and UUID `requestId`.
- `POST /facebook-publications/:id/confirm` — explicit one-time send with `{ "confirm": true }`.
- `GET /facebook-publications/:id` — owned status; stale in-flight intent may be marked uncertain.
- `GET /contents/:id/facebook-publications` — owned history.
- Existing `POST /brands/:id/social/oauth` accepts `publishing:true` for Facebook only.

## Controlled reconciliation

An operator first checks the controlled Facebook Page's activity and Meta evidence. After an `UNCERTAIN` result, run `node --env-file=.env scripts/reconcile-facebook-publication.mjs <id> PUBLISHED <page_post_id> <evidence_ref> <operator>` only when a matching post is verified. Use `FAILED -` only when the Page history or provider evidence reliably establishes no post. The one-time database update stores an audit UUID, evidence reference, operator and timestamp. Do not treat a timeout alone as proof of failure. The script is not exposed as a public API.

## Known limitations

No live Meta post or production permission grant has been verified. Account discovery is bounded to the first 100 Pages of a grant; further pagination is deferred. A post with an uncertain outcome and no reliable external evidence remains blocked for that exact draft/Page/text. Facebook may change Graph API requirements; re-check official documentation and App Review before external acceptance. No media posts, scheduled posts, automatic retries or publication links are claimed.
