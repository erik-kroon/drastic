# Product development in the public repository

Status: accepted owner decision, 2026-10-09.

## Context

The public Drastic repository and the private openERP repository diverged.
Maintaining both required repeated fixes and allowed behavior to drift.

## Decision

`erik-kroon/drastic` owns product development, executable contracts, engineering
documentation and synthetic verification. Develop and commit useful recovered
work against its current application owners.

`openERP` is a read-only archive. Its branches, stashes and historical receipts
are recovery inputs. They do not establish missing behavior in the current
product or justify replacing newer code.

The private `drastic-hq` workspace owns company facts, Book Zero originals,
funding documents and private qualification records. Historical Git history and
uncommitted recovery snapshots stay in private custody. Do not import private
history into the public repository.

## Recovery dispositions

| Candidate | Disposition |
| --- | --- |
| WORK-09 dimensional openings | Already retained in the SIE4E capture and renderer. Verify both opening representations and exact object balances with the existing dimension E2E workflow. |
| WORK-12 SIE partitions | Superseded by the current partition and historical migration owners. Retain fiscal-mapping refusal, immutable reads, exact replay and duplicate-refusal checks in the current HTTP E2E journey. |
| WORK-19 onboarding edits | Already retained and expanded by the current onboarding owners. Correct the outdated lifecycle documentation and verify retained controls, mappings, responsibilities, decisions and final deltas. |
| WORK-20 stashed UI and lint changes | Already integrated. Keep the newer public components and lint rules. Do not restore intentionally removed design seed scripts. |

## Verification and limits

Run the repeatable synthetic workflows from the repository root:

```sh
bun run test:e2e apps/api/tests/sie-dimensions.e2e.test.ts apps/api/tests/sie-historical-owners.e2e.test.ts
bun run test:e2e apps/api/tests/onboarding.e2e.test.ts apps/api/tests/onboarding-lifecycle.e2e.test.ts apps/api/tests/onboarding-mappings.e2e.test.ts apps/api/tests/onboarding-deltas.e2e.test.ts apps/api/tests/company-profile-admission.e2e.test.ts
```

Each run retains source identity, HTTP observations and accounting receipts under
`test-results`. Local engineering checks do not qualify live company books,
external providers, production cutover or statutory submissions.
