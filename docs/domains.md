# Domain map v0.1

Logical modules inside one modular monolith; **not** separate services.

| Domain | Responsibility | Target |
|---|---|---|
| Organization & Access | Implemented: session auth, create/read own organization; single owner, one organization per user. No membership or roles. | SYN-002B development |
| Brand Management | Implemented: create/list/update name and description within owner organization. Profiles, tone and locations remain planned. | SYN-002B development; broader MVP planned |
| Social Channels | OAuth connections, account capabilities | MVP |
| Content Planning | campaigns, calendar, ideas | MVP |
| Content Production | content revisions, channel variants | MVP |
| Media Library | uploads, provenance, reusable assets | MVP |
| AI Generation | provider jobs, outputs, costs | MVP |
| Publishing | scheduling, attempts, remote IDs | MVP |
| Review & Approval | revision-bound approvals | MVP |
| Product Catalog | verified products, facts, offers | Pilot/MVP decision |
| Notifications & Audit | errors, traceability | MVP/basic |
| Analytics | channel performance | R1.1 |
| Integrations | GitHub, Google Drive, catalogs | R1.1 |
| Engagement | comments and replies | R2 |

See [Publishing contract](contracts/publishing.md). Each new domain contract should specify ownership, inputs, outputs, rules, behaviors, acceptance criteria, test subjects and unresolved decisions.

Current behavior contract: [Organization & Brand](contracts/organization-brand.md).
All other domain rows describe planned capabilities, not implemented features.
