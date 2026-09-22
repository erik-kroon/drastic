# Reviewed bank allocation plans

## Scope and delivery contract

Implement synthetic, operator-reviewed partial and many-to-many matching between retained bank observations and immutable posted bank-account lines. Preserve every source identity and imported match. Matching never posts a voucher, sends a payment, or settles an invoice. Commerce alone owns invoice/control-account-line allocation capacity.

Lifecycle: prepare exact legs → inspect frozen capacities and ambiguity → operator approval of digest/version → atomic execution → immutable capacity-aware reconciliation.

## Failure cases to prevent

- Cross-book/entity, wrong currency/account, wrong sign, zero amount or out-of-statement-date legs.
- Aggregate over-allocation when several legs consume one source or posted line.
- Capacity consumed through both legacy exact matches and new partial allocations.
- Old approval replay after source, ledger, account, profile, or writer authority changes.
- Execution after approver membership loss or approval expiry.
- Duplicate command delivery, changed payload under one key, or two plans racing for capacity.
- Equal-valued observations silently merged, ambiguous candidates auto-selected, or imported provenance treated as new postings.
- Partial failures leaving legs without their execution receipt.
- Reconciliation claiming completeness from zero net difference while residual amounts or coverage gaps remain.

## Boundaries

Only synthetic-core-v1 native books. At most 100 explicit nonzero allocation legs in one plan. Overlapping statement imports, arbitrary provider formats, currency conversion, netting opposite signs, cross-statement timing allocations and large synchronous reconciliation scopes remain unsupported. Reconciliation retains the existing bound of 1000 combined source/ledger rows and 100 whole statements and 1000 allocation legs. No inference of tax or legal/provider facts.

## Status

Implemented in the owned files listed below; not integrated or locally executed yet. No new tests, fixtures, database mutations, server runs, builds or production actions are authorized for this worker. Static review does not prove concurrency/recovery behavior. Integration, local observation and production/profile verification are separate states.

## Implemented authority and freshness

`0500-reviewed-bank-allocations.sql` adds immutable plans, approvals, executions, allocation legs and capacity-aware reports. Selected source/line pairs retain statement ID + ordinal, voucher ID + line ID, signed amount, source-bank identity, provider identity and evidence hash. No amount-based identity or deduplication exists.

Plans freeze account/profile/writer versions, bank source revision and the account ledger sequence. An immutable version-1 digest binds every leg, reason, capacity and candidate-count diagnostic. Source and ledger changes on that account require a new plan; unrelated account posting does not. A plan does not reserve capacity before execution.

Approval requires current operator membership and lasts one hour. Execution requires its exact digest/version and approval ID, rechecks approver membership under SHARE lock, re-evaluates grouped capacity sums, and writes legs plus the immutable execution and command receipt in one transaction. Caller credential/member admission locks remain unchanged. Financial writes serialize on the book before account/configuration locks. Retry the original command key after an uncertain outcome; GET the saved plan recovers its execution after a lost client key. A changed payload under a used key fails.

The legacy-match BEFORE INSERT guard rejects either endpoint if any v2 leg already consumes it. Conversely, v2 capacities include all legacy imported/explicit matches as full consumption. Legacy relations are never copied into additional postings or counted twice. All new functions revoke PUBLIC and runtime execution first; only authenticated public commands are granted.

`0501-recurring-allocation-guards.sql` replaces only `recurring_selection` and `recurring_prepare_observation`, preserving latest applied logic except their matching predicates. Any legacy or partial allocation removes the observation from full-amount recurring preparation. `alreadyMatchedCount` therefore includes partially consumed observations; it does not assert complete bank reconciliation. Existing prepared proposals are not silently deleted or posted. `0502-recurring-posting-capacity-guard.sql` rejects adjustment voucher insertion when its event is linked through any recorded recurring preparation to a source with any legacy or partial allocation. This checks event identity, so a different equivalent proposal cannot bypass it. The voucher trigger retains the book lock through commit; failure rolls back the kernel sequence/counter changes, voucher, lines and receipt together. Reversal handling and base approval/authority checks are unchanged. Current core proposal validation may still show its configuration dependencies as current; execution enforces this additional domain condition.

Source and posted-line SQL helpers qualify every actual parameter with the function name. In particular, source row ordinal must not resolve to the allocation leg’s separate ordinal column. No unlabeled local variable uses function qualification.

## Reconciliation and close integration

New capacity reports retain original row amounts and add signed `allocatedMinor` and `remainingMinor`. A residual of zero means fully consumed; opposite-sign netting is rejected. Unmatched collections contain nonzero residuals. A complete report still requires exact opening/closing balance agreement, no remaining capacity, and declared whole-statement coverage. Explicit required-source inventory remains a separate year-end authority.

V1 reports remain immutable and keep their exact-match semantics. They conservatively show differences for v2 allocations. Existing v1 reports become stale when allocation execution increments the account source revision. Use the v2 route to see partial amounts.

Private `bank_close_dependencies(book text, starts_on date, ends_on date)` runs under a caller-held book lock. It returns deterministic `{sources:[{accountId,sourceId,revision,reconciliationId,reconciliationKind,reconciliationCreatedAt}],allRepresentedReady}`. It chooses the latest exact-interval, complete, fresh v1 or v2 report. Missing report metadata is null. An empty represented set returns false; only the year-end owner's explicit inventory can establish whether zero sources are expected. Closing applies its own reopen/invalidation timestamp. Direct runtime execution of the helper is revoked.

## Root integration mapping

- Export `./settlements` from the contracts package.
- Add `SettlementsApi` to the shared API and `SettlementHandlers` to the Worker layer.
- Spread `SettlementCapabilities` into the shared contract registry. Operator approval is deliberately absent from MCP.
- The ordinary REST handlers call the shared named capabilities below. Bind these to the existing query owner; do not create a new PostgreSQL client.

| Capability                         | Dispatcher operation            | Parameters after token                    | Output                           |
| ---------------------------------- | ------------------------------- | ----------------------------------------- | -------------------------------- |
| `bank_prepare_allocation`          | `prepareBankAllocation`         | scope, idempotencyKey, JSON input         | `BankAllocationPlan`             |
| `bank_get_allocation`              | `getBankAllocation`             | scope, planId                             | `BankAllocationView`             |
| `bank_execute_allocation`          | `executeBankAllocation`         | scope, idempotencyKey, planId, JSON input | `BankAllocationExecution`        |
| `bank_reconcile_capacity`          | `reconcileBankCapacity`         | scope, idempotencyKey, JSON input         | `BankCapacityReconciliation`     |
| `bank_get_capacity_reconciliation` | `getBankCapacityReconciliation` | scope, reconciliationId                   | `BankCapacityReconciliationView` |

Operator REST approval uses `approveBankAllocation` with token, scope, key, planId, JSON input. SQL mapping:

```ts
export const settlementStatements = {
  prepareBankAllocation:
    "select openerp.prepare_bank_allocation($1::text,$2::jsonb,$3::text,$4::jsonb) as result",
  getBankAllocation: "select openerp.get_bank_allocation($1::text,$2::jsonb,$3::text) as result",
  approveBankAllocation:
    "select openerp.approve_bank_allocation($1::text,$2::jsonb,$3::text,$4::text,$5::jsonb) as result",
  executeBankAllocation:
    "select openerp.execute_bank_allocation($1::text,$2::jsonb,$3::text,$4::text,$5::jsonb) as result",
  reconcileBankCapacity:
    "select openerp.reconcile_bank_capacity($1::text,$2::jsonb,$3::text,$4::jsonb) as result",
  getBankCapacityReconciliation:
    "select openerp.get_bank_capacity_reconciliation($1::text,$2::jsonb,$3::text) as result",
};
```

Mount `BankAllocations` from `@/components/settlements` with `{book,setup,locale}`, keyed by scoped book identity at the workspace boundary. It owns local English/Swedish copy, explicit leg editing, frozen capacity/evidence review, exact approval/execution, saved-plan recovery, and v2 reconciliation/residual tables. Remote state uses TanStack Query; uncertain requests retain stable keys, and execution refetches durable book state. Native labeled fields and responsive owned table primitives are used; browser accessibility/layout behavior has not been observed.

## Checks and remaining gates

Owned TypeScript files pass `bun x oxlint` and `bun x oxfmt --write`. These are static checks, not failure/recovery or concurrency proof. Root owns group/registry/dispatcher integration and API type validation. Apply0500/0501/0502 together before exposing the new routes. Migrations0500/0501/0502 have not been applied by this worker. No tests, test fixtures, dependency installs, servers, builds, database writes, commits, pushes, deployment or external submissions were performed.

Runtime SQL validation, authenticated route observation, browser behavior, competing allocation attempts, interrupted-command recovery, scope denial and production/profile verification remain unverified. Production accounting, invoice settlement, actual provider import formats, cross-period timing, allocation correction/reversal, larger reports and company completeness remain outside this slice.
