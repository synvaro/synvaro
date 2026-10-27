# Brand Media Library — SYN-005

SYN-AI-004 also saves **generated** MP3 narration into the same private
MediaStorage as `AI_VOICE` MediaAssets. This does not change the original
upload endpoint's JPEG/PNG/WebP/MP4 allowlist or its 20 MiB limit. Generated
audio has separate MP3 inspection and a 5 MiB limit; see
[VOC-001–006](elevenlabs-voice-generation.md).

## Storage and upload security contract (defined before implementation)

One MediaAsset belongs to one Brand; ownership follows Brand → Organization → User.
The owner explicitly selected private local storage for this slice. This does not
replace the accepted future S3-compatible direction or implement an S3 adapter.

- `MEDIA_STORAGE_ROOT` is an explicit absolute, persistent private directory outside
  this repository/public web roots. No default repo or temporary storage. Unconfigured
  media returns 503; unrelated Studio capabilities remain usable. Owner-only directory
  permissions and non-executable 0600 files; no static web server mapping.
- A small MediaStorage interface isolates staging, commit, reads and removal. Keys
  are random server UUIDs, never client paths. Original filenames are display-only
  metadata (basename, bounded length, control characters removed). Keys and absolute
  paths never appear in public metadata.
- POST is multipart with exactly one `file` part and no fields. JPEG, PNG, static WebP
  and MP4 are allowed after signature and parser validation, regardless of claimed MIME
  or extension. SVG, HTML, archives and unsupported/malformed media are rejected.
- Maximum original file size: 20 MiB (20 × 1024² bytes), allowing small real videos
  while bounding disk use and validation work. Multipart envelope cap adds 64 KiB.
  Enforce limits while streaming in Next and Nest, including chunked uploads. No
  request.formData()/whole-video memory buffering. Upload timeout: 120 seconds.
- Image decode validation uses sharp with a 16-million-pixel bound, static images
  only, strict malformed-input rejection. Original bytes are never re-encoded.
- MP4 validation uses ftyp/container bounds and local ffprobe packet inspection,
  with timeout/output bounds and external references disabled. Initial browser preview
  accepts H.264 video and optional AAC audio; no transcoding or derivatives. A local
  ffprobe executable is required for MP4, not cloud credentials or a processing queue.
- Stage privately; validate; atomically publish object; then insert metadata. On
  ordinary parser/validation/storage/DB failure, remove staged/published files. Never
  acknowledge success until both exist. A process crash between filesystem and DB
  commits can leave an orphan (not exposed). Back up PostgreSQL and storage together;
  reconcile orphan keys against metadata during maintenance with the API stopped.
  No cross-system atomic transaction or automatic destructive cleanup is claimed.
- All four endpoints require sessions and ownership. Upload retains exact Origin/
  CSRF checks before receiving the file. Foreign and unknown brand/media IDs return
  identical 404s without metadata/content disclosure. Metadata does not contain keys.
- File responses stream original bytes with authenticated byte-range support for
  video, validated Content-Type, nosniff, private/no-store, same-origin resource policy,
  restrictive sandbox CSP and server-controlled inline filename. No public links.

## Behaviors and acceptance

| Behavior | Business rule and test subjects | Known limitation |
|---|---|---|
| MED-001 — Upload brand media | Owner uploads one original; validate before metadata commit; A1–A3 test supported bytes, duplicate names and failure compensation | 20 MiB, static images/H.264 MP4 only; no transcoding or crash-atomic DB/filesystem transaction |
| MED-002 — List brand media | Explicit owned brand returns only its metadata, newest first; A1 tests isolation and empty lists | No pagination, folders, search or tags |
| MED-003 — Retrieve and preview media | Owner receives persisted metadata or unchanged bytes; A1–A2 test integrity, refresh and ranges | Original previews, no optimized thumbnails; one byte range at a time |
| MED-004 — Enforce ownership and file safety | Session, Origin and server-derived ownership checks precede access; A1–A4 test foreign IDs, auth, traversal, malformed files and migrations/browser | No antivirus or isolated inspection worker; existing development authentication limits remain |


| ID | Business rule / scenario | Acceptance and test subject |
|---|---|---|
| MED-001-A1 | Owner uploads supported file to owned brand | 201 metadata, origin UPLOADED, exact original bytes preserved |
| MED-001-A2 | Repeat same original filename | Distinct assets/keys, no overwrite |
| MED-001-A3 | Oversize, interruption, malformed multipart or DB/storage failure | No acknowledged asset; partial/orphan file compensation on ordinary failure |
| MED-002-A1 | Owner lists explicit brand | Only its metadata, newest first, empty array if none |
| MED-003-A1 | Metadata/file retrieval and refresh | Persisted metadata and identical original binary; authenticated image/video previews |
| MED-003-A2 | Valid/invalid byte range | 206 with correct bytes/headers; unsatisfiable range 416 |
| MED-004-A1 | Foreign/unknown brand or asset | Same 404 for list/upload/metadata/file; no names or bytes leaked |
| MED-004-A2 | Missing/expired/revoked session or bad Origin | Existing 401/403, no upload persisted |
| MED-004-A3 | Spoofed MIME/extension, malformed signatures, traversal filenames | Type detected from bytes, unsupported/malformed rejected, no client-controlled paths |
| MED-004-A4 | Clean migration and desktop/390px Qos → ISIS flow | Real PostgreSQL and private test storage; browser image/video/refresh/isolation/logout evidence |

## Entity and API

MediaAsset: UUID id, brandId FK, originalFilename, unique private storageKey,
mimeType, sizeBytes (Int: bounded to 20 MiB), nullable width/height/durationMs,
origin UPLOADED and createdAt. Brand deletion is restricted while assets exist,
avoiding silent metadata cascade that would orphan files; no deletion API is added.

POST/GET `/brands/:brandId/media`; GET `/media/:id`; GET `/media/:id/file`.
OpenAPI documents multipart input, metadata, streaming/range responses and errors.

## Limitations and evidence

No editing, processing/transcoding, derivatives, AI, tagging, folders, deletion,
content attachments, public URLs, provider integration or publishing. List pagination,
quotas, malware scanning and distributed concurrency controls remain deferred.
Parsing validates supported structures, not every possible malicious payload or all
video decode artifacts; deploy with a least-privilege account and OS resource limits.
Original EXIF/container metadata stays intact and may contain sensitive provenance;
only upload files the owner is entitled to store. Preview does not assert authenticity
of media claims. File edits outside the application are unsupported.

Real PostgreSQL tests use dedicated temporary storage and small synthetic fixtures;
byte-for-byte checks are required. Browser tests use non-customer sample media.
Actual command/CI/browser results and failure cases are recorded in the PR, separate
from owner acceptance and production hardening.
