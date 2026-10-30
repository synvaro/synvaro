# AUTH-MFA-001 — Owner TOTP protection

Status: Implemented — PR pending review. This is a narrow production authentication hardening slice, not an external identity service.

## Behavior and acceptance

- **AUTH-MFA-001-A1 — Password gate:** Correct password creates a five-minute, hashed-token `PENDING_MFA` session when MFA is required or already enrolled. Pending sessions cannot access Studio or protected product APIs. Production requires MFA; development/test can opt in with `MFA_REQUIRED=true`.
- **A2 — First enrollment:** A pending owner can request a random TOTP secret. The secret is encrypted at rest with a separate server-only 32-byte AES-GCM key and shown only during setup over the authenticated session. The user enters the secret in an authenticator app and confirms a six-digit code. The response gives eight random one-time recovery codes once. No email/SMS service or external QR endpoint is involved.
- **A3 — Challenge:** An enrolled account must provide a fresh six-digit code or unused recovery code before full access. TOTP accepts one neighboring 30-second step for clock skew and rejects reused counters. Recovery-code hashes are stored; each code is consumed atomically.
- **A4 — Session rotation:** Successful MFA revokes the pending session and creates a new eight-hour full session. Failed attempts are bounded to five per pending session; the existing password-login limiter also applies. Old sessions are revoked during migration so they cannot enroll MFA without password re-entry.
- **A5 — Isolation:** All MFA routes require the current pending session, exact Origin on mutations and no-store responses. Unknown, expired and revoked pending tokens fail. Secrets and recovery codes are never logged or returned after activation.
- **A6 — Recovery boundary:** The user must store recovery codes offline. No self-service MFA reset or email recovery is implemented. Loss of both authenticator and codes requires a separate audited operator recovery decision; no bypass endpoint exists.

## Test subjects

Real PostgreSQL integration: fresh migration, pending-session isolation, encrypted secret, setup/activation, full-session rotation, code replay, single-use recovery, expiry and origin checks. Existing auth and product regressions must remain green. Desktop and 390px browser setup require separate rendered verification. No paid or external provider call is involved.

## Limits

TOTP is susceptible to phishing; passkeys/WebAuthn may be added later. The process-local password limiter remains a production-hardening gap. The MFA encryption key must be backed up and rotated through a future audited procedure; losing it prevents TOTP verification. No QR code is generated in this first version; manual secret entry is supported. This feature does not protect a compromised application host or database credentials.
