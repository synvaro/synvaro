# Domain contract — Publishing

**Status:** Draft. **Behavior:** PUB-001. **Owner:** Publishing domain.

## Purpose
Publish an approved, immutable content revision to an authorized social account immediately or at a scheduled time.

## Owns
Publication and PublicationAttempt. Depends on Content, Review, Social Channels and Media.

## Rules
- Reject unapproved or changed revisions.
- Verify social account authorization and platform-specific media capabilities.
- Prevent duplicate remote posts, including after retries and ambiguous timeouts.
- Persist provider response, external post ID and actionable errors.
- Use explicit scheduling timestamps and time zones.
- Never claim publication success before remote confirmation.

## Acceptance criteria
| ID | Given / When | Then |
|---|---|---|
| PUB-001-A1 | Approved revision, valid connected account, due schedule | Publication attempted and confirmed result recorded |
| PUB-001-A2 | Unapproved or modified revision | Publishing refused |
| PUB-001-A3 | Same publish intent retried | No second remote post |
| PUB-001-A4 | API error or expired token | Error recorded, correct retry/reconnect action |
| PUB-001-A5 | Provider timeout with unknown outcome | Reconcile before any retry that could duplicate post |

## Test subjects
PUB-T01 approval gating (domain); PUB-T02 idempotency (integration); PUB-T03 provider error/retry (integration); PUB-T04 actual platform publishing (live acceptance, with approved test account).

## Open questions
Per-platform OAuth review and permission grants; media constraints; provider reconciliation APIs; retry ceilings and backoff.
