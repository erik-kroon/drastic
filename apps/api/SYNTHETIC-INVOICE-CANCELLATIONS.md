# Whole synthetic invoice cancellation

## Failure cases recorded before implementation

- Unissued, foreign-book, legal/delivered or nonnative invoices must not enter cancellation. Original issued drafts/reviews/receipts/artifacts and the SYN counter remain immutable; no number reuse or draft reopening.
- Any active1700 payment allocation must reject cancellation. No implicit unallocation, refund, legal credit, VAT adjustment or delivery is permitted.
- Owner, bank, schedule or correction conflicts must reject; only the exact source invoice ownership is eligible for the owned aggregate exception.
- Source recognition and target reversal periods must be open. Current profile/writer, source/invoice revision/capacity and period/account dependencies must match the sealed human review. No implicit reopen.
- Full inverse recognition must use kernel sealing/approval/execution, exact original event/evidence and line order/accounts/amounts. No partial reversal, replacement journal or extra account mapping is supported.
- Generic prepare/approve/execute of owned evidence, alternate event keys or a saved cancellation plan must never commit without its exact native cancellation aggregate.
- Private execution admission and final cancellation must commit together. Deferred proof must bind voucher, kernel receipt, cancellation review, exact approval and original issue/register identities; there can be no stranded authorization fence or kernel-only reversal.
- Operator approval must expire, be revocable and still be authorized at execution. Same-key replay must reauthorize and lock before returning original success, without fresh-state rejection or duplicate reversal.
- Live invoice/status/capacity must reflect cancellation while retained snapshots stay historical. No future allocation or payment reuse of reversal lines is permitted.
- New as-of reports must retain original recognition and its linked opposite reversal contributions, exclude cancelled capacity only when the reversal falls in the report interval basis, and keep coverage not established.
- Closing currentness must bind cancellation history. Original recognition with a valid cancellation must not become unexplained corruption; invalid/unpaired reversals must remain blocked.
- Interrupted responses must recover through scoped bounded immutable history. Oversized reviews/history must refuse, never truncate.

## Status

Source implementation is saved. Shared integration is root-owned. All behavior remains runtime-unverified. Feature expansion is paused while source-only error review continues.

## Implemented source (runtime-unverified)

Forward migration `2200-synthetic-invoice-cancellations.sql` adds immutable cancellation reviews, approvals, revocations, private execution admissions and final receipts. No historical migration is changed. Whole cancellation is limited to issued1400 native synthetic invoices; original issue/draft/register/document bytes and the SYN counter are untouched.

### Exact reversal and aggregate proof

- Preparation reads the exact issue digest and current registered recognition. It requires no active1700 payment allocations, an open source period and no conflicting owner, bank, schedule or correction resources. A direct1500 `subledger_bases.voucher_id` reference also refuses cancellation, including bases whose schedule recognition already posted. Mapping either recognition account as a bank source also refuses.
- The kernel seals the complete opposite source journal in its original line order and accounts, retaining event/evidence, series and line IDs. The operator chooses the target period/date and reason. The date cannot precede recognition. `inspect_action` enforces target period/year, exact inverse amounts and no reversal-of-reversal.
- The review pins the source-period version, invoice revision/allocation history and full conflict basis. Kernel dependencies pin target period, accounts, writer epoch and profile. Approval and execution recheck both bases.
- Approvals expire after one hour and are individually revocable. Mutations require a current human operator. Only the same current approving operator can first execute an approval. Kernel approval is created inside that same transaction.
- Execution inserts a private immutable admission row immediately before kernel execution. Only its exact change set, original recognition and sealed action can pass the commerce and correction BEFORE guards. Runtime callers have no table writes and cannot set a session flag to claim admission.
- A deferred FK requires every admission to have its final cancellation. Deferred triggers cross-check the final review, original issue/register/voucher, same human approval, consumed kernel approval, exact reversal action and kernel execution receipt.1400's deferred owned-source guard accepts only the matching final cancellation. Generic `correction_require_unbound` stays strict.
- Current authorization and the book lock precede idempotent replay. Same-review/same-approval new-key recovery can return the committed receipt without checking fresh dependencies or reversing again. All financial effects and the receipt commit atomically.

### Live and historical consumers

- Live invoice reads expose `status: cancelled`, zero `effectiveAmountMinor`/outstanding, the original amount/recognition and a cancellation summary. Cancellation increments the live allocation version. This immediately removes allocation capacity even when the selected economic reversal date is later.
- New allocations explicitly reject cancelled invoices. Existing prepared allocations still revalidate their live selection; deferred allocation proofs still require current, uncorrected recognition. Reversal vouchers remain unavailable as settlement capacity. Cancelled register records cannot be revised or reopened. Draft freezes remain unchanged.
- `commerce_recognition_accounted` recognizes either current original recognition or its proven native cancellation for report/closing provenance only. It does **not** relax `commerce_voucher_current`, payment selection or generic correction ownership.
- New register snapshots retain the original invoice and its positive recognition line. At/after the reversal's economic date they include cancelled/effective amounts and explain the matching negative reversal line with `invoiceId`, `cancellationId` and `registerContributionKind: cancellation`. Earlier as-of snapshots retain the original positive economic balance. Control totals keep original recognized amounts and separately report cancelled amounts. Existing saved report bytes remain unchanged.
- `commerce_period_status` includes relevant immutable cancellation history in its source digest. The kernel reversal advances the committed ledger sequence. These dependencies invalidate affected live closing/review bases without changing1510 or rewriting historical certificates.
- Source coverage stays `not_established`; cancellation proves neither company completeness nor legal credit/refund/delivery readiness.

### Bounds and recovery

- Maximum50 reviews per issue,50 approvals per review and256 KiB per complete review. Oversized reviews roll back rather than truncate.
- Scoped status returns the complete bounded review inventory and any final cancellation, including when another retained review completed the cancellation.
- Browser command forms retain exact idempotency requests and provide JSON request/result downloads. Unknown responses can replay the exact command or recover through scoped status/review reads.

## Root integration surface

- Contract module/export: `@open-erp/contracts/invoice-cancellations`; `InvoiceCancellationsApi`, `InvoiceCancellationCapabilities`. The shared summary is `Commerce.InvoiceCancellationSummary`, avoiding a commerce-to-operation schema cycle.
- HTTP layer: `InvoiceCancellationHandlers`; Drizzle statement catalog: `invoiceCancellationStatements`.
- Human-only REST commands: `prepareInvoiceCancellation`, `approveInvoiceCancellation`, `executeInvoiceCancellation`, `revokeInvoiceCancellationApproval`.
- Read capabilities only: `commerce_get_invoice_cancellation` → `getInvoiceCancellation`; `commerce_get_invoice_cancellation_status` → `getInvoiceCancellationStatus`, each using `[scopeParameter(input.scope), input.id]` after token acquisition.
- UI mount: `InvoiceCancellationPanel({ book, locale, issue })` beside the immutable issue-success/document panels. Independent recovery component: `InvoiceCancellationReviewPanel({ book, locale, id })`.
- Shared invoice/register schemas need the agreed optional cancellation fields and contribution literals (`recognition`, `cancellation`, `allocation`, `unexplained`). Root owns exports, shared composition, catalog dispatch, UI mount and existing consumer presentation.

## Verification boundary

Implementation and manual source review are not execution proof. No test/check/build, dependency/toolchain change, DB/migration execution, server, browser/mobile verification, external action, commit or deployment was performed. Runtime, migration, replay/concurrency, transport, rendering and accessibility proof remain outstanding. Do not present source readiness as verified financial or legal readiness.

## Root source integration and review

Package export, shared API group, capability catalog/two read bindings, statement dispatcher and HTTP handlers are connected. InvoiceCancellationPanel is mounted beside the historical issued receipt/document panel. Current invoice status and retained register columns use the additive shared cancellation fields. Independent source review found and owner fixed a missing carrying-basis ownership refusal; subsequent review found no remaining concrete financial blocker. The current-approval keyed form replacement was also fixed by stable retained approval entries. These are source findings only. No type/lint checks, SQL execution, migrations, browser or runtime validation were performed.
