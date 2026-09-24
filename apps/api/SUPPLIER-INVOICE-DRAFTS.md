# Supplier-invoice commercial drafts

## Selected COM-01 extension — failure contract before implementation

This adds unaccepted supplier-document drafting, not financial acceptance or recognition.
Source inspection found1200 already owns exact line calculations and customer draft history,
but its calculator requires customer/both counterpart roles. Use a small shared private
calculator with an explicit customer/supplier role, preserving the old customer result and
error behavior. Keep supplier heads/revisions in separate tables and separate API resources.
Do not edit historical migrations, customer TypeScript/UI files, or external sales work.
Migration6900 is reserved after a fresh scan; only1200 defines invoice_draft_calculate now.

### Data and authority

- Current operator and native-writer checks, book lock, exact-key replay before fresh checks.
  Ordinary scoped readers can get/list/history. No mutation MCP, provider or storage fetch.
- Stable caller draftKey, generated internal ID, immutable revisions and revision/digest
  concurrency checks.200 supplier drafts/book,50 revisions/draft,50 lines/revision;
  64KiB input and128KiB revision bounds. Complete bounded list/history; never truncate.
- Supplier content reuses customer DraftContent field schemas with these changes:
  `seller`→`supplier`, `customer`→`buyer`, `plannedIssueDate`→`documentDate`;
  add required `sourceEvidenceId` and nullable `supplierDocumentNumber` (1–128 chars when set).
  All other fields remain: title, counterpartyId/revision, currency/scale, supplyDate,
  dueDate, paymentTerms, sourceTotalMinor and lines. Reuse DraftIdentity/DraftLine schemas.
- Pin the current supplier/both counterpart revision. Source, supplier, buyer and line tax
  evidence must belong to the book. These are asserted identities, not verified company facts.
- Original supplier number is a source assertion; never allocate SYN/legal invoice numbers.
  Missing number stays null with `supplier_document_number_missing` blocker.
- Reuse exact explicit-line calculations, nullable tax propagation, quantity/price comparisons,
  source differences and currency/scale constraints. No rounding, inferred tax, FX conversion,
  balancing plug, credit-note/negative-line support or company profile activation is added.
- New private `commercial_invoice_draft_calculate(book,content,role)` holds the1200 calculation
  with only role validation/selection generalized. Existing `invoice_draft_calculate(book,content)`
  delegates with literal customer. Customer calculations, blockers and errors must remain the
  same. Supplier adapter maps its fields to the established calculation shape, maps seller/
  customer evidence and identity-blocker names to supplier/buyer, changes the unsupported
  issuance blocker to `acceptance_not_implemented`, and adds `recognition_not_implemented`.
- Separate supplier tables prevent supplier draft IDs from entering customer issue or sales
  lists. No source-capacity reservation/release, ledger effect, register effect, VAT fact,
  approval, outbox, delivery or payment authority follows from retaining/revising a draft.
  Recognition of the original supplier document elsewhere is explicitly not assessed.

### Shapes and operations

New module `supplier-invoice-drafts.ts` in contracts, statements and HTTP routes. Export schemas
`SupplierDraftContent`, `CreateSupplierInvoiceDraft`, `ReviseSupplierInvoiceDraft`,
`SupplierInvoiceDraftRevision`, `SupplierInvoiceDraftView`, `SupplierInvoiceDraftSummary`,
`SupplierInvoiceDraftList`, `SupplierInvoiceDraftHistory`.

Revision mirrors1200 fields id/scope/draftKey/revision/status=draft/calculationBasis/content/
counterparty/totals/calculatedLines/blockers/reason/createdAt/receipt/digest; replaces evidence
keys with supplierEvidence/buyerEvidence and adds sourceEvidence. Do NOT copy issued/recognized/
delivered false claims: use acceptanceSupported=false, recognitionSupported=false,
recognitionAssessment=not_assessed. View/list/history envelope conventions match1200.
Summary uses supplierName instead of customerName and additionally retains supplierDocumentNumber,
counterpartyId and sourceEvidence. No original-body fetch in lists.

- SQL create_supplier_invoice_draft(token,scope,key,input).
- SQL revise_supplier_invoice_draft(token,scope,id,key,input).
- SQL get_supplier_invoice_draft(token,scope,id,revision), empty revision=current.
- SQL list_supplier_invoice_drafts(token,scope).
- SQL supplier_invoice_draft_history(token,scope,id).
- Statements/handlers camelCase: createSupplierInvoiceDraft, reviseSupplierInvoiceDraft,
  getSupplierInvoiceDraft, listSupplierInvoiceDrafts, supplierInvoiceDraftHistory.
- Group `supplierInvoiceDrafts`, exported `SupplierInvoiceDraftsApi` / `SupplierInvoiceDraftHandlers`.
  Base `/v1/entities/:entityId/books/:bookId/commerce/supplier-invoice-drafts`.
  POST base, POST /:id/revisions; GET base, GET /:id?revision, GET /:id/revisions.
- Export `supplierInvoiceDraftStatements`, `SupplierInvoiceDraftCapabilities`; only read MCP
  `commerce_get_supplier_invoice_draft` {scope,id,revision?},
  `commerce_list_supplier_invoice_drafts` {scope},
  `commerce_supplier_invoice_draft_history` {scope,id}.

Wrong role/scope/evidence, stale revision/digest, duplicate draftKey on a fresh key, invalid money/
dates, unsupported source amounts/currency and over-bound requests must refuse atomically.
Same successful key replays the original body. Historical revisions and customer behavior stay
unchanged. No tests, fixtures, SQL compilation/application, application/runtime/provider
execution, UI changes, commits or pushes. Static checks and source review are not execution proof.

## Implemented source — not database-applied

Migration `6900-supplier-invoice-drafts.sql` adds separate
`supplier_invoice_drafts` and `supplier_invoice_draft_revisions` tables. The head has a stable
book-scoped draft key and a deferred foreign key to its retained current revision. The
existing commerce identity trigger permits only the next revision; revision rows cannot be
updated or deleted. Revision identity/digest and the128KiB row bound are checked in the table.
There is no write to customer draft, issued-invoice or sales-register tables.

### Shared calculation and customer preservation

The private `commercial_invoice_draft_calculate(book,content,role)` is the1200 calculator
with only its explicit role validation and customer/supplier counterpart selection generalized.
The old `invoice_draft_calculate(book,content)` now delegates with literal `customer`.
A direct source comparison found no changes to the remaining calculation body, customer
error messages, output keys, blocker order, money/date validation, exact arithmetic or
nullable-tax behavior. Existing customer operations still call that original entry point.
No customer TypeScript or UI file was changed.

The supplier adapter validates the distinct complete supplier content object and its required
same-book source evidence. It maps supplier/buyer/documentDate to the established internal
seller/customer/plannedIssueDate calculation fields. It pins the current supplier/both
counterpart revision and reuses the same identity and line-tax evidence checks. The returned
evidence keys and missing-identity blockers use supplier/buyer names. Unsupported issuance
becomes `acceptance_not_implemented`; `recognition_not_implemented` is always present.
A null supplier document number adds `supplier_document_number_missing`. A supplied number
is retained as source text, never allocated or verified as a legal number.

### Retention and reads

The five public functions implement create, revise, get, complete list and complete history.
Create/revise require a current operator, serialize on the book, replay a successful exact
command before fresh checks and require the native writer for fresh writes. Create refuses
an existing draft key on a fresh command. Revise pins both current revision and digest before
appending. Commands retain the established200 drafts/book,50 revisions/draft,50 lines/revision,
64KiB input and128KiB retained-revision bounds. A failure saves no partial draft.

Each immutable revision contains the asserted supplier/buyer identities, source evidence
reference, counterpart snapshot, exact original content, calculations, blockers, reason,
receipt and digest. It uses `acceptanceSupported:false`, `recognitionSupported:false` and
`recognitionAssessment:"not_assessed"`. It does not claim that the original document has
never been recognized or delivered elsewhere.

Ordinary scoped readers use the book SHARE barrier. Get can return the current or a selected
retained revision, together with current revision/digest. List and history return complete
bounded summaries, with missing-head/history checks rather than truncation. Summaries retain
supplier name, supplier document number, counterpart ID and source evidence reference; they
do not fetch original source content. The view/list/history envelopes follow1200 conventions.

Runtime grants expose only those five functions. Tables and all calculation/summary helpers
remain private. No financial acceptance, numbering, source reservation/release, journal,
register, VAT fact, approval, payment, delivery or outbox authority was added. Source evidence
may already support another recognition path; this draft slice does not assess that fact.

### Verification limits

The selected failure contract was written before implementation. The6900 filename scan was
clear;1200 was the only prior calculator owner. Source deltas confirmed that the shared
calculation differs only at its name/signature and role branches. Source/whitespace review
was performed; no tests, fixtures, SQL compilation/application, runtime/provider execution,
UI work or VCS actions were performed. Contract/transport wiring and shared static checks
are owned separately. SQL execution and transaction behavior remain unverified.

## Shared integration and source review

All five REST handlers, statement owners, contract exports/API group and three read-only MCP
bindings are integrated. The public route base includes the application prefix:
`/api/v1/entities/:entityId/books/:bookId/commerce/supplier-invoice-drafts`.

Selecting the customer branches and removing the new private role parameter/guard reconstructs
the1200 calculator byte-for-byte. Customer due-date error copy stays unchanged; supplier errors
refer to the supplier document date. This is a source comparison, not SQL execution proof.
Backend/contracts/jurisdiction and web type checks passed; targeted lint found zero warnings or
errors on eight integration/contract/transport files. SQL remains uncompiled and unapplied.


## Duplicate review — selected failure contract before implementation

Forward7000 adds read-only duplicate diagnostics for the CURRENT supplier draft revision.
It compares other CURRENT supplier draft heads and registered supplier invoices, restricted to
this book and the exact captured counterpart ID. Reasons are exact non-null document-number
matches and exact primary/original evidence-content hash matches. Two null numbers never match.
Registered comparisons use the immutable registration evidence, not later metadata evidence.
No fuzzy names, merging, duplicate verdict, admission blocker, financial effect or completeness
claim is introduced. Do not replace3000 or alter its API/history.

- SQL `supplier_invoice_draft_duplicates(token,scope,id,after)`; statement/handler
  `supplierInvoiceDraftDuplicates`; GET supplier-draft base `/:id/duplicates`, optional `after`.
  Read-only MCP `commerce_supplier_invoice_draft_duplicates` input `{scope,id,after?}`.
- Authorize current book scope and hold book SHARE. Read the selected current supplier draft
  without recalculation; derive criteria from its frozen content and sourceEvidence snapshot.
  Exclude the selected draft itself. No original storage fetch or saved artifact.
- Response `{scope,source,coverage,consistency,items,next}`. `source` is
  SupplierInvoiceDraftSummary. coverage=`current_supplier_drafts_and_registered_supplier_invoices`;
  consistency=`live_candidates`. Items are tagged `{kind:"draft",draft:SupplierInvoiceDraftSummary,
  reasons}` or `{kind:"registered",invoice:Commerce.Invoice,reasons}`. Reasons reuse
  `same_document_number` / `same_original_evidence_content`, one or both, in that order.
- Up to50 matching candidates,51st-row lookahead; order drafts first, then registrations,
  each by retained ID COLLATE C. Materialize matched identities before building full details.
- Cursor `sid1:<64 lowercase hex context digest>:<d|r>:<id>:<revision>` maximum203 characters.
  Draft anchors carry their captured immutable revision1–50; registration anchors use0.
  Context digest normalizes `{entityId,bookId,draftId,draftDigest}` for selected current source.
  Reject wrong context (including edited source), malformed or nonexistent/mismatched anchors.
- Validate a draft anchor against its RETAINED captured revision and the same source criteria,
  not its now-current head. This preserves continuation if that candidate was later edited.
  A registration anchor must still meet the immutable original criteria. Exclude self anchors.
- Only omitted/internal empty after starts page1. Last returned matching tuple determines next;
  exact50 final matches have null next. No offset or arbitrary unbound ID cursor.
- Candidates remain live across pages: restart for new/edited candidates, and always restart
  if the source revision changes. A match is a reason to inspect, never proof of duplication.

Export schemas SupplierInvoiceDraftDuplicateCursor, SupplierInvoiceDraftDuplicateQuery and
SupplierInvoiceDraftDuplicates in the existing new supplier module. Existing groups/maps auto-
compose; root adds the read binding. No tests, SQL compilation/application, runtime/provider
execution, UI changes or VCS actions.

### Implemented7000 source — not database-applied

`7000-supplier-invoice-draft-duplicates.sql` adds only the scoped read function
`supplier_invoice_draft_duplicates`. It authorizes the current scope and holds the book SHARE
barrier before reading the selected current supplier draft revision. Criteria use that frozen
revision's counterpart ID, nullable supplier document number and captured source-evidence
hash. The source is not recalculated and original source content is not fetched.

Other draft candidates use only their current heads; the selected draft is excluded.
Registered candidates must be supplier invoices in the same book with the same counterpart.
Their content comparison joins `commerce_invoices.evidence_id` to the immutable original
evidence, never the current metadata revision's evidence. Exact document-number comparisons
use C collation and require a non-null source number. Reasons appear in the selected order:
`same_document_number`, then `same_original_evidence_content`.

The query materializes at most51 matching identity tuples, ordered by draft/registration tag
and retained ID in C order. It then materializes the first50 before calling full summary/body
helpers. A51st candidate produces a cursor from the last returned tuple; exactly50 final
candidates produce null. Registered invoice details retain the existing live body and blocker
semantics. No full source body is returned in draft summaries.

The bounded `sid1` cursor includes normalized entity/book/source-draft/current-digest context,
the candidate tag/ID and its captured revision. Draft revisions are1–50; registration anchors
use0. Malformed, foreign-context, edited-source, self-draft, nonexistent and nonmatching anchors
refuse. A draft anchor is checked against its immutable captured revision, not its latest
head, so editing a previously returned candidate does not invalidate continuation. The
candidate position uses tag/ID, not revision. Registered anchors are checked against their
immutable original matching criteria.

Results explicitly report `live_candidates` and the comparison population. They are reasons
to inspect records, not proof of duplication or complete coverage. New or edited candidates
can change membership between pages; restart to include them. A changed source requires a
restart. This does not add an admission blocker, retained artifact, receipt, original-object
read, source-capacity change or financial effect. The3000 function/API and6900 draft history
are unchanged.

Source review checked cursor/context/anchor branches, candidate criteria, reason ordering,
50/51 paging, helper call placement and permissions. Whitespace was clear. No tests, SQL
compilation/application, runtime/provider execution, UI changes or VCS actions were performed.
Contract/transport integration and shared static checks are owned separately; SQL behavior
remains unverified.
