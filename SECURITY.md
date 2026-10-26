# Security Policy

## Supported versions

SYNVARO is pre-1.0 and does not yet have a supported production release. No production security SLA or fixed response time is promised.

## Reporting vulnerabilities

**Do not open public issues containing exploits, credentials, tokens or sensitive data.**

Use GitHub's **Report a vulnerability** / private vulnerability reporting feature on this repository **if enabled**. If it is not enabled, contact the maintainers privately using a verified organization contact channel; do not post details publicly.

Please include affected version or commit, reproduction steps, impact and a safe proof of concept. Never test against other people's accounts or social media profiles without authorization.

## Security boundaries

The current authentication implementation is suitable for development evaluation, **not unrestricted public production registration**. Known deferred items include distributed rate limiting, email ownership verification, session cleanup and production ingress review.

Social platform credentials and AI API keys must never be committed. Report accidental exposures privately and revoke compromised credentials immediately.
