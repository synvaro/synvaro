# OSS governance and legal checklist

**Status:** Draft; maintainers should review before the first public release.

## Current policy
- License: Apache-2.0, full unmodified text in the repository root.
- Contributors retain ownership of their contributions; no CLA or assignment currently required.
- GitHub organization ownership is not evidence of legal copyright ownership.
- Planned commercial/managed services do not change Community licensing retroactively.

## Copyright attribution — owner decision required
The repository does not yet declare a verified initial copyright owner. Before a public release, confirm whether the original code and documentation are owned by the individual creator or by a legal entity under applicable contracts. Then add an accurate copyright statement (for example in NOTICE and/or source headers), without modifying the standard LICENSE text. Do not invent an entity or assign ownership based solely on the GitHub organization name.

## Trademark
Apache-2.0 does not grant rights to use SYNVARO trademarks. Trademark ownership, registration and a detailed brand-use policy are not yet established. Do not imply trademark registration.

## Security
Read SECURITY.md. Public self-service registration and production use require a separate security acceptance; CI green is not a production authorization.

## Maintainer tasks before public launch
- Confirm copyright owner and attribution.
- Enable GitHub private vulnerability reporting or publish a verified private security contact.
- Verify third-party dependencies, bundled assets and notices at release time.
- Review platform API terms, branding, OAuth permissions and provider costs.
- Add a documented release/support policy when versioned releases begin.
