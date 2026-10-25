# Test strategy v0.1

## Test levels
1. Domain: behavior and invariant checks.
2. Integration: PostgreSQL, storage, queues, provider adapter contracts with mocked provider responses.
3. Live acceptance: real authorized social account, actual remote post ID and media validation.

## Initial subjects
| ID | Subject | Evidence |
|---|---|---|
| ORG-T01 | Cross-organization isolation | access test results |
| BRD-T01 | Brand tone and asset scope | sample previews |
| MED-T01 | Asset provenance | upload metadata |
| AI-T01 | Provider failure and cost recording | job trace |
| REV-T01 | Approval invalidated by content changes | revision and review records |
| PUB-T01..T04 | Publishing contract scenarios | tests and live post IDs |
| SEC-T01 | Token confidentiality | secrets handling test |

Every test must cite behavior/acceptance IDs, expected result, actual result, environment and evidence. A mocked integration test is **not** proof of successful production publishing.
