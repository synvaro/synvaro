# Facebook Page single-image publishing (SYN-SOC-003)

**Implemented on feature branch; PR pending review.** This extends the existing Facebook Page publication intent. It does not publish during review, draft save, or page load.

## Provider contract

Verified 2026-10-28 against the [Meta Page Photos Graph API reference](https://developers.facebook.com/docs/graph-api/reference/page/photos/), version v26.0. A single JPEG/PNG is sent as multipart `source` to `POST /{page-id}/photos` with `caption` and `published=true`. The Page token must be backed by `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and a `CREATE_CONTENT` Page task. Meta documents a 10 MB photo limit. App review and a real Page grant remain external prerequisites. A successful response must include a Page `post_id`; a photo ID alone is not publication proof.

## Behaviors

- **PUB-IMG-001 — Select:** An owner selects one JPEG/PNG, at most 10 MB, from the draft's own private Brand Media Library. Foreign, missing, video, and unsupported files are rejected.
- **PUB-IMG-002 — Review:** The immutable intent records saved caption, Page, MediaAsset ID, MIME, byte length, and SHA-256. Confirm rejects changed saved text or source bytes. Unsaved editor changes never enter the intent.
- **PUB-IMG-003 — Confirm:** Only an explicit authenticated POST with `confirm: true` can claim a READY intent. The existing PostgreSQL row lock and request ID prevent duplicate sends.
- **PUB-IMG-004 — Provider:** The server reads bounded private bytes, validates image format/dimensions, and sends one fixed-endpoint multipart request. No public media URL or arbitrary download is used.
- **PUB-IMG-005 — Ledger:** Publication stores kind `IMAGE` and source snapshot alongside existing status and provider post ID. Text records remain `TEXT`.
- **PUB-IMG-006 — Uncertainty:** Timeout, network ambiguity, server error, or success without `post_id` becomes `UNCERTAIN`; no automatic retry. Operator reconciliation uses the existing audited mechanism.
- **PUB-IMG-007 — Studio:** The editor offers a brand-scoped photo selector, protected thumbnail, exact caption/Page review, one explicit publish action, and history. Text-only posting remains available.
- **PUB-IMG-008 — Isolation:** Existing session/Origin/CSRF, Page grant checks, encrypted token, and Brand ownership apply. No live Meta post occurs in automated tests.

## Acceptance subjects and limitations

Real PostgreSQL tests cover ownership, explicit confirmation, concurrency, source integrity, response classification, and text regression. Deterministic Meta mocks cannot prove live App Review, Page authorization, or a real post. JPEG/PNG only; one photo per post; no scheduling, video, albums, or Instagram. The local 10 MB cap and in-memory bounded upload are intentionally conservative. A changed or removed source requires a new review. Publishing can still be uncertain after Meta receives a request; never retry that intent automatically.
