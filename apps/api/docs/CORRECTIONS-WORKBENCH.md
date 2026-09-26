# Correction workbench delivery contract (COR-01/02 and safe COR-03/04)

## Current ownership

Application operations live in [application/posting-corrections.ts](../src/application/posting-corrections.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Accepted transition and failure cases (before implementation)

1. Prepare an immutable impact snapshot from the exact proposed replacement/date/rationale. Read the connected committed correction chain and exact cumulative account sums. No posting occurs.
2. Show original/reversal/replacement history and every represented bank, commerce, schedule, report and closing consequence. Missing compensation authority is a blocker, not an implicit release.
3. Seal only from a reviewed snapshot with matching intent and current snapshot digest. Approval binds its identity/digest into the immutable bundle. Recheck the snapshot and owning guards before execution; the existing kernel still owns final validation/authority.
4. Old sealed bundles remain readable/replayable. Unposted old bundles cannot bypass the new unsupported-register and no-op guards. A committed receipt is recovered before live-state checks.

Risks/acceptance cases: stale review after matching/registration/configuration/report/period changes; wrong book or snapshot; modified lines under the same review; new correction after a standalone reversal; multiple competing bundles; invalid/expired/revoked approval; midpoint failure/half posting; schedule provenance through equivalent event identities; identical economics (including line reorder/description-only edits); locked target periods; original closed period versus an explicitly open later target; retained reports/certificates becoming stale without mutating their bytes; unknown external/statutory filing consequences; lost prepare/approve/execute response and request-key recovery; bounded chain overflow without partial totals; cross-book IDs; reload without guessing another posting. No new tests are authorized. These remain acceptance cases, not proof.

### Conservative supported policy

Only existing native synthetic manual journals are eligible. Bank-matched/allocated lines, commerce recognition/applied payment allocations and represented schedule occurrences block generic correction until their owner implements an explicit compensation contribution. No match is deleted or treated as released. Locked target periods block before sealing. An original locked period does not grant permission to alter it: the only supported operational policy uses an explicitly selected open target period/date; statutory/company-specific policy remains unavailable.

Impact snapshots are conservative book snapshots: any ledger movement, account/period/profile change, new represented affected link or downstream artifact invalidates the review. Configuration-current is not full executability. Runtime approval, source-capacity, date and downstream guards still apply. Unknown company sources, legal treatment, payroll/tax effects and filing status are never inferred absent.

### Delivery status

Implemented in source; integration and runtime observations pending. Existing migrations through0900 are immutable. New SQL is0410+. Root alone integrates dispatcher/catalog and runs application/static/runtime checks. No Git operations, installs, tests, fixtures, servers or database writes by this owner.

### Implemented shape

`0410-correction-impact-workbench.sql` adds the immutable impact review and read/recovery functions. New bundles require an exact `impactReview` reference and include it under their digest. The basis binds complete connected committed chain/totals, exact intended lines/date/rationale, affected stable relationships, ledger sequence and configuration. Both pre-seal and approval/execute recheck it. An explicit list of blockers prevents sealing; the response always reports `executable:false`.

The domain-local UI now discovers bundles, reads chains, preserves request keys for uncertain results, freezes/shows exact replacement impacts before sealing, and reads the saved impact during approval. Affected-resource links use existing scoped read endpoints. Old bundles still decode; committed replay remains unchanged. Old unposted bundles and reversal-only preparations/execution receive live register/no-op guards where applicable.

No-op equivalence for this plain-journal profile compares net minor units per account and posting date/period, ignoring labels, line order and equivalent splits. This does not claim equivalence for unsupported dimensions, tax facts or register effects.

Stable inputs are the retained bank matches/allocation legs, commerce invoice/payment links, schedule preparation/event identities, reports and technical certificates in existing migrations through0900. Future register-release or filing hooks are not guessed. The module never writes another owner's tables, decrements capacity, replaces artifacts or reopens a period.

Integration mappings and the remaining root actions are in [CORRECTIONS-HANDOFF.md](CORRECTIONS-HANDOFF.md). Source checks and earlier0400/0401 receipts do not verify the new package's runtime, crash/recovery or browser behavior.

### Owner-register integration acceptance cases (0890, before implementation)

Root reserved0890 for correction integration after0410 and0610. A known owner source must block generic correction even without an `owner_effects` row. Match original event evidence/locator, posted-effect voucher identity and posted proposal provenance. Review/source revision, attached proposal, effect and allocation changes must change the frozen dependency digest without requiring a ledger/account-version change.

Required cases: owner source before impact; source or effect registered after impact or approval; posted proposal without captured effect; changed owner review/revision; additional allocation against a linked effect; unrelated-book or unrelated-voucher registration; old snapshot read without rewriting its body; old unposted bundle and reversal-only preflight; committed same/new-key receipt recovery unaffected. Each correction must fail before a misleading seal/approval or financial write when the new link is known. Existing owner and paired-posting guards remain defense in depth. Source implementation cannot prove concurrent admission/rollback behavior; no SQL execution or tests are authorized here.

0890 implementation: the private owner-impact helper selects source records by original event evidence/locator, owner effects by voucher and posted proposal provenance by change set. Each blocking `owner_record` resource links to the existing owner-register record endpoint and carries a digest of its retained source/current revision/current review, proposal links, effects and applied allocation legs. Those resources enter the existing frozen basis; no separate permission flag or compensation action is added. Normal book-lock serialization and existing seal/approval/execute comparisons now observe these owner changes even when ledger/configuration versions do not move. Both source-only and posted-effect cases fail closed. Unaffected old resource shapes remain unchanged; historical review bodies/receipts are not rewritten. Source-only review is not runtime/concurrency/rollback proof.
