# Synthetic commerce slice

## Current ownership

Application operations live in [application/commerce/register.ts](../src/application/commerce/register.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### State

Implemented source: shared contracts, Effect REST adapters, applied `0600-commerce.sql`,
and a dedicated lazy-loaded register UI in the accounting workspace. Root composed the REST/MCP
handlers, capability registry and fixed SQL dispatcher. Scoped register list reads returned200.

The UI supports counterpart revisions, registration against existing posted recognition, invoice
metadata/history, posted payment capacity, exact allocation review, operator approval and separate
application. It displays exact minor-unit strings, evidence and explicit synthetic-only limitations.
It does not issue invoices, post recognition, initiate payments or establish legal identity.

Root full types, lint, formatting and web/API dry-run builds pass with the UI. Review corrected
revision-refresh request loss, an unsupported border token and a typed schema-decoder diagnostic.
No browser interaction, complete commerce mutation/recovery exercise, concurrency or rollback proof
is established. Static checks are not an end-to-end release claim.
No production authority, legal-identity verification, VAT determination, payment initiation,
or source-inventory completeness is claimed.

### Safety cases to verify before release

- Unknown, revoked, expired or wrong-book credentials cannot read/write commerce state.
- Agent credentials cannot approve; a removed operator cannot authorize later application.
- Exact retries recover original receipts; changed inputs/actor/operation with the same key conflict.
- Wrong-currency, wrong-sign, wrong-account, corrected, reversal, reused and evidence-mismatched recognition lines reject atomically.
- Duplicate counterparty keys, invoice document identities and recognition lines cannot create duplicate recognition.
- Invoice financial identity and amount cannot be revised; only due date/description/supporting evidence append revisions.
- Partial and split allocations conserve both invoice and posted payment control-line capacity.
- Concurrent proposals may freeze the same capacity; only a fresh approved application may consume it.
- Over-allocation, duplicate invoice legs, different counterparties, same-event recognition/payment and malformed minor units reject.
- Reversed or locked payment references, stale metadata/capacity/configuration, expired/consumed approvals reject before consumption.
- Linked voucher reversals and reclassifying declared control accounts as bank sources reject.
- Any failure rolls back legs, counters, approval consumption and receipt together.
- Domain lists and immutable invoice histories paginate; a page is not a complete register.
- Unpaid invoices do not block technical period close; unknown invoice coverage still blocks completeness claims.

### Shared composition

The fourteen scoped REST operations are defined in
[`packages/contracts/src/commerce.ts`](../../../packages/contracts/src/commerce.ts), adapted in
the [commerce HTTP routes](../src/transport/http/routes/commerce.ts), and dispatched through
fixed database statements. The ordinary capabilities share those operations through
the former application capability registry. Operator approval remains REST-only.

The workspace lazy-loads [`CommercePanel`](../../web/src/components/commerce/commerce-panel.tsx).
Queries are scoped through the request-scoped TanStack Query client and validate contract responses.
Revision-editor requests survive query refreshes; only an explicit new-command action resets their
captured values and retry key. Browser persistence is not implemented. Save exact values, revision
and key before sending; reload or leaving can lose an unsaved request. JSON export is available only
after sending. This is not crash-safe automatic recovery.

### Implemented authority boundary

- Counterparty keys and roles are scoped and immutable. Names and supporting evidence append revisions.
- Invoice natural identity is `(book, direction, counterparty, document number)`.
- Each invoice binds one existing exact recognition control line and its original retained evidence.
  Registering it never creates another ledger event. Economic identity, amount, account and recognition
  references cannot be revised. Due date, description and supporting evidence append revisions.
- Customer control accounts require debit recognition and credit settlement. Supplier control accounts
  require credit recognition and debit settlement. This is an explicit synthetic declaration, not an
  inferred chart/legal classification.
- One allocation plan can split one posted settlement line among at most 50 invoices for one counterpart.
  Partial allocations are supported. Payment and recognition must be distinct events. Advances,
  netting, credit notes, exchange differences and cross-currency allocation are unsupported.
- Residuals derive from effective active allocation legs over immutable originals. Migration1700 excludes whole applications with retained unallocation receipts. Capacity versions count insertion and release history, never only active legs. There are no parallel mutable balance counters.
  Book-first locking serializes proposals/application. Exact revision, configuration and capacity
  snapshots must match again at operator approval and application. Deferred constraints bind committed
  legs to the approved plan and enforce both invoice and payment capacity.
- Approvals are REST-only, operator-only, exact-digest, expiring records. Application also checks current
  operator membership. Immutable application receipts consume each plan/approval at most once.
- Stable idempotency keys recover committed command responses. Different inputs/actor/operation conflict.
  A plan read also exposes its applied receipt. Clients must retain retry keys across uncertain outcomes.
- Lists and revision history use live keyset pages of 50. These are not frozen whole-register reports.
- The additive [register snapshot slice](REGISTER-REPORTS.md) captures bounded immutable ageing and declared-control-account comparisons separately. Its source is implemented; shared integration and runtime/browser verification are separate gates. It retains explicit `coverage: not_established`.
- New registration requires an open recognition period. Allocation requires an open payment period;
  the invoice may have been recognized in an earlier locked period. Metadata revisions do not rewrite
  the immutable financial identity used by closing dependencies.

### Cross-domain guards

`commerce_voucher_reversal_boundary` is a commerce-owned trigger on voucher insertion. It rejects
reversals/corrections of registered recognition vouchers or payment vouchers with active allocations. Both existing
reversal-only and bundled corrections pass through this guard. Migration1700 adds [reviewed whole-allocation unallocation](COMMERCE-ALLOCATION-REVERSALS.md), not invoice-recognition correction. Original allocations remain immutable. The1400 issue guard is unchanged; no generic bypass or automatic residual rewrite is permitted.

`commerce_bank_source_boundary` and `commerce_control_account_boundary` keep declared commerce control
accounts separate from registered bank accounts. Ordinary bank-source revision updates are unaffected.
Bank observation/bank-line matching belongs to settlements and never consumes invoice/payment-control
capacity. Commerce does not require a bank match and does not infer that a payment was initiated.

### Closing hook

Private `openerp.commerce_period_status(p_book text,p_starts date,p_ends date)` must be called by the
closing authority under its book lock. Its bounded response is:

```text
schemaVersion: 1
coverage: "not_established"
startsOn, endsOn: ISO dates
registeredInvoiceCount: number
invalidRecognitionCount: number
invalidAllocationCount: number
conservationFailureCount: number
sourceDigest: sha256-prefixed digest
blockers: string[]
```

The digest binds immutable recognition sources up to `endsOn`, active allocation legs and retained whole-unallocation history with
payment posting dates up to that date. Without relevant unallocations the previous digest shape is preserved. Carry-forward invoices are included. Later-period payments
and nonfinancial display metadata do not rewrite this digest. Nonzero technical error counts block
closing. Unpaid invoices alone do not. `coverage: not_established` always remains explicit.

No tests or fixtures were added. No migration, database mutation, server, build, repository-wide
check, deployment or commit was run by this worker for this slice.

### Separate native commercial drafts

The [invoice-draft packet](INVOICE-DRAFTS.md) adds an operator-owned, bounded customer commercial-draft path in migration1200. It is separate from this module's posted-recognition registration. It retains source identity evidence, exact line amounts/discounts/charges, unknown tax facts, totals and immutable editable-by-supersession revisions. Native commercial draft saving does not allocate legal invoice numbers, post, register a receivable, activate tax treatment or deliver. The local panel labels both paths separately. Source implementation is not runtime verification, and issuance/recognition/delivery dependencies remain open.

### 6500 allocation approval recovery — pre-edit failure contract

A supported sequence can approve one allocation plan twice (A1, then A2) and apply it
with still-valid A1. The old getter selects A2 by latest expiry, but the application
receipt names A1. Existing REST/MCP `AllocationView` and the commerce allocation review
then recover an approval that did not authorize the retained application.

The approved repair changes only `commerce_get_allocation` in a forward migration:

- Preserve authorization, the book SHARE barrier, scoped plan lookup and currentness.
- Read the immutable application row first. Its scoped `approval_id` foreign key owns
  committed approval identity; require the approval to belong to the same plan.
- Confirm receipt and approval body identities agree with their rows and the saved plan.
  Missing or inconsistent committed linkage must refuse, never fall back to another approval.
- Recover the consumed approval after expiry or whole-allocation unallocation. This is
  historical evidence, not fresh execution authority. Do not filter it by live membership.
- Without an application, preserve the existing latest-approval query and ordering exactly.
- Preserve stored bodies, successful command replay, writes, capacity/correction guards,
  grants, schemas, shared wiring and UI. Do not add an artifact or approval-selection policy.

Source inspection is the authorized check. No tests, SQL compilation/application, runtime,
provider calls or VCS actions are authorized. Runtime recovery remains unverified.

#### Implemented source and validation limit

`migrations/6500-commerce-allocation-approval-recovery.sql` replaces only the existing
getter. It loads the application row under the unchanged book SHARE barrier. A committed
read follows that row's `(book_id, approval_id)` foreign key and requires the same plan
and plan digest. It checks approval body ID/plan/digest and application body
ID/plan/approval/digest against the retained row identities. Inconsistent linkage raises
`UnsupportedProfile`; another approval is never substituted. Expiry and later unallocation
do not filter or rewrite the historical consumed approval. Pending reads retain the old
latest-expiry/ID ordering, including its existing null and expired-approval behavior.

The returned `plan`, `application` and `dependenciesCurrent` owners are unchanged.
REST/MCP and existing allocation review screens already decode `AllocationView`; no shared
integration or schema change is needed. No write, replay, grant or financial guard changes.

Source comparison confirmed the authorization/plan-read prefix and returned currentness
expression are unchanged, and the pending approval query differs only in branch indentation.
No tests or SQL/runtime validation ran. The migration remains unapplied and runtime-unverified.
