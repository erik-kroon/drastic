# Technical period close and reopen

## Status and limits

Implemented source, not runtime-verified. No migration, database write, browser session, build, filing, deployment or new test was run by this domain owner. Owned-file lint is a static check, not failure/recovery proof.

This module supports **synthetic technical period locking only**. A lock is not a statutory close, a company-completeness certificate, an annual report or an authority receipt. It performs no profit transfer or fiscal carryforward. INK2, SIE, iXBRL, signing and filing remain blocked by reviewed schemas, real company facts, qualified review, verification and authority. An internal trial balance is never called an annual report.

## Workflow

```text
Retain source-inventory evidence
  → operator declares expected synthetic bank accounts for the period
  → refresh technical prerequisites
  → prepare immutable close/reopen proposal
  → operator approves exact digest (15-minute expiry)
  → execute with exact approval + digest
  → atomic period version/lock + immutable receipt (+ technical certificate on close)
```

The inventory explicitly lists expected book bank account IDs, not merely accounts discovered in imports. An empty list is an explicit operator declaration of no bank sources for this synthetic scope. Every expected account must have a mapped retained source, and every observed source must appear in the declaration. An unimported expected account blocks locking. Retained evidence and the declaring operator are bound into the proposal.

This narrow bank declaration never establishes a complete company source inventory. Missing invoice systems, tax accounts, payroll, owners' balances, assets, disclosures or other obligations remain statutory blockers. Installed commerce and schedule modules expose represented state, not company completeness.

## Dependencies

Migration `0800-technical-period-closing.sql` requires existing kernel/report migrations and these private domain hooks before first use:

- `openerp.bank_close_dependencies(text,date,date)` from imports: deterministic represented-source identities/revisions and fresh exact-interval reconciliation selection, including v1 and partial-capacity v2.
- `openerp.commerce_period_status(text,date,date)` from commerce: registered recognition/allocation validity and conservation, through period end. Ordinary unpaid invoices are not blockers.
- `openerp.subledger_close_dependencies(text,date)` from subledgers: due unprepared/unposted/reversed occurrences and deterministic schedule state. Conflicted occurrences are included in due unposted.

Each hook runs under the caller-held book lock. It is not exposed directly to `openerp_runtime` or PUBLIC. Do not replace an absent hook with an empty or successful result.

A proposal binds the exact readiness body, including:

- book committed sequence, profile version and writer epoch;
- period version, dates, fiscal-year bounds and prior/overlapping period state;
- account versions;
- declared expected bank inventory, evidence hash and actor;
- observed bank-source revisions and selected immutable reconciliation identities;
- current balanced exact-period trial-balance snapshot;
- represented commerce and schedule dependency snapshots.

Technical close rejects overlapping posting periods or a period outside its fiscal year. All known bank sources need fresh complete exact-period reconciliation. All represented due schedule occurrences must be posted and unreversed. Commerce invalid recognition, invalid allocation or conservation failures block closing.

This first implementation deliberately binds the whole book ledger sequence and all account versions. An unrelated posting or account edit can require a new proposal/report. This conservative policy costs extra reviews; it must not be described as fine-grained dependency invalidation. Larger or fragmented bank intervals are still bounded by the underlying report modules; no partial report is accepted as complete.

## Reopen and retained history

Reopen requires the same exact proposal/approval/commit protocol but can proceed when close prerequisites have become blocked. That makes repair possible without silently editing period state.

Reopen increments the period version and sets `locked=false`. It appends invalidations for technical certificates and internal report snapshots ending on or after the reopened period start. It records bank-v1 invalidations and rejects both bank-v1/v2 reconciliation candidates created at or before the latest relevant reopen. A new current report is required before closing again.

Later periods can depend on earlier opening balances. Their certificates and report readiness are invalidated, but their lock flags are not silently changed. Operators must explicitly reopen those periods if they need a replacement certificate. Old vouchers, journal lines, report snapshots and certificates remain unchanged. The old report APIs still return their historical bytes; callers must not interpret existence as current closing readiness.

Certificate lookup returns immutable content and digest separately from live `current` and `invalidatedBy`. A dependency change also makes `current=false`, even without a reopen. The certificate digest uses the existing PostgreSQL canonical JSON/digest convention over the certificate body without its own `digest` field.

## Transaction and authority boundary

Mutations use existing credential/membership admission, then lock book first and period second. Every mutation has a stable command receipt scoped to book, actor, operation and exact input. Approval and execution recompute dependencies under the book lock. Operator authority for the approval is rechecked and share-locked at execution. Immutable transition uniqueness consumes an approval/proposal once. Retrying a committed execution with the same proposal/digest/approval returns the original receipt, including with a new command key; a different approval is rejected.

Close/reopen changes only the period lock through this explicit command. It does not write ledger lines or vouchers. The existing period version trigger invalidates prepared journal dependencies. Existing credential/member revocation rules remain unchanged. Every public SQL entry point authorizes the scoped book; internal helpers and tables are explicitly revoked from PUBLIC and runtime.

All closing records are append-only: inventories, proposals, approvals, transitions, certificates and invalidations. PostgreSQL storage and operations' local snapshot coverage are not proof of compliant retention, external archive or tested restore. D-07 remains open.

## Shared integration

Contracts export `ClosingApi` and `ClosingCapabilities` from `@open-erp/contracts/closing`. Root adds them to shared API/capability composition and registers `ClosingHandlers` from `apps/api/src/closing.ts`.

| Database operation        | SQL function                | Parameters after token, scope           |
| ------------------------- | --------------------------- | --------------------------------------- |
| `declareClosingInventory` | `declare_closing_inventory` | periodId, key, input JSON               |
| `closingReadiness`        | `get_closing_readiness`     | periodId                                |
| `prepareClosing`          | `prepare_closing`           | periodId, key, input JSON               |
| `getClosingProposal`      | `get_closing_proposal`      | proposalId                              |
| `approveClosing`          | `approve_closing`           | proposalId, key, input JSON             |
| `executeClosing`          | `execute_closing`           | proposalId, key, input JSON             |
| `closingHistory`          | `get_closing_history`       | periodId, after-version or empty string |
| `getClosingCertificate`   | `get_closing_certificate`   | certificateId                           |

Use fixed parameterized `SELECT openerp.function($1::text,$2::jsonb,...) AS result` statements. Capability definitions contain exact input/output schemas. Inventory declaration and approval are operator-only REST operations and are not ordinary MCP capabilities.

Mount `ClosingPanel` from `apps/web/src/components/closing/panel.tsx` with `{book, setup, locale}`, keyed by `book.id`. It uses the existing request-scoped TanStack Query client, response contracts, stable in-memory retry keys, owned UI/StyleX primitives and local English/Swedish copy. It offers declaration, preparation, exact review/approval/commit, proposal recovery, paginated history and live certificate status.

## Required runtime observations (not performed)

Root must serialize permitted local execution. Static success cannot establish any of these:

- Undeclared inventory, an unimported declared account, incomplete/revised bank evidence, stale trial balance and unposted schedules block close.
- Exact operator approval commits one lock/version/receipt/certificate, and the normal journal kernel rejects posting into the locked period.
- Reopen appends invalidations, permits an explicit newly prepared journal workflow, preserves old journals/snapshots and requires fresh close prerequisites.
- Changed dependencies, expired approval and revoked approving membership reject execution without partial state.
- Same-key retry and lost-response recovery return the same committed receipt; wrong scope and changed-key payloads do not leak/replay another operation.
- Concurrent posting/import/registration/schedule mutation versus closing obeys lock order and cannot commit stale readiness.
- Rendered keyboard, narrow-width and 200% zoom behavior are usable. Source structure alone does not verify browser behavior.


## Owner and expense-review integration risks (recorded before0820)

-0820 must replace only the private live closing basis in a new forward migration. Existing0800 bytes, certificates, approvals and receipts remain unchanged. Older proposals lack these dependencies and must become stale rather than receive implied approval for new checks.
- Capture and recheck owner `sourceDigest` and expense-tax `basisDigest` under the existing book barrier. Unresolved/unlinked owner sources and missing/stale expense reviews block technical close. Unpaid but linked owner expense/loan claims do not block it merely because capacity remains.
- Empty provider inventories do not establish source completeness, zero openings, no liabilities or tax eligibility. Reviewed facts are not statutory acceptance. Reopen remains available for repair when close prerequisites fail.
- Accountant packs must materialize provider-owned source/review/controls and explicit outside-interval rows at one basis. Bound owner identities/sources/effects/allocations and expense sources before materialization; fail atomically rather than omit rows.
- Reuse provider control/assessment helpers, without recreating owner allocation or tax eligibility rules. Expense assessment is captured in `actual_review` mode: no tax contribution or legal profile is activated by this package.
- Old pack bytes/page meanings must not change.0810 remains unapplied and may be extended before root applies it;0820 independently upgrades current closing behavior. Root owns migration ordering, runtime observations and concurrency proof.


##0820 forward owner/expense-review checks

`0820-closing-owner-tax-dependencies.sql` replaces only private `closing_basis(text,text)`; applied0800 remains unchanged. It requires0610 owner register and0710 expense review. Existing authorized close/read/approve/execute calls already hold the book barrier and automatically consume the replacement.

The new basis includes `ownerTaxStatus`, `dependencies.ownerSourceDigest` and `dependencies.expenseTaxBasisDigest`. Owner unresolved reviews and unlinked records through period end block technical close. Expense missing/stale source reviews (conservatively book-wide) block close. Independently, every represented expense source blocks close coverage because supported posting/ledger reconciliation is unavailable, including sources with digest-current but unknown reviews. Unpaid linked owner claims are not errors. These checks do not certify opening balances, owner repayment rights, tax eligibility or source/control completeness.

Existing proposals/certificates retain their original bytes/digests. Their contracts allow absent provider fields for historical decoding, and the UI identifies that legacy scope. Comparing their old basis to the new live basis makes unexecuted old approvals stale and old certificates noncurrent. Existing committed command receipts still replay exactly. Repair through a newly prepared explicit reopen remains available; no old lock or journal is silently changed.

Owner/tax mutation after proposal capture changes the pinned provider digest and fails existing approval/execution basis equality. Actual race/failure behavior remains for root runtime validation; this source change is not that proof.


### Additional pre-change risk review

A digest-current expense review can still contain unknown facts. Zero missing/stale reviews must never imply resolved tax treatment or ledger reconciliation. The current provider supplies neither posting nor reconciled close coverage, so any represented expense source conservatively blocks that coverage check, even after review. No represented sources does not prove company completeness. Count owner sources/effects/allocation legs before calling aggregating provider hooks; refuse unsupported sizes without truncated digests.

Before the owner/tax hooks, bounded count queries refuse more than1000 owner sources/effects,5000 allocation legs or200 expense sources. No partial provider digest is returned. This limit applies to every live closing-basis caller (including readiness/reopen); larger books need a supported larger-scope implementation.
