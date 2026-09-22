# Correction workbench delivery contract (COR-01/02 and safe COR-03/04)

## Accepted transition and failure cases (before implementation)

1. Prepare an immutable impact snapshot from the exact proposed replacement/date/rationale. Read the connected committed correction chain and exact cumulative account sums. No posting occurs.
2. Show original/reversal/replacement history and every represented bank, commerce, schedule, report and closing consequence. Missing compensation authority is a blocker, not an implicit release.
3. Seal only from a reviewed snapshot with matching intent and current snapshot digest. Approval binds its identity/digest into the immutable bundle. Recheck the snapshot and owning guards before execution; the existing kernel still owns final validation/authority.
4. Old sealed bundles remain readable/replayable. Unposted old bundles cannot bypass the new unsupported-register and no-op guards. A committed receipt is recovered before live-state checks.

Risks/acceptance cases: stale review after matching/registration/configuration/report/period changes; wrong book or snapshot; modified lines under the same review; new correction after a standalone reversal; multiple competing bundles; invalid/expired/revoked approval; midpoint failure/half posting; schedule provenance through equivalent event identities; identical economics (including line reorder/description-only edits); locked target periods; original closed period versus an explicitly open later target; retained reports/certificates becoming stale without mutating their bytes; unknown external/statutory filing consequences; lost prepare/approve/execute response and request-key recovery; bounded chain overflow without partial totals; cross-book IDs; reload without guessing another posting. No new tests are authorized. These remain acceptance cases, not proof.

## Conservative supported policy

Only existing native synthetic manual journals are eligible. Bank-matched/allocated lines, commerce recognition/applied payment allocations and represented schedule occurrences block generic correction until their owner implements an explicit compensation contribution. No match is deleted or treated as released. Locked target periods block before sealing. An original locked period does not grant permission to alter it: the only supported operational policy uses an explicitly selected open target period/date; statutory/company-specific policy remains unavailable.

Impact snapshots are conservative book snapshots: any ledger movement, account/period/profile change, new represented affected link or downstream artifact invalidates the review. Configuration-current is not full executability. Runtime approval, source-capacity, date and downstream guards still apply. Unknown company sources, legal treatment, payroll/tax effects and filing status are never inferred absent.

## Delivery status

Implementation in progress. Existing migrations through0900 are immutable. New SQL is0410+. Root alone integrates dispatcher/catalog and runs application/static/runtime checks. No Git operations, installs, tests, fixtures, servers or database writes by this owner.
