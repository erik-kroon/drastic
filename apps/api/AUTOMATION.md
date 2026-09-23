# Synthetic recurring preparation

Status: the0200 proposal-preparation slice was manually exercised locally; no automated or production verification is established here. Later0940 adds durable background preparation jobs, forward2600 repairs explicit replacement admission, and forward2800 carries original-submitter identity admission into delivery and replacement. The2600/2800 repairs are source-only and runtime-unverified. None of these slices enables automatic posting, payments or tax treatment.

```text
Retained unmatched bank observations
  → immutable exact-match rule proposal
  → immutable simulation with source/period checkpoints
  → operator activates exact rule + simulation digests
  → durable run freezes observation identities
  → caller advances at most 20 rows per command
  → ordinary journal proposals
  → separate human approval and normal kernel execution
```

## Rule and review boundary

The book must use native writer authority and `synthetic-core-v1`. Rules accept only:

- one existing source bank account and its mapped ledger account;
- an exact, case-sensitive description, with whitespace preserved;
- positive or negative source amount (zero observations do not qualify);
- one distinct, active counterpart account in the same book;
- one fixed journal series and explicit `taxAssessment: not_applicable`;
- a name and the fixed `synthetic_recurring_preparation_v1` kind.

The database rejects extra rule fields, rather than silently enabling fuzzy matches, tax inference, amount ranges or automatic posting. Source rows and retained statement evidence remain unchanged.

A rule is immutable, version 1, and carries a server-computed canonical digest. Dependencies pin book profile/currency, native writer epoch, and both account versions. A changed configuration requires a new proposal. Rule activation does not create an approval for any financial change set.

Simulation selects only unmatched observations on the rule's source account within an inclusive date interval. It retains exact identities, dates, signed amounts, descriptions, evidence IDs and accounting-period versions. The response includes complete matching row count and signed total, the number of nonmatching unmatched rows, already-matched count, overlapping active rule IDs and blockers. It rejects a selection above 1000 eligible rows; narrow the date interval instead of accepting truncation. Zero rows and nonmatching descriptions count as nonmatching, not as inferred matches.

The operator activates the exact rule digest and simulation ID/digest. The server recomputes the selection and compares all relevant fields except the unrelated global book sequence. Changed source revisions, matches, relevant periods, rule configuration, or overlapping active rules reject activation. At least one eligible observation and no blockers are required. An ordinary agent cannot activate or deactivate a policy.

Active rules with the same bank account, exact description and sign conflict, even when their counterpart or series differs. Operators can append a reasoned deactivation before reviewing a replacement; activation/deactivation records are never overwritten. Repeated identical command keys recover their saved receipts. A currently active activation must still refer to an actor with operator membership before a run can prepare work.

## Durable runs and identity

`CreatePreparationRun` accepts an active activation ID and a source date interval. It freezes that rule version, activation and current eligible observations. A newly imported row is not silently added to a run. A later run can select it. Frozen source data is immutable; a row explicitly matched after run creation is skipped before journal preparation.

Runs expose `ready`, `blocked`, `cancelled`, or `completed`, plus a committed cursor, total, append-only results and audit entries. `completed` means all selected rows were considered. It does not mean posted, reconciled or period-complete. `requiresPostingApproval` is always true.

- `advancePreparationRun` accepts `action: continue|cancel|resume` and `maxItems: 1..20`.
- Each command locks the book, recovers a prior command result when applicable, and commits its checkpoint/results/receipt together.
- Each row uses a database subtransaction. A failing row leaves no partial proposal. Earlier successful rows in that chunk commit with a durable blocker and unchanged cursor for the failed row.
- A cancelled or blocked run requires explicit `resume`; `continue` does not silently restart it.
- Cancellation never deletes a prepared proposal, reverses a voucher, or changes a previous result. Operators still review any already prepared proposals separately.
- Resume rechecks activation authority, rule dependencies and relevant periods. A stale frozen period/configuration is not silently regenerated: review the changed input and create a new run or rule as appropriate.
- A cancelled run can resume from its committed cursor. A completed run never prepares rows again.

Observation event identity is `bank_<statementId>_<rowOrdinal>` under the retained statement evidence. Native posting purpose remains the kernel's fixed `adjustment` / `manual_journal` identity. A deterministic per-observation command key and a unique `(book, statement, ordinal)` preparation record prevent a new run ID, actor or retry key from creating a second automation proposal.

Results distinguish `prepared`, `recovered`, `already_posted`, and `skipped_matched`. An existing automation proposal is recovered, not replaced. A proposal prepared under a different rule or stale dependencies blocks for review. A pre-existing manual proposal using the same semantic bank-row key also blocks rather than creating another draft. An existing posted voucher for that event is returned without another posting. Arbitrary manual event keys cannot be inferred to be the same economic event; an explicit bank match remains the required resolution for such existing bookkeeping.

The only journal call is `prepare_journal`. It uses original statement evidence, source posting date, exact two-sided amounts, and an open accounting period. There is no call to `approve_change` or `execute_change`. In the0200 slice, a caller explicitly advances each bounded chunk. The later0940 background job delivers these same preparation-only chunks; it adds no posting authority.

## Integration

Migration `0200-recurring-preparation.sql` adds immutable rules, simulations, activations, deactivations, observation/preparation links and run audit, plus mutable run progress with frozen-input and append-only-result guards. Only public command/read functions are granted to `openerp_runtime`; tables and internal helpers explicitly revoke runtime and PUBLIC privileges. Every public function rechecks token/entity/book scope. Mutations lock the book before dependent period/account locks.

`@open-erp/contracts/automation` and `AutomationApi` are integrated. `AutomationHandlers` and MCP share the same named capability handlers; fixed statements live in `database.ts`. The existing scoped query adapter remains the only `pg` connection owner. REST and MCP use these same fixed database functions and contracts. Do not expose activation/deactivation as ordinary-agent tools; the database also enforces operator authority.

All routes are below `/api/v1/entities/:entityId/books/:bookId`. POST commands require the existing `Idempotency-Key` header.

| Operation                 | Route                                 | SQL function                                            |
| ------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `proposeRecurringRule`    | `POST /recurring-rules`               | `propose_recurring_rule(token, scope, key, input)`      |
| `getRecurringRule`        | `GET /recurring-rules/:id`            | `get_recurring_rule(token, scope, id)`                  |
| `simulateRecurringRule`   | `POST /recurring-rule-simulations`    | `simulate_recurring_rule(token, scope, key, input)`     |
| `getRecurringSimulation`  | `GET /recurring-rule-simulations/:id` | `get_recurring_simulation(token, scope, id)`            |
| `activateRecurringRule`   | `POST /recurring-rule-activations`    | `activate_recurring_rule(token, scope, key, input)`     |
| `deactivateRecurringRule` | `POST /recurring-rule-deactivations`  | `deactivate_recurring_rule(token, scope, key, input)`   |
| `createPreparationRun`    | `POST /preparation-runs`              | `create_preparation_run(token, scope, key, input)`      |
| `getPreparationRun`       | `GET /preparation-runs/:id`           | `get_preparation_run(token, scope, id)`                 |
| `advancePreparationRun`   | `POST /preparation-runs/:id/advance`  | `advance_preparation_run(token, scope, id, key, input)` |

Read `getRecurringRule` for active policy and current configuration status. Read the immutable simulation before operator review. Read `getPreparationRun` after reconnecting; repeating an old mutation key returns that command's original checkpoint, not current progress. Run audit preserves each command key and actor, including blockers. To progress, issue a new command key for the next deliberate chunk.

## Verification boundary

No tests, fixtures, deployment, commits or dependency additions were made. Existing lint/type checks validate the owned TypeScript but do not establish PostgreSQL execution or financial correctness. Before claiming G3 verified, an authorized runtime exercise must retain evidence for exact-match selection, legitimate equal rows, missing/locked periods, stale source/configuration, conflicting policies, agent activation denial, operator activation, bounded chunks, a mid-run blocker, cancellation/resume, replay across actors/runs, already-matched skip, proposal recovery, and separate approval/execution of the resulting journal.

Automatic posting remains unsupported. It requires a separate explicitly approved delegation with transaction exclusions, limits, expiry, aggregate budgets and atomic budget consumption; a preparation activation is not that delegation.

Forward0201 rejects unsupported command keys at the SQL boundary and filters effective activation reads by current operator membership. REST payload schemas also reject excess fields. Forward0210 holds credential/member admission locks until transaction end; see README maintenance revocation ordering. Forward0211 reports installed recurring preparation separately from production readiness.

Manual local evidence: two identical but distinct source rows produced two distinct event/proposal IDs. A one-row chunk was cancelled and resumed at its saved cursor. Ledger sequence remained0 and all balances0 after preparation; neither proposal was approved or posted. Artifact: `.agents/work/openerp-implementation/manual-recurring-preparation-receipts.json`.

## Forward2600: obsolete background-job recovery

### Failure cases recorded before implementation

- Revoking an executor's book membership, or configuring a different executor actor, can strand its0940 job in `ready`. The scheduler cannot deliver it and the executor cannot authorize its stop. The ready-job uniqueness gate then prevents explicit replacement even after manual cancel/resume.
- A fresh admission must not stop an active same-executor job whose original submitter authority and run audit are unchanged.
- Missing/revoked/expired original API credentials, missing/expired original browser sessions, missing submitter membership, a non-agent old executor, a different configured executor, or a changed run audit may retire an obsolete ready job. This grants no authority to execute it.
- Current requester and configured executor must still authorize before the book lock; the configured executor must still be an agent. Old credentials/memberships must not acquire locks after the book lock.
- An original exact-key admission replay must return its original saved receipt before any live reconciliation. The0940 replay input includes executor identity: changing the configured executor with an old key still conflicts, never silently creates a replacement. A replacement needs a new explicit admission key.
- A blocked, cancelled or completed run cannot be resumed or advanced by admission. Only an explicitly ready run may receive a replacement job.
- Stopping the old job and inserting/saving its replacement must be one transaction under the book lock. Any later failure must roll back the stop. Old job IDs, checkpoints, captured authority, run audit, run progress and command receipts must remain retained.

### Implemented source and independent-review handoff

`2600-preparation-job-recovery.sql` replaces only `admit_preparation_job`. Historical0940, its grants, job executor, pending scheduler query, Workflow runtime and public contracts are unchanged. No shared registration change is needed for the existing function signature.

The admission order remains current requester authorization, configured executor authorization and agent-role requirement, book lock, exact command replay, then ready-run validation. Under that book barrier it captures the current run-audit ordinal and reads the unique ready job. The old job is stopped only for one of the recorded obsolescence reasons. Otherwise the existing active-job refusal remains. Credential/session and membership checks for the old job are plain reads, not authority locks taken after the book lock. A concurrent uncommitted revocation may therefore leave a job classified active and require a later explicit retry; admission does not bypass that refusal.

The replacement captures the current requester's credential/session and current audit, with a new job ID and zero job checkpoint. It does not alter the existing run cursor, results, activation, frozen selection or audit. The stopped job keeps its identity, checkpoint and captured authority, plus a stop reason and check timestamp. Stop, replacement and command receipt share one SQL transaction. There is no exception handler that could preserve a stop after a failed replacement.

The0940 executor still reauthorizes before advancing, locks the book and reloads the job. A delivery waiting behind replacement sees the old job stopped and cannot advance it. A chunk that held the book lock first either completes before the new audit is captured or makes the run non-ready, in which case replacement admission refuses. The active-job unique index still permits at most one ready job per run.

Source-reviewed cases: active same-executor refusal; different configured executor; missing submitter membership; revoked/expired/missing credential or session; manual cancel/resume audit mismatch; non-ready refusal; exact old-key replay; changed-executor old-key conflict; stop/new-job rollback boundary; and waiting old delivery. No checks, tests, database/migration execution or runtime verification were run. SQL compilation, lock/concurrency behavior and delivered Workflow recovery remain unverified.

This remains durable preparation only. The executor calls `advance_preparation_run`, which prepares or recovers ordinary journal proposals under the existing activation and dependency checks. Separate human financial approval and normal kernel execution remain required.

## Forward2800: original submitter identity admission

### Failure cases recorded before implementation

- A requester may start a job with an API token and a separate enabled executor. Identity provisioning can then set the requester admission to disabled while leaving its API credential and book membership intact (empty grants or unchanged grants). New direct requests are denied by2502, but0940 checks only the retained token/session and membership before advancing.
- Browser-session deletion during identity provisioning covers session-backed requests, not retained API credentials. Both job kinds must respect an existing disabled identity admission.
- The original submitter admission row must be read with `FOR SHARE` after the captured credential/session and before membership and book locks. Do not acquire that authority lock after the book barrier.
- Missing identity-admission rows remain allowed, matching2502 legacy identity behavior. Only an explicit `enabled IS FALSE` adds a stop reason.
- Existing terminal-job and older-checkpoint replay must return the retained job without advancing it. Step bounds, executor authorization, checkpoint equality, manual-audit detection and all prior stop cases remain unchanged.
- Fresh replacement admission must treat an explicitly disabled original requester as obsolete, using a nonlocking read after its book barrier. Unchanged active jobs must still refuse; exact old-key replay must not silently replace them.
- No disabled requester is authenticated or used to execute work. The authorized executor may record a stopped job, and a separately authorized fresh requester may explicitly admit a replacement. No run is resumed or advanced by replacement admission.

### Implemented source and independent-review handoff

`2800-preparation-identity-admission.sql` replaces only `execute_preparation_job` from0940 and `admit_preparation_job` from2600. Historical0940/2600 and identity migrations2501/2502 remain unchanged. Existing function signatures and grants remain; no registration or endpoint change is needed.

Execution retains current executor authorization, ownership and step bounds. It captures nullable `submitter_enabled` from the original requester's admission with `FOR SHARE`, after the original credential/session lock and before membership/book locks. After the book barrier and job reload, terminal-job/older-checkpoint replay and exact-checkpoint validation still run before fresh stop classification. Existing credential/membership, executor role, audit and run-state branches remain. A fresh current checkpoint with `submitter_enabled IS FALSE` records `stopped` and never calls `advance_preparation_run`. A missing row yields null and does not add a refusal, matching2502.

Replacement admission adds only a plain nonlocking `enabled IS FALSE` check to2600's original-submitter obsolescence predicate. Current requester/executor authorization, agent role, replay order, explicit ready-run admission and atomic old-stop/new-job/receipt remain unchanged. Disabled original-requester state does not authenticate that actor or resume its run; a new valid requester must deliberately admit the replacement.

For an existing identity row, the execution share lock serializes its disable update with a preparation chunk. The provisioning script deletes sessions before updating identity admission and then changes listed memberships; the added lock keeps that authority order. As with2502, a missing admission row is allowed and has no row to lock; this patch does not add an identity registry/advisory-lock protocol.

Source-reviewed cases: valid API credential plus retained membership with disabled requester and separate enabled executor; session-backed requester with a deleted session; explicit enabled or missing admission; terminal and old-step replay; future/out-of-range step refusal; disabled old submitter replacement under a different valid requester; exact original-key replay; active unchanged job refusal; and rollback of obsolete-job stop if replacement fails. No checks, tests, SQL/migration execution or runtime verification were run. Compilation, concurrent provisioning/delivery and actual Workflow recovery remain unverified. Human financial approval, profile constraints and kernel posting authority are unchanged.
