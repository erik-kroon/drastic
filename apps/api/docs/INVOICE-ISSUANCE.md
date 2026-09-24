# Synthetic invoice issue review and execution

## Accepted slice and failure cases (before implementation)

An operator reviews a current customer draft and explicitly chooses both accounts, period and voucher series for an exact two-line synthetic journal. Preparation retains the full immutable draft as evidence and seals the kernel posting plan, without posting or allocating a document number. A separate one-hour human approval covers draft, counterpart, amounts, both accounts and the exact kernel plan. The approving operator can execute the whole synthetic issue + posting + customer-register group atomically.

This supports only `synthetic-core-v1` / `synthetic-manual-invoice-v1`, book currency, positive exact totals and explicitly evidenced zero asserted tax. Zero asserted tax is not a real zero-rate tax rule. No legal identity, legal invoice number, cash-method timing, real revenue mapping or VAT profile is activated. Both accounts are explicit operator choices; none are inferred from BAS codes. Delivery remains unimplemented and false.

Failure cases:

- Wrong entity/book, revoked actor or agent authority rejects mutations before replay. Reads require current scoped authority. Only the same still-authorized operator who approved can execute.
- Expected draft revision/digest, counterpart revision and kernel profile/writer/period/account versions must remain current. A changed draft or counterpart invalidates approval; old review records stay readable.
- Missing dates/terms/identity fields, unknown or nonzero tax, unevidenced tax assertion, nonintegral quantity-price product, mismatched source totals or totals outside 1..10^38-1 reject. No inferred rounding or balancing plug.
- Debit control account and credit account must differ, be active and in the book. Neither may be a bank-source account; credit cannot be a commerce control account, and debit cannot be a supplier control account.
- Preparation creates no voucher, invoice register entry or internal document number. No request can substitute accounts, lines, party or draft under an old digest.
- Concurrent execution and changed-key retries cannot create a second issue for a draft or consume the approval twice. The book-locked transactional counter must roll back with every failed aggregate effect; never use a PostgreSQL sequence or MAX(number).
- Kernel posting, its approval consumption/receipt/outbox, customer registration, synthetic issue number/event and aggregate receipt all commit or roll back together. Generic kernel execution of an issue-owned plan must not commit without its matching issue record.
- Draft head edits after issue reject; immutable source/review/issued content cannot be updated or deleted. Register payment state remains separate. No delivery side effect or successful delivery claim exists.
- Exact command replay reauthorizes and returns the saved result even after approval consumption or later dependency changes. GET/history rediscover the saved issue after response loss or reload.
- Bound reviews to 50 per draft and approvals to 50 per review. History returns all bounded summaries or fails; no silent truncation. Retained full-draft evidence uses the kernel's 65,536-character/262,144-byte limit.

## Verification boundary

No tests, fixtures, validation commands, database/migration execution, servers, browser work or external actions are authorized. Implementation and manual source review are not runtime proof. Race, rollback, revoked authority, complete migration, arithmetic and browser observations remain unverified.

## Implemented source

- `migrations/1400-invoice-issuance.sql`: scoped immutable review/approval/issue records, transactional internal counter, draft freeze, and deferred aggregate-posting guard. No previous migration changed.
- `../../packages/contracts/src/invoice-issuance.ts`: five endpoint contracts and two read-only MCP capabilities.
- `src/transport/http/routes/invoice-issuance.ts`: Effect handlers using existing authentication and query ownership.
- `src/db/statements/invoice-issuance.ts`: fixed parameterized Drizzle statements.
- `../web/src/components/commerce/invoice-issuance.tsx` and `invoice-issue-copy.ts`: separate bilingual draft lookup, bounded review history, frozen preparation input, readable commercial/journal lines, evidence inspection, approval/execution and exact JSON download. No existing dirty commerce/UI files changed.

### Caller flow

```text
current draft + explicitly chosen debit/credit accounts, period and series
  → prepare: retained draft evidence + kernel two-line proposal + immutable review
  → approve: exact review digest, one hour, no posting/number
  → execute by the same operator, one transaction
      kernel approval → kernel posting/receipt/outbox
      → transactional SYN counter → customer invoice registration
      → immutable issue/aggregate receipt
  → GET/history recover the durable result
```

This is a functioning source implementation of a bounded **synthetic** issue-and-recognition branch, rather than marking an unrecognized draft “issued.” The mapping is entered explicitly by the operator and displayed as exact journal lines before approval. The debit is the synthetic customer-control account; the other account is an explicit credit choice, not an inferred BAS/revenue/tax account. Recognition uses the existing `synthetic-core-v1` manual-journal profile, with exactly two opposite gross-amount lines and `taxAssessment: not_applicable`. Nonzero or unknown asserted tax rejects. It is not a real zero-rate invoice profile.

Preparation calls `create_evidence` and `prepare_journal` under the book lock; no financial effect occurs. The evidence contains the full immutable draft revision. The review binds that evidence, the draft, counterpart revision, amount derivation and exact sealed kernel proposal. The original source identity/tax evidence remains referenced by the frozen draft. Source total and every source line gross must match exactly. Other draft blockers reject; the three preexisting implementation/legal-profile blockers remain historical facts, not a legal activation.

Execution reauthorizes the current operator before replay, checks exact digest and approval, recomputes current draft/counterpart comparisons and checks kernel profile/writer/account/period dependencies. It invokes existing `approve_change`, `execute_change` and `commerce_create_invoice` in the same database transaction. The kernel approval is created only inside execution, by the same currently authorized human who approved the issue. It cannot be fetched and separately consumed before the aggregate exists. The private internal keys derive from the approval ID. One issue per draft/review/approval, one posting receipt per issue, and unique book/internal number provide business uniqueness independently of request replay.

The counter is a book-locked row, not a nontransactional SQL sequence. Registration or deferred-constraint failure rolls back the counter, voucher number/sequence, posting lines, both approval/receipt sets and posting outbox. An existing synthetic register document colliding with `SYN-<number>` fails the transaction; no hidden number skipping occurs. The number has no legal meaning. Counter exhaustion raises typed `UnsupportedProfile` before kernel approval or posting; it does not fall through to a CHECK-constraint error.

A deferred voucher constraint checks the source **event and retained evidence ID**, not merely one proposal ID. It follows both the event’s source and the voucher evidence references. Public generic posting of the owned proposal, an equivalent proposal, or a new eventKey using that same source cannot commit without the matching issue and posting receipt. Preparation also refuses a retained draft source that already had posted history before ownership was established. The ordinary kernel validator may still report valid journal shape; it does not authorize bypassing the aggregate operation. Existing commerce reversal/correction guards continue to reject posted issue recognition until a linked commerce/issue correction workflow exists. This packet neither implements nor bypasses it.

Issued draft heads cannot advance. Historical draft bodies retain their original `status: draft` and `issued/recognized/delivered: false`: these describe the retained draft revision, not the new live issue record. The separate issue view/history is the authoritative issue overlay. Consumers must not infer current issue status from the immutable draft snapshot alone. The issue receipt has separate `issued: true`, `recognized: true`, `delivered: false`, `legalInvoice: false` and `legalDocumentNumber: null`, plus the kernel posting receipt and customer-register identity. Register settlement remains owned by commerce allocations.

Reads hold a book SHARE barrier. History returns all at most 50 review summaries for the selected draft, including each committed issue identity. Review GET retains old content even when dependencies are stale or authority/profile changed, subject to current read admission. The latest approval is shown with a caller-specific usability envelope: the authenticated reader must be the same currently authorized operator, and the approval must be unexpired. Execution enforces those conditions again. Another review's issue is found through history, not attached to unrelated reviewed content. There is no browser persistence of private drafts or keys; existing `CommandForm` keeps exact retry identity in memory and offers request download.

## Root integration map

The root has connected the shared files and routed and tools UI composition below in source. Runtime acceptance remains open.

1. `packages/contracts/package.json`: export `"./invoice-issuance": "./src/invoice-issuance.ts"`.
2. `packages/contracts/src/api.ts`: import/add `InvoiceIssuanceApi` from `./invoice-issuance`.
3. `packages/contracts/src/capabilities.ts`: import/spread `InvoiceIssuanceCapabilities`. Only the two reads below belong in ordinary MCP.
4. `apps/api/src/index.ts`: import/compose `InvoiceIssuanceHandlers` from `./transport/http/routes/invoice-issuance`.
5. `apps/api/src/db/query.ts`: import/spread `invoiceIssuanceStatements` from `./statements/invoice-issuance` into the fixed statement owner. No new connection owner.
6. `apps/api/src/application/capabilities.ts`: bind the two reads below with the existing `bindCapability`.
7. Mount `InvoiceIssuance` from `@/components/commerce/invoice-issuance` with `{book, locale}` separately from the existing commercial-draft form. It internally keys by entity/book. Make its synthetic-only boundary visible. The existing draft form cannot edit an issued head; SQL rejects it rather than overwriting issued content.
8. Root owns any Drizzle mappings in `db/schema.ts`. New tables are `invoice_issue_reviews`, `invoice_issue_approvals`, `invoice_issue_counters`, `invoice_issues`. Application code calls approved SQL functions only; runtime gets no table writes.

REST prefix: `/api/v1/entities/:entityId/books/:bookId/commerce`. Mutation headers require `Idempotency-Key`. Parameters below omit the leading authenticated token.

| Operation | Route suffix | SQL function | Parameters after token | Response |
| --- | --- | --- | --- | --- |
| `prepareInvoiceIssue` | POST `/invoice-issue-reviews` | `prepare_invoice_issue` | scope, key, JSON input | `InvoiceIssueReview` |
| `approveInvoiceIssue` | POST `/invoice-issue-reviews/:id/approvals` | `approve_invoice_issue` | scope, id, key, JSON input | `InvoiceIssueApproval` |
| `executeInvoiceIssue` | POST `/invoice-issue-reviews/:id/execute` | `execute_invoice_issue` | scope, id, key, JSON input | `InvoiceIssueReceipt` |
| `getInvoiceIssueReview` | GET `/invoice-issue-reviews/:id` | `get_invoice_issue_review` | scope, id | `InvoiceIssueView` |
| `invoiceIssueHistory` | GET `/invoice-drafts/:id/issue-reviews` | `invoice_issue_history` | scope, draft id | `InvoiceIssueHistory` |

```ts
commerce_get_invoice_issue_review: bindCapability(
  Capabilities.commerce_get_invoice_issue_review,
  "getInvoiceIssueReview",
  (input) => [scopeParameter(input.scope), input.id],
),
commerce_invoice_issue_history: bindCapability(
  Capabilities.commerce_invoice_issue_history,
  "invoiceIssueHistory",
  (input) => [scopeParameter(input.scope), input.id],
),
```

### Source-review outcome and remaining limits

Manual source review followed wrong-scope and revoked-authority admission, exact request replay/conflict, changed draft/counterpart/account/period dependencies, approval identity/expiry, competing plans, generic/equivalent posting bypass, counter rollback and immutable issuance. It compared SQL return fields with schemas, fixed statements, handlers and UI consumers. These are reasoned properties of source, **not executed verification**.

No tests/fixtures/checks/builds/browser/database/dependency actions ran. Migration1400 is unapplied. Root shared registration and mounting are connected, including Sales issue navigation and the live draft overlay. Real transaction/deferred-trigger behavior, migration install/upgrade, retries/races, expiry/revocation, arithmetic, JSON downloads, keyboard/narrow/zoom behavior and transport parity remain unverified.

No real-company issuance, legal numbering, VAT determination, cash-method timing, credit notes, supplier issuance, FX, invoice correction/release, payment initiation, rendering, email/Peppol/provider delivery or complete source-coverage claim is added. Those require reviewed profiles and their own authority/acceptance. This branch is explicitly synthetic and cannot be enabled merely by supplying real facts to a request.

## Customer-route overlay amendment

`InvoiceIssuance` accepts optional `recordId` as the initial draft ID. It remounts by entity/book/record, supporting the Sales `view=issue&record=<draft>` route without stale local selection.

`apps/web/src/components/commerce/invoice-draft-issue-overlay.tsx` exports `InvoiceDraftIssueOverlay({book, locale, recordId?, onOpen?})`. The Sales draft view and commerce tools panel use it instead of `InvoiceDrafts`. It reads live bounded issue history before mounting a selected record's draft editor. Initial cached history is not sufficient; failed current reads show an explicit error and no editor. An issued record instead shows a historical/read-only explanation and opens its exact `InvoiceIssueReviewPanel` with `readOnly`, so even inconsistent receipt reads cannot expose mutation forms. Lists carry a prominent retained-snapshot/current-issue distinction; selected unissued records link to the issue route. Existing dirty draft/shared UI remains unchanged.

`InvoiceIssueReviewPanel` is now exported from `invoice-issuance.tsx`, accepting `{book, locale, id, readOnly?}`. No browser, type or runtime verification was run for this source-only amendment.
