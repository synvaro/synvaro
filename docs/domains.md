# Domain map v0.1

Logical modules inside one modular monolith; **not** separate services.

| Domain | Responsibility | Target |
|---|---|---|
| Organization & Access | organizations, users, membership, roles | MVP |
| Brand Management | brand profiles, tone, locations | MVP |
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
