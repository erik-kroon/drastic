# ADR 0002: exact posting and immutable approval

Status: working decision with partial implementation and incomplete acceptance evidence. [ADR 0004](0004-complete-accounting-delivery-contract.md) amends the original side-plus-value wire choice to retain the implemented paired fields. The detailed meaning and invariant IDs live in [domain](../domain.md).

## Decision

Use one PostgreSQL accounting authority per statutory book. Posted lines carry paired debit/credit minor-unit fields as canonical integer strings, with exactly one positive side. Preserve higher-precision source calculations separately with explicit rounding. Enforce scope, exact balancing, immutable posted content and semantic effect uniqueness at the database write boundary.

Approve a stored immutable change-set revision, digest and selected immutable groups. Recheck relevant row and collection dependencies inside execution. Use one short transaction per atomic group with a book mutation barrier, transactional voucher/commit counters, approval consumption, receipt and outbox. Return prior receipts for equal retries; conflicting key reuse fails.

Use an explicit year opening set plus within-year movements. Snapshot cutoffs follow committed book order. Corrections append linked effects and retain originals in sums. Approval and human display consume the same sealed plan.

## Alternatives and consequences

Decimal major-unit wire values can be exact, but two monetary wire conventions invite ambiguous conversions. Choose explicit minor units for posted values; rates and original amounts have distinct types. This ADR originally preferred side plus positive value to remove the both-positive line shape. ADR 0004 retains the subsequently implemented paired representation and requires explicit one-positive-side validation, avoiding unnecessary wire/digest migration.

A numeric column that rounds before validation cannot be the sole integer check. The migration must reject fractional input before coercion. Float arithmetic, tolerance-based balancing and direct CRUD of posted lines cannot meet the invariants.

Approving an editable draft lets economic content change after review. A single transaction for an entire large batch holds locks too long and cannot make external submissions atomic. Group-level receipts give precise recovery; the first slice supports one group before adding durable multi-group admission.

The book barrier intentionally trades per-book write concurrency for a simple commit order. It is not a global application lock. Measure contention before adding finer locking. Every relevant writer must participate; application convention alone is insufficient.

## Open details and proof

[Shared contracts](../plans/00-shared-contracts.md) now select the adapter ownership, bounds, digest compatibility, lock order and public error/retry semantics. D-02/D-03/D-05 retain the actual runtime, vector and transport compatibility proof gates. Executable schemas remain owned by `packages/contracts`. [E-01–E-11](../verification.md#foundation-and-posting-scenarios) cover the initial behavior, and period/opening scenarios extend it. A schema check or build is not this proof.
