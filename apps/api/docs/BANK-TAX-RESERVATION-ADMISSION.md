#5600 bank admission against retained tax reservations

## Current ownership

Application operations live in [application/banking/allocations.ts](../src/application/banking/allocations.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Failure contract — before code

4100 physically rejects bank matches/allocation legs on an exact tax-reserved book/voucher/line.
1300 allocation preparation, approval/currentness and1600 discovery omit that admission rule.

- Refuse a selected reserved leg during preparation and checked approval/execution, including
  unusable-but-reserved tax matches. A later reservation makes saved-plan currentness false.
- Discovery must keep the line and exact amounts, but mark it `tax_account_reserved` and
  ineligible. It must not use `line_no_capacity` or claim the bank allocation consumed money.
- Compare all three identity columns. A same line ID in another voucher/book is unrelated.
- Never alter bank allocated sums, versions, complete reconciliation rows/differences, source
  capacities, signoff dependencies, unmatch/reversal helpers or native physical fences.
- Preserve saved plans, approvals, executions, unmatch metadata and successful-command replay.
  Historical getters still return those bodies when selected capacity is now unavailable.
- Released tax reservation permits the existing admission policy again. Do not invent new
  roles, global invalidation, a history version, financial calculation or artifact family.
- Forward only1300 snapshot/checked/getter and1600 discovery. Add one blocker literal locally;
  root owns the two required exhaustive EN/SV labels. No UI work, tests, SQL compilation,
  runtime, migration application, providers or VCS history changes.

### Implemented source

`5600-bank-tax-reservation-admission.sql` forward-replaces four existing functions:

-1300 `bank_allocation_snapshot`: refuse a selected reserved line during prepare/execute.
-1300 `bank_allocation_checked`: refuse selected reservations before new approval/execution.
-1300 `get_bank_allocation`: require no selected reservation for its existing currentness flag.
Saved plan, approval, execution and unmatch fields are returned unchanged.
-1600 `discover_bank_match_candidates`: append the `tax_account_reserved` blocker. Keep the
candidate row and exact bank amounts. Existing eligibility/count/ranking/digest logic then
reflects the blocker without pretending tax matching is a bank allocation.

All checks read the exact physical `(book_id,voucher_id,line_id)` reservation. They do not
filter by tax match usability. Mutation refusals use4100's existing `StaleDependency` message.

The BankCandidateBlock contract adds that one literal. No endpoint, registry or shape changes
are needed. Root adds only its exhaustive English/Swedish labels in existing copy.ts.

### Preserved consumers

`bank_allocated_line`, `bank_allocated_source`, `bank_allocation_versions`, reconciliation,
capacity reports, signoffs and unmatch/reversal snapshots remain untouched. A tax-reserved
posted line can still be a real unmatched bank-control difference; it stays in those controls
with its original amount. Snapshot candidate counts and financial capacity math do not change.

0500 prepare/approve/execute still authorize, lock and replay successful commands before the
changed admission owners run.1300 historical reads retain execution/unmatch bodies even after
release or subsequent tax reservation. Exact matching and imports remain atomic and use the
existing4100 insert fence; this packet adds no duplicate mutation guard.

### Source checks

Compared all four replacements with their latest owners. Only exact admission predicates,
the selected-reservation currentness condition and the discovery blocker were added. Scoped
identity, preserved rows/amounts, late reservation, release, original-key replay, historical
receipts and unchanged reversal capacity were reviewed in source, not executed.

Targeted contract Oxlint and documentation formatting passed. `git diff --check` passed.
No tests, SQL compilation/execution, migration application, runtime or providers were run.
Runtime behavior and independent source review remain separate gates.
