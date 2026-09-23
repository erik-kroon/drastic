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

Existing proposals/certificates retain their original bytes/digests. Their contracts allow absent provider fields for historical decoding, and the UI identifies that narrower saved scope. Comparing their old basis to the new live basis makes unexecuted old approvals stale and old certificates noncurrent. Existing committed command receipts still replay exactly. Repair through a newly prepared explicit reopen remains available; no old lock or journal is silently changed.

Owner/tax mutation after proposal capture changes the pinned provider digest and fails existing approval/execution basis equality. Actual race/failure behavior remains for root runtime validation; this source change is not that proof.

### Additional pre-change risk review

A digest-current expense review can still contain unknown facts. Zero missing/stale reviews must never imply resolved tax treatment or ledger reconciliation. The current provider supplies neither posting nor reconciled close coverage, so any represented expense source conservatively blocks that coverage check, even after review. No represented sources does not prove company completeness. Count owner sources/effects/allocation legs before calling aggregating provider hooks; refuse unsupported sizes without truncated digests.

Before the owner/tax hooks, bounded count queries refuse more than1000 owner sources/effects,5000 allocation legs or200 expense sources. No partial provider digest is returned. This limit applies to every live closing-basis caller (including readiness/reopen); larger books need a supported larger-scope implementation.

## END-01 family inventory: scope and acceptance before0930

Planned slice: an operator declares every close family for a synthetic period as required,
not applicable, unsupported or unknown. Every decision includes a real calendar review date,
rationale and retained evidence in this book. The server retains evidence hashes and reviewer
identity. The existing bank-source list remains required. The declaration never claims
company completeness or statutory readiness.

The new live basis always requires the complete family inventory. Earlier bank-only inputs
and exact command replays remain supported and explicitly labeled, but do not satisfy the
new gate. Historical proposals, certificates and receipts keep their bytes and decoding;
old unexecuted approvals become stale. New reopen proposals remain available while checks
fail. No applied migration is edited.

Failure/acceptance cases (recorded before source changes; not new tests):

- Missing, duplicate, unknown or extra families/fields, invalid status/date, blank rationale,
  wrong-book or missing evidence refuse atomically. Exactly one declaration per named family
  is required. A future review date is refused at declaration; stored dates do not change later.
- Not-applicable decisions cannot hide represented bank accounts, registered invoices,
  expense sources, owner records or schedules. All existing provider failures stay mandatory
  regardless of declarations. Missing module rows never supply a default decision.
- Required bank checks use the explicit expected bank list and existing exact reconciliation.
  Other provider families expose their represented-state checks AND unavailable full coverage;
  required missing/unsupported controls block rather than treating a balanced ledger as proof.
  Required payroll, FX, other balances, external schedules and disclosures have no provider
  and remain blocked. Unsupported and unknown declarations always block.
- Evidence hashes, declaration revision, provider basis and statuses enter the proposal basis
  and dependency digest. Replacing the declaration or changing a provider after preparation
  must stale approval/execution under the existing book barrier. No declaration edits history.
- A complete evidenced synthetic no-obligation inventory may pass its family gate only when
  no represented records contradict it; independent bank/report/profile/period checks still
  apply. This is not proof of a real company's lack of obligations.
- Exhausted bigint inventory revisions refuse before incrementing; no raw overflow or partial declaration is saved.
- Operator-only declaration, scope admission, same-key replay/conflict, immutable append,
  approval expiry/revocation, and lock ordering remain owned by the existing SQL workflow.
- UI exposes every decision, evidence/date/reviewer and unavailable check, labels historical
  bank-only scope, preserves drafts on failures, and leaves explicit repair/reopen available.
  Keyboard, narrow-width, zoom and actual API/database outcomes need root verification.

No new tests/fixtures, database execution, browser session, build or repository-wide checks
are authorized for this domain owner. Root must exercise the accepted cases through the
real scoped API/browser and retain receipts before marking them verified.

## 0930 implementation and integration (source only)

`0930-closing-family-inventory.sql` replaces only `declare_closing_inventory` and private
`closing_basis`. It adds no tables, grants no new runtime privileges and edits no applied
migration. Existing scoped REST/MCP/read/approval/execution bindings call these functions
unchanged. No shared composition or database dispatcher edits are needed.

The existing operator-only inventory endpoint accepts optional `families`. When supplied,
it must contain exactly one decision for each of `bank_sources`, `invoices`, `tax`, `payroll`,
`assets_deferrals`, `foreign_currency`, `owner_balances`, `other_balances`,
`external_schedules` and `disclosures`. Each has `status`, `reviewedOn`, `evidenceId` and
`rationale`. Status is `required`, `not_applicable`, `unsupported` or `unknown`.
The saved declaration adds a period-local revision, evidence hashes, actor and timestamp.
Old inputs retain `synthetic_bank_sources_only`; new inputs retain
`synthetic_family_inventory_v1`. Exact old receipts replay before new validation.

Every new readiness result identifies `inventoryScope: synthetic_family_inventory_v1` and
returns per-family declaration, represented count (null when unavailable), provider version,
passed/failed/unavailable checks and `coverage: not_established`. An additional mandatory
`CompleteFamilyInventory` check blocks missing declarations. `familyInventoryDigest` binds
the retained inventory and assessment in dependencies. Historical contracts allow these
new fields to be absent; their absence is visibly labeled as narrower saved scope, not backfilled.
Existing approval/execution basis equality supplies the transactional stale check.

Bank-required readiness reuses explicit inventory and exact reconciliation checks. Other
families currently lack full source/control coverage, even where represented-state providers
exist, so `required` blocks them. This conservative limit is deliberate, not evidence that
their activity is unsupported for all other product workflows. A dated `not_applicable`
decision can satisfy applicability only without contradicting known represented records or
waiving an existing failed check. Unavailable checks remain visible even in such a decision;
this is a synthetic operator assertion, not domain/legal activation. The existing expense,
owner, bank, commerce and schedule checks remain mandatory independently.

New reopen proposals still use the current basis but are not conditioned on passing close
checks. Old certificates and plans remain immutable and readable; they become noncurrent
or stale after the live dependency shape changes. Committed receipts remain replayable.
Statutory readiness is still always false. No financial close, opening set, tax release,
SIE/statutory artifact or filing is implemented here.

The domain UI submits all decisions through the existing form, displays date/evidence/reviewer
and retained revision, explains unavailable controls and labels narrower saved scope. It uses the
owned field/select/table components and native fieldsets/disclosures. Draft fields are not
reset by server rejection. Request keys are retained in memory as before; reload recovery
reads the retained declaration rather than promising durable unsent drafts.

Validation by this owner: owned-file formatter and type-aware lint passed; contract workspace
type check passed. No database migration, real API flow, browser rendering, concurrency,
fault/recovery or company behavior was exercised. The pre-change acceptance cases above
remain root-owned runtime gates. Effect Schema length validation uses installed
`isMinLength`/`isMaxLength`; no unsupported helper remains.

## VAT dependency integration — risk contract before1001

Forward-only1001 will extend live closing and accountant-review dependency capture after1000.
Applied0930 and every older migration stay byte-for-byte unchanged. No existing stored proposal,
certificate, pack, artifact or receipt is rewritten. Optional response fields preserve old decoding;
missing historical VAT scope is labelled as missing, never reconstructed into the saved record.

Failure cases and ownership:

- A VAT fact or even a draft-only inventory must contradict tax `not_applicable`. Count both
  representations; neither can bypass family checks. Required tax still lacks complete controls.
- Pin the entire private `vat_return_dependencies` result, including draftCount and all unavailable
  readiness flags, not only its fact basis digest. New drafts do not change the fact digest but must
  change close/pack currentness. Fact revision, linked expense freshness, posting and reversal do too.
- All live hooks execute inside the caller's established book lock. Approval, uncommitted execution,
  proposal/certificate reads and accountant capture/currentness must observe the same extended basis.
- Replayed committed commands return their old stored result before recomputing dependencies.
  Old pending approvals become stale against the new shape. Reopen remains available for repair.
- Exceeding a bounded VAT provider refuses new capture. Historical accountant pack reads must still
  return retained content with dependenciesCurrent=false instead of calling an over-bound provider.
- New accountant JSON and CSV manifests must retain the complete hook; a visible unavailable VAT
  control row must explain source and draft counts. Do not turn synthetic calculations into real tax.
- Old artifact bytes/hashes are never regenerated. Generation version identifies new pack output.

This task adds no tests or fixtures and runs no validation commands. Source review cannot prove
SQL execution, migration behavior, concurrency, decoding or rendering.

## 1001 VAT closing/accountant integration (implemented source; unvalidated)

`1001-closing-vat-dependencies.sql` is a new forward migration after0930 and1000.
It replaces `closing_basis`, `accountant_review_providers_bounded`,
`accountant_review_basis` and `prepare_accountant_review`. It edits no old migration,
adds no table, grants no new capability and leaves every historical stored body unchanged.

Live closing now retains the whole private VAT hook at `ownerTaxStatus.vatReturns` and
hashes that whole object as `dependencies.vatReturnDependencyDigest`. The tax family's
represented count includes expense-source records, VAT fact components and saved VAT
drafts. This counts representations, not distinct taxable transactions; a linked expense
and its VAT fact can both be represented. Nonzero VAT sourceCount **or** draftCount fails
`VatReturnControlCoverage` and contradicts a tax-not-applicable declaration. Required tax
still fails the existing unavailable `FullFamilyCoverage`; no empty provider proves
non-applicability or complete tax reconciliation.

The hook is deliberately book-wide. A source/draft outside the selected period still changes
live currentness and prevents a not-applicable shortcut. A finer period-scoped provider is
not claimed. The full hook includes draftCount because creating a saved VAT draft does not
change its source/ledger basisDigest. Pinning only that digest would miss a draft-only change.

### Currentness and replay consumers inspected in source

| Consumer                                       | Existing boundary                        | Effect of the extended provider                                                                                |
| ---------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `get_closing_readiness`                        | Shared book and period locks             | Returns new checks, whole hook and digest.                                                                     |
| `prepare_closing`                              | Exclusive book then period locks         | Captures new immutable basis; close requires all gates; reopen still permits repair.                           |
| `get_closing_proposal`                         | Shared book lock                         | Exact live/stored basis equality now includes VAT.                                                             |
| `approve_closing`                              | Exclusive book then period locks         | A changed hook or old basis shape refuses a fresh approval; a completed key replays first.                     |
| `execute_closing`                              | Exclusive book then period locks         | Exact basis comparison fences uncommitted execution; prior committed receipt recovery runs before currentness. |
| Certificate creation/read                      | Caller-held book lock                    | Effective dependencies contain full-hook digest; later hook changes make the certificate noncurrent.           |
| `prepare_accountant_review`                    | Exclusive book lock                      | Pins whole hook in ReviewBasis and JSON; every CSV manifest providerBasis retains the whole hook.              |
| `get_accountant_review`                        | Shared book lock                         | Whole ReviewBasis digest includes VAT; over-bound provider returns old pack with dependenciesCurrent=false.    |
| Stored pack rows/artifacts and command replays | Existing scoped immutable reads/receipts | Return saved meanings and bytes; no live data backfill or regeneration.                                        |

The accountant bounded-provider guard now includes200 VAT fact components and500 saved
drafts before calling the hook. New captures fail on overflow; historical currentness reads
skip the over-bound live basis rather than losing access to the old pack. New packs add an
unavailable `vat_return_controls` coverage row with source/draft counts. They use generator
`accountant-review-v2`; old `accountant-review-v1` records remain accepted unchanged.

Shared contracts add optional `VatReturnDependencies` fields for old-record decoding and
optional `vatReturnDependencyDigest`. The local closing review shows captured VAT counts,
basis digest and unavailable coverage; absence is labelled historical scope, never zero.
The accountant inspector already renders the captured basis and coverage rows, so it needs
no new UI section or raw-data reinterpretation.

No root API/capability/SQL-dispatch wiring is needed for1001: existing callers reach the
replacement functions. Root must keep migration ordering1000→1001 and include the contract
changes with the application. Migration application and all checks remain unperformed here,
as requested. This is implementation presence and source review, not verified SQL behavior,
concurrency/replay proof, rendered UI or financial readiness.

## Closing-proposal discovery (4800): failure contract before implementation

The existing known-ID read cannot rediscover an unexecuted proposal after a lost response or
session ID. `get_closing_history` lists only committed transitions, not every saved proposal.
The new read must reuse saved proposals and optional immutable execution references only.

- Authorize the current book before period/proposal lookup. Unknown or foreign-book periods
  refuse; an existing period with no proposals returns an honest empty page.
- Return at most50 complete immutable summaries, with a51st-row continuation probe. No global
  history truncation; every saved proposal is reachable through stable C-ordered IDs.
- Cursor binds period + actual proposal anchor within the authorized book. Malformed, switched
  period, cross-book and absent-anchor cursors refuse instead of silently skipping history.
- Freeze labels/reason/interval/cutoff to each proposal's retained body. Never fetch live provider
  state or reinterpret old technical scope as current. Oversized/stale providers cannot hide it.
- Optional execution IDs come only from existing immutable transition rows. No transition means
  no retained execution, not pending approval, current eligibility or a failed execution.
- Exclude approval IDs/tokens, expiration/approval payloads and command keys. Discovery confers no
  approval/posting authority; use the existing known-ID detail owner for basis/currentness.
- Discovery is live, not a captured inventory: later random IDs may sort before a cursor. Restart
  from the first page for new arrivals; do not promise a complete concurrent point-in-time list.
- No writes, preparation, artifact generation, company/legal facts or closing state transitions.

### Implemented discovery consumer and recovery semantics

`GET /api/v1/entities/:entityId/books/:bookId/periods/:periodId/closing-proposals`
and read-only MCP `periods_list_closing_proposals` rediscover all saved close/reopen proposals
for one authorized period. This fills the gap between preparation and known-ID recovery:
existing closing history still lists committed transitions, while this collection also returns
never-executed proposals. No report, preparation, approval, artifact or transition is created.

Each page returns at most50 full summaries, with ID/digest/action/reason/proposer/time and the
proposal's captured interval and ledger sequence. Account/source/provider state is never read.
`execution` contains only retained transition and optional certificate IDs, or null when no
execution row is retained. It excludes the transition's approval ID and all approval/command
material. Null is not an assertion of pending approval, failed execution or current eligibility.
The unique existing transition-per-proposal constraint prevents duplicate result rows.

The response explicitly says `discovery:live_saved_proposal_history`,
`liveReadinessChecked:false` and `approvalAuthority:false`. Use existing `getClosingProposal`
for full saved details and its separate currentness result; opening a listed proposal does not
make it current or approvable. Stale or over-bound live providers do not prevent this collection
from returning history because it never calls `closing_basis` or any provider helper.

The cursor is `periodId:proposalId`. It binds a real saved proposal within the authorized book
and period; malformed/switched-period/missing anchors refuse. All paging comparisons, ordering,
maximum ID and the new `(book_id,period_id,id COLLATE "C")` index use the same stable C order.
A51st-row probe determines continuation. There is no global history cap or silently truncated
collection. The final saved ID can be resumed to a valid empty final page; an existing empty
period returns an empty first page. Current authorization is required for every request.

Saved proposal fields are immutable. Discovery itself is live: a later new random ID may sort
before the current cursor, and a previously unexecuted proposal can acquire its first immutable
execution reference. Restart from the first page to discover such later arrivals. This is not a
new point-in-time inventory or a promise that concurrent listing observed all future records.

Owned implementation:

- `migrations/4800-closing-proposal-discovery.sql`: one read function and matching scope/order index.
- `packages/contracts/src/closing.ts`: additive schemas, GET endpoint and read-only capability.
- `src/transport/http/routes/closing.ts`: delegates to the same capability.
- `src/db/statements/closing.ts`: new `closingDiscoveryStatements` query fragment.

Root integration: spread `closingDiscoveryStatements` in the shared query registry and add:

```ts
periods_list_closing_proposals: bindCapability(Capabilities.periods_list_closing_proposals, "listClosingProposals", (input) => [
  scopeParameter(input.scope), input.periodId, input.after ?? "",
]),
```

Existing `ClosingApi`, `ClosingCapabilities` and `ClosingHandlers` composition covers the local
additions; no package export, API group, table mapping or other shared change is needed. Root owns
shared type checks and migration scheduling. Historical migrations and known-ID handlers are
unchanged. The new runtime grant is only authenticated function EXECUTE, never table access.

Pending observations if separately authorized: known/foreign/empty periods; lost-response pending
proposal rediscovery;50/51+ records; malformed/switched/absent-anchor cursors; no duplicates or
omissions across a quiescent history; restart for new arrivals; retained execution ID only;
provider overflow independent recovery; stale proposal not presented as current authority; and
all earlier captured fields unchanged. Source inspection is not database/transport proof.

Owned-file4800 checks: `oxfmt --write` passed for the three TypeScript modules and two domain
documents; `oxlint` passed for the three TypeScript modules with zero warnings/errors. Source
inspection confirmed the read function references only authorization, periods, saved proposals,
immutable transitions and typed refusal—not live providers or writes.0800 stayed unchanged.
No shared typecheck, tests/helpers/fixtures, SQL execution/migration application, runtime,
UI/browser, provider/external/dependency/deployment or VCS action was performed.
