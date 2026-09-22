# Synthetic recurring preparation

Status: implemented and manually exercised locally for proposal preparation; no automated or production verification. This is a G3 preparation slice, not automatic posting, payments, a tax treatment engine, a scheduler or an external job-delivery service.

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

The only journal call is `prepare_journal`. It uses original statement evidence, source posting date, exact two-sided amounts, and an open accounting period. There is no call to `approve_change` or `execute_change`. No background process, timer, queue delivery, external scheduler or automatic retry is implied: a caller explicitly advances each bounded chunk.

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
