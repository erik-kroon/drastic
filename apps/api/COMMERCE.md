# Synthetic commerce slice

## State

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

## Safety cases to verify before release

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

## Shared composition

The fourteen scoped REST operations are defined in
[`packages/contracts/src/commerce.ts`](../../packages/contracts/src/commerce.ts), adapted in
[`src/commerce.ts`](src/commerce.ts), and dispatched through fixed statements in
[`src/database.ts`](src/database.ts). The thirteen ordinary capabilities share those operations
through [`src/capabilities.ts`](src/capabilities.ts). Operator approval remains REST-only.

The workspace lazy-loads [`CommercePanel`](../web/src/components/commerce/commerce-panel.tsx).
Queries are scoped through the request-scoped TanStack Query client and validate contract responses.
Revision-editor requests survive query refreshes; only an explicit new-command action resets their
captured values and retry key. Browser persistence is not implemented. Save exact values, revision
and key before sending; reload or leaving can lose an unsaved request. JSON export is available only
after sending. This is not crash-safe automatic recovery.

## Implemented authority boundary

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
- Residuals derive from immutable applied legs. There are no parallel mutable balance counters.
  Book-first locking serializes proposals/application. Exact revision, configuration and capacity
  snapshots must match again at operator approval and application. Deferred constraints bind committed
  legs to the approved plan and enforce both invoice and payment capacity.
- Approvals are REST-only, operator-only, exact-digest, expiring records. Application also checks current
  operator membership. Immutable application receipts consume each plan/approval at most once.
- Stable idempotency keys recover committed command responses. Different inputs/actor/operation conflict.
  A plan read also exposes its applied receipt. Clients must retain retry keys across uncertain outcomes.
- Lists and revision history use live keyset pages of 50. These are not frozen whole-register reports.
- New registration requires an open recognition period. Allocation requires an open payment period;
  the invoice may have been recognized in an earlier locked period. Metadata revisions do not rewrite
  the immutable financial identity used by closing dependencies.

## Cross-domain guards

`commerce_voucher_reversal_boundary` is a commerce-owned trigger on voucher insertion. It rejects
reversals/corrections of registered recognition vouchers or applied payment vouchers. Both legacy
reversal-only and bundled corrections pass through this guard. A linked commerce correction/release
workflow is **not implemented**; do not bypass the guard or automatically rewrite residuals.

`commerce_bank_source_boundary` and `commerce_control_account_boundary` keep declared commerce control
accounts separate from registered bank accounts. Ordinary bank-source revision updates are unaffected.
Bank observation/bank-line matching belongs to settlements and never consumes invoice/payment-control
capacity. Commerce does not require a bank match and does not infer that a payment was initiated.

## Closing hook

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

The digest binds immutable recognition sources up to `endsOn` and applied allocation legs with
payment posting dates up to that date. Carry-forward invoices are included. Later-period payments
and nonfinancial display metadata do not rewrite this digest. Nonzero technical error counts block
closing. Unpaid invoices alone do not. `coverage: not_established` always remains explicit.

No tests or fixtures were added. No migration, database mutation, server, build, repository-wide
check, deployment or commit was run by this worker for this slice.
