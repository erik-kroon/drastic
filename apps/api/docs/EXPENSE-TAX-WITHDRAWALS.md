#4500 expense source withdrawal — pre-code failure contract

## Current ownership

Application operations live in [application/vat/expense-tax.ts](../src/application/vat/expense-tax.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Permanent operator withdrawal is observation review, not a posting reversal or allocation
release. No equivalent withdrawal owner exists in0710.

Required failures and retained behavior:

- Current scoped operator authority, book barrier, exact current source digest and retained
  withdrawal evidence/rationale are required. Wrong scope, stale source, absent evidence,
  blank rationale and repeated new-key withdrawal refuse; original successful keys recover.
- Source identity, source/review history and saved snapshots remain immutable. New source
  revisions/reviews for that withdrawn identity refuse through physical insertion guards.
- New assessments retain the withdrawn observation with a clear exclusion and null taxable,
  deductible and expense contribution; new snapshots include the withdrawal lineage.
- The complete basis/dependency digest includes withdrawal. Existing close/accountant
  consumers become stale. Source count remains retained-source count, never completeness.
- Independent corrected active source identities may use the corrected observation. Withdrawn
  identities stop participating in source duplicate checks, not in historical lineage.
  Active duplicates must not silently contribute twice.
  -0710 has no line-selection or allocation-capacity model. Do not invent a line claim or release
  any bank, owner, commerce or tax-account capacity. A shared voucher with no disjoint line
  proof remains an explicit assessment ambiguity, not an automatic corrected-source mapping.
- Explicit VAT facts linked to the withdrawn expense source must not keep contributing via
  unchanged source/review digests. Their retained observations must become excluded/currentness
  stale; corrected independently reviewed facts must not inherit dead-source duplicate claims.
- No snapshot recalculation, tax/profile activation, payment, posting, coverage or readiness
  upgrade. No tests/runtime/SQL execution or migration application is authorized.

### Implemented source

Forward `4500-expense-tax-source-withdrawals.sql` adds one immutable withdrawal per retained
source identity, pinned to its exact source revision and evidence. It does not change0710 or
3700 history or apply a migration. It provides no financial execution or legal-profile power.

An operator calls POST `/v1/entities/:entityId/books/:bookId/expense-tax/sources/:id/withdrawals`
with `{expectedSourceDigest,evidenceId,rationale}` and an idempotency key. `:id` is the stable
`sourceId`, not a source-revision ID. Scope, current operator authorization, exact current
source digest and book-scoped evidence are checked under the existing book barrier. Blank
reasons, stale sources, cross-book identities and duplicate new-key withdrawal are refused.
The retained response includes original source revision ID/digest, evidence hash, actor,
time, permanent status and command receipt. There is no reactivation endpoint.

Physical insertion guards on `expense_tax_source_revisions` and `expense_tax_reviews` refuse
new work on withdrawn identities. Existing producer commands still perform successful-key
recovery before any attempted insertion, so old successful source/review receipts remain
recoverable after withdrawal. Withdrawal itself also replays before new-state checks. Concurrent
revision, review, withdrawal and snapshot commands use the same book serialization barrier.

Live source reads/inventory now retain the withdrawal and report `reviewCurrent:false` for
withdrawn observations without deleting their latest review or either immutable history.
No period reopening is required for this observation-only review. It does not change posted
periods, reverse a voucher, release allocations or repair accounting effects.

#### Actual assessment and duplicate ownership

New snapshots are `schemaVersion:"2"` / `expense-tax-controls-v2`. Every withdrawn observation
remains an entry, with withdrawal lineage and `withdrawn_source`. Its contribution and tax
calculation are null, so taxable, deductible and expense totals do not count it. Existing
source-balance/date/eligibility diagnostics remain visible. Existing exact arithmetic is
unchanged for eligible independent active observations.

The existing physical source-revision owner now refuses a new active alias for the same
retained evidence **content hash plus source locator**. It compares current revisions under
the book barrier and excludes withdrawn identities. This also catches re-uploaded identical
source bytes under a different evidence ID. The same source may append valid revisions;
withdrawal does not permit reusing its permanently retired source key.

Older duplicate observations are not deleted or rewritten. New assessment detects represented
active duplicates and excludes them with `duplicate_source_component`. An independent corrected
active identity can use the observed component after explicit withdrawal of the erroneous
identity. Retained source count and the200-source history bound are not reduced by withdrawal.

0710 has only a whole-voucher reference, not selected tax-line identities. Two active expense
observations sharing that voucher are therefore conservatively excluded with
`ambiguous_voucher_sources`, even if they might represent legitimate disjoint components.
This flag means proof is missing, not that the system proved a duplicated line. No invented
line capacity or allocation release was added. Bank, commerce, owner and tax-account
matching reservations stay exactly as they were. Different source locators without a shared
voucher are not automatically classified as duplicates; unproven semantic identity remains
outside this bounded exact-identity control.

#### Dependencies, immutable history and downstream VAT

`expense_tax_basis` includes every retained source's withdrawal digest. Existing closing and
accountant consumers already depend on this owner, so a withdrawal changes currentness
without editing shared closing functions. `sourceCount` remains all retained source
identities. `withdrawnSourceCount` is additive; `missingOrStaleReviewCount` covers only active
sources, rather than asking for impossible new reviews on retired identities. All completeness,
VAT-return, production-profile and posting-readiness flags remain false.

Saved expense v1 snapshots stay byte-for-byte historical bodies. Old-key snapshot replay
returns its original engine/version and totals. New v2 snapshots have withdrawal metadata;
contracts accept old entries where that metadata did not yet exist. Adding the new basis
shape can conservatively stale earlier snapshots; it does not relabel or recalculate them.

Necessary dependent-owner closure:

- A new VAT fact revision explicitly linked to a withdrawn expense identity is refused by
  a physical guard on `vat_fact_revisions`. Existing successful VAT keys still recover first.
- The live VAT basis marks `expenseSourceWithdrawn` and makes that explicit expense link
  noncurrent, even though the immutable source/review digest strings themselves did not change.
- New `vat-return-draft-v3` calculations retain such observations with
  `withdrawn_expense_source` and no contribution. Withdrawn upstream observations no longer
  compete in duplicate source/expense/tax-line detection against independently reviewed
  corrected active facts. This affects report eligibility only, not accounting capacity.
- Existing independent VAT fact reviews keep their own identity; withdrawal does not invent
  a link to a replacement expense source or silently withdraw unrelated VAT facts.
- Contracts and the SQL sealing owner explicitly select v3 for new drafts. Historical v1/v2
  calculations remain unchanged/readable; amendment comparison now accepts v1/v2/v3 and
  subtracts their saved exact values without recalculation. No legal/rounding rule changed.

#### Shared handoff

Local files:

- `migrations/4500-expense-tax-source-withdrawals.sql`
- `src/db/statements/expense-tax-withdrawals.ts` — `expenseTaxWithdrawalStatements`
- `src/transport/http/routes/expense-tax.ts`
- `../../packages/contracts/src/expense-tax.ts`
- `../../packages/contracts/src/vat-returns.ts`
- `../../jurisdictions/se/src/vat/calculation.ts`

Root-owned integration:

1. Import/spread `expenseTaxWithdrawalStatements` into the shared query owner.
   `withdrawExpenseTaxSource` calls `withdraw_expense_tax_source(token,scope,id,key,input)`.
2. Existing ExpenseTaxApi/handler composition picks up the route. Withdrawal is operator-only
   REST; no MCP approval mutation was added. Existing read capabilities expose the lineage.
3. Add optional `withdrawnSourceCount: Schema.Int` to shared `ExpenseTaxDependencies` for
   historical compatibility. No shared closing-function replacement is required.
4. Add only exhaustive blocker text needed by the schema: expense `withdrawn_source`,
   `duplicate_source_component`, `ambiguous_voucher_sources`; VAT `withdrawn_expense_source`.
   No UI workflow expansion was made by this worker.

#### Source review and checks

Reviewed against0710 source/review/assessment and dependency owners,3700 withdrawal/replay and
VAT draft owners, and the actual TypeScript calculator. Reviewed wrong scope/evidence/digest,
concurrent revision versus withdrawal, late reviews, repeat keys after withdrawal, old snapshot
replay, exact evidence-component aliases, pre-existing duplicates, independent corrected
sources, ambiguous whole-voucher references, downstream VAT duplicate ownership, v1/v2/v3
comparison and unchanged financial capacities. These are source-review findings only.

Owned five TypeScript files passed Oxlint with zero warnings/errors. Owned Oxfmt and
`git diff --check` passed. Shared API/contracts type checks and exhaustive UI integration remain
root-owned. No tests, fixtures, browser work, SQL/runtime execution, migration application,
provider/external actions or VCS history changes occurred. Dynamic behavior remains unverified.

#### Independent review fix: SQL sealing authority

Independent source review identified that the initial v3 SQL sealer fenced direct VAT-fact
withdrawal but did not enforce the derived expense-source withdrawal marker. The runtime role
can call this sealer, so TypeScript calculation alone was not a sufficient authority boundary.

The4500 sealer now also forbids `included_synthetic` when the retained basis has
`expenseSourceWithdrawn:true`. Its separate exclusion fence requires `state:"excluded"`,
JSON-null `contribution` and the explicit `withdrawn_expense_source` blocker. Missing fields
are refused. This reads the actual live basis boolean after complete supplied/live basis
equality, not a caller-authored classification. Existing direct-withdrawal checks and original
successful-key replay remain unchanged. This is a source-reviewed fix, not an executed case.
