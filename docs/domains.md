# Domain map v0.1

Logical modules inside one modular monolith; **not** separate services.

| Domain | Responsibility | Target |
|---|---|---|
| Organization & Access | Implemented: session auth, create/read own organization; single owner, one organization per user. No membership or roles. | SYN-002B development |
| Brand Management | Implemented: create/list/update name and description within owner organization. Detailed brand profiles (description, audience, tone, language and guidelines) are implemented. Brand context is used by explicit text generation; locations remain planned. | SYN-003 development; broader MVP planned |
| Social Channels | OAuth connections, account capabilities | MVP |
| Content Planning | campaigns, calendar, ideas | MVP |
| Content Production | Implemented: owner-scoped manual drafts (create/list/read/update), immutable brand assignment, DRAFT only; same-brand media attach/list/reorder/detach. Revisions and channel variants remain planned. | SYN-006 development |
| Media Library | Implemented: private original uploads, per-brand lists, authenticated image/video previews and UPLOADED provenance. Draft attachment reuse is implemented; accepted AI-generated PNG provenance and private previews are implemented; no editing. | SYN-008 development |
| AI Generation | Implemented: explicit OpenAI text suggestions from saved draft/brand context, review/apply, user preferences and conservative usage estimates. Explicit conceptual image preview/save/attach with shared preferences and uncertainty-aware cost accounting is implemented. No autonomous jobs, image editing or publishing. | SYN-008 development |
| Publishing | scheduling, attempts, remote IDs | MVP |
| Review & Approval | revision-bound approvals | MVP |
| Product Catalog | verified products, facts, offers | Pilot/MVP decision |
| Notifications & Audit | errors, traceability | MVP/basic |
| Analytics | channel performance | R1.1 |
| Integrations | GitHub, Google Drive, catalogs | R1.1 |
| Engagement | comments and replies | R2 |

See [Publishing contract](contracts/publishing.md). Each new domain contract should specify ownership, inputs, outputs, rules, behaviors, acceptance criteria, test subjects and unresolved decisions.

Current behavior contract: [Organization & Brand](contracts/organization-brand.md).
Brand profile contract: [BRP-001](contracts/brand-profile.md).
Manual draft contract: [CNT-001–004](contracts/content-drafts.md).
Media library contract: [MED-001–004](contracts/media-library.md).
Content media contract: [CMA-001–005](contracts/content-media.md).
Rows not explicitly marked implemented describe planned capabilities.

AI draft contract: [AIG-001–005](contracts/ai-draft-generation.md).

AI image contract: [IMG-001–007](contracts/ai-image-generation.md).
