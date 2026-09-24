# Native customer-invoice commercial drafts

## Authority and accepted schema (before implementation)

This COM-01 subset retains unissued customer-invoice drafts independently of the posted recognition register in migration0600. Scoped operators create and append revisions in native-writer books. Ordinary scoped readers may inspect drafts. No invoice number, journal, open item, tax/profile activation, delivery intent or payment instruction is created. Seller/customer identities are source assertions backed by retained evidence, never verified legal identities.

Each draft has a book-scoped caller-chosen stable draft key, an internal ID, immutable content revisions and a current revision pointer. Content retains a title, existing customer counterpart ID/revision, explicit seller/customer legal-name/registration/tax/address/country facts with evidence, book currency/scale, planned issue/supply/due dates, payment terms and 1–50 stable line identities. Missing optional facts are null, not empty strings or eligibility defaults. Revisions require the expected revision and digest plus a reason. All command replay and writes serialize under the existing book lock after current operator authorization.

Line amounts use canonical integer minor-unit strings: explicit base, discount, charge, nullable asserted tax, and nullable source gross. Quantity is a canonical positive decimal (at most 12 integer and 6 fractional digits); unit price is nullable exact minor units. The named calculation basis is explicit_line_amounts_v1. Net is base minus discount plus charge. Tax and gross totals stay unknown if any tax amount is unknown. Source gross/document totals are retained separately and compared, never used as balancing plugs. Quantity times supplied unit price is compared only when exactly integral; there is no rounding or VAT-rate engine. Unknown/nonintegral products, mismatches and unreviewed tax facts remain issuance blockers while the draft can be saved for review.

## Failure cases and acceptance recorded before code

- Wrong entity/book, revoked or agent-only authority must reject writes. All identity/tax/content evidence and counterpart revisions must belong to the same book.
- Same operation/actor/key/input must replay its exact immutable receipt. Changed content under that key must conflict. Duplicate draft keys under a new request key must not silently create a second draft.
- A stale expected revision or digest must reject atomically. Concurrent edits cannot overwrite each other. Old revisions, evidence snapshots and digests stay immutable. Reopening a saved or historical revision must show which revision is current.
- Customer/supplier roles must not be confused. Existing counterpart revisions are reused, pinned and required current when saving; this does not verify the separately asserted customer legal identity.
- Dates and currency/scale must be explicit and valid. Due before planned issue rejects when both exist. Missing identity fields, supply dates or terms remain named blockers, never automatic completion.
- Amounts above JavaScript safe integers must remain exact strings. No Number money or floating-point arithmetic. Negative amounts/credit notes, excess precision, duplicate line IDs, malformed decimals, discount above base and unsupported currencies/scales reject without writes.
- Preserve per-line discounts/charges and tax evidence. Missing tax is null, not zero. Zero asserted tax is not a legally activated zero-rate treatment. Rounding and source-total mismatches block issuance, never silently adjust amounts.
- Bounds: 200 drafts per book, 50 revisions per draft, 50 lines per revision, 64 KiB input and 128 KiB saved revision. List/history return their complete bounded summary sets with exact counts and a digest under a book read barrier; they never silently truncate. Detailed revisions are separate scoped reads.
- UI supports named identity/date/term fields, repeatable line editing, explicit create/revise, current/historical reopening, stable exact-request retry and JSON download. Saving reports only a retained draft. No issue/send/pay action or eligibility claim appears.
- Always expose issuance_not_implemented, legal_identity_not_verified and tax_profile_not_activated. These are implementation boundaries, not authority that a draft may activate.

## Verification boundary

The user has stopped all tests and validation runs. This packet adds no tests or fixtures and runs no validation commands, database, server or dependency actions. Source review is not runtime proof. Implementation and remaining issuance dependencies are recorded below at handoff.

## Implemented source

`1200-invoice-drafts.sql` adds `invoice_drafts` and `invoice_draft_revisions`. The head can only advance by one revision; the existing identity-freeze trigger rejects other head changes/deletion. Revisions are append-only, have a deferred current-head foreign key, retained-byte bounds and a canonical digest constraint. The complete calculation and scope checks run inside the existing book-serialized SQL authority. No parallel TypeScript money calculator was added.

The operator-only create/revise functions reauthorize before command replay. `draftKey` is unique in a book and is never an invoice number. Revisions bind expected revision plus exact digest, current selected counterpart revision, evidence hashes, explicit content, calculation basis and receipt. A source-total or unit-price comparison mismatch is retained as a blocker, not silently repaired. Null tax propagates to unknown total tax/gross. Credit-note/negative lines and currency conversion are not admitted. Retained asserted tax, including zero, never activates a rule profile.

`get_invoice_draft` reads current or a named historical revision and separately exposes the current head revision/digest. List and history take a book SHARE barrier and return their entire bounded summary set, count, capture time and digest in one response. There is no live cursor that could change the selected set mid-traversal. Missing joined heads/history rows cause explicit failure. The full-list bound is a limit of this slice, not a claim that the company's invoice inventory is complete.

The commerce-local `invoice-drafts.tsx` provides create, explicit seller/customer and counterpart fields, nullable dates/terms/tax/source facts, add/remove stable lines, reopen, historical summaries, current-revision editing with frozen baseline, exact-request retry through the owned command form, readable line calculations/blockers/evidence and JSON downloads. A historical view never becomes an editable historical mutation. Choosing to edit the current revision starts a new revision; old records remain unchanged. It reuses the request-scoped TanStack Query integration. No private source facts are saved in browser storage. Currency scale is the only numeric form conversion; all monetary inputs remain strings.

## Shared composition map

The root owns the following shared joins (some were wired during implementation):

- `packages/contracts/package.json`: export `./invoice-drafts` from `./src/invoice-drafts.ts`.
- `packages/contracts/src/api.ts`: add `InvoiceDraftsApi`.
- `packages/contracts/src/capabilities.ts`: spread `InvoiceDraftCapabilities` (reads only).
- `apps/api/src/index.ts`: add `InvoiceDraftHandlers`.
- `apps/api/src/database.ts`: import/spread `invoiceDraftStatements` from `invoice-draft-statements.ts` using the existing Drizzle Effect connection owner.
- `apps/api/src/capabilities.ts`: bind the three read capabilities below. Mutations are operator-only REST handlers that invoke the same fixed query owner directly; they are intentionally absent from ordinary MCP tools.

| Capability | Dispatcher | Parameters after token | Response |
| --- | --- | --- | --- |
| `commerce_get_invoice_draft` | `getInvoiceDraft` | `[scopeParameter(input.scope), input.id, input.revision ?? ""]` | `InvoiceDraftView` |
| `commerce_list_invoice_drafts` | `listInvoiceDrafts` | `[scopeParameter(input.scope)]` | `InvoiceDraftList` |
| `commerce_invoice_draft_history` | `invoiceDraftHistory` | `[scopeParameter(input.scope), input.id]` | `InvoiceDraftHistory` |

REST base: `/api/v1/entities/:entityId/books/:bookId/commerce/invoice-drafts`.

| Operation | Route | Parameters after token |
| --- | --- | --- |
| `createInvoiceDraft` | POST base | scope, idempotency key, JSON `{draftKey,content}` |
| `reviseInvoiceDraft` | POST `/:id/revisions` | scope, id, idempotency key, JSON `{expectedRevision,expectedDigest,reason,content}` |
| `getInvoiceDraft` | GET `/:id?revision=...` | scope, id, revision or empty string |
| `listInvoiceDrafts` | GET base | scope |
| `invoiceDraftHistory` | GET `/:id/revisions` | scope, id |

`InvoiceDrafts` is mounted within the owned commerce panel; local bilingual copy is in `invoice-draft-copy.ts`. No workspace/global message/UI primitive changes are required. No old migration is edited. Runtime receives only scoped public function execution and no table/helper write authority.

## Actual remaining issuance dependencies

This packet does not finish COM-01 or COM-02. Before issuing, implement a reviewed seller/customer legal-fact and applicable document-field contract, dated tax treatment/rounding/recognition profiles, draft sealing and exact issue approval, transactional legal numbering and immutable issue event, and required linked posting/open-item effects. Revalidate current profile, authority, evidence and counterparty facts at that issue boundary. Supplier invoices, source-occurrence linkage/duplicate-document diagnostics, credits, payment instructions and invoice delivery remain separate work.

Rendering/delivery must consume the immutable issued revision through a separately authorized durable intent/outcome workflow. It must not treat a draft save, source tax assertion, failed email or file export as issue, posting, delivery or payment. Actual company facts and legal rule review remain external gates; none were inferred in this implementation.

Status: implemented source and manual source review only. The worker ran no tests, TypeScript/lint/format/build validation, database, servers, dependency installs or external actions for this packet. The parent separately owns requested TypeScript checks and shared composition. SQL execution, arithmetic vectors, races, retry recovery, browser interaction/layout and downloads remain unverified.
