# Customer invoice policy, PDF and delivery handoff (AR-1/AR-2)

Forward7200 captures an immutable synthetic issue and review, renders a versioned portable PDF from the captured facts, and stores exact bytes with SHA256 and length in PostgreSQL. GET and history rediscover interrupted or completed rendering. Capture replay reuses the issue's unique capture; seal replay only accepts identical bytes. Old SYN issue numbers, receipts, HTML generators and saved HTML bytes are unchanged. The fixed English/WinAnsi Courier renderer paginates; it rejects unsupported characters and oversize artifacts, never silently replaces source facts. The PDF says **SYNTHETIC REVIEW DOCUMENT - NOT A LEGAL INVOICE - NOT DELIVERED**. An artifact download does not prove receipt.

Forward7201 stores up to 50 immutable, evidence-scoped candidate company invoice policies per book. The owner must assert a seller identity, numbering proposal, VAT treatment, rounding method, credit-note and correction policy, effective date and sources. A _different current operator_ may retain review findings tied to the exact candidate digest and review evidence. Both records are permanently **unactivated** and cannot issue a legal number, select a VAT rule, post a credit, or turn a synthetic receipt into a legal invoice. Revised assertions require a new candidate key. D-04/D-08, company facts and applicable primary-source review still govern activation; retained statements alone are not independent proof.

Forward7202 stores up to 50 immutable delivery intents per book. Each binds a sealed PDF capture, byte hash/length, explicit channel and destination. A different current operator approves only **review of the intent**, never sending. `email` and `peppol` are visible but `provider_blocked`; attempting them returns `UnsupportedProfile`. `local_simulation` can record a separately approved simulated-unknown attempt with no provider ID or external traffic. Its exact same-key replay returns the saved snapshot. A different-key attempt stays blocked while unknown. The starting operator may explicitly resolve **simulated_not_sent** with a reason; GET/history retain all attempts and outcomes. The same intent can simulate again only after that resolution, with a bounded attempt count. Simulation has no delivery effect. Neither export, planned destination nor simulation means the invoice was delivered.

Real-company legal issuance, credit/correction posting and email/Peppol dispatch remain unsupported. D-04/D-08 and provider/operator access must be resolved before an activated seller/numbering/VAT/rounding contract or sending authority is implemented. No real attempt, provider uncertainty, retry or receipt is fabricated. A future provider adapter must save an exact byte-hash-bound attempt identity _before_ crossing its side-effect boundary, retain timeout/unknown and reconcile the original provider request before retry. This synthetic dry-run state machine is not provider recovery proof.

## Root-owned shared wiring

- Export `./invoice-pdf`, `./invoice-policy`, `./invoice-delivery` from `packages/contracts/package.json`.
- Add `InvoicePdfApi`, `InvoicePolicyApi`, `InvoiceDeliveryApi` to `packages/contracts/src/api.ts`. Spread their read-only `InvoicePdfCapabilities`, `InvoicePolicyCapabilities`, `InvoiceDeliveryCapabilities` in `packages/contracts/src/capabilities.ts`.
- Compose `InvoicePdfHandlers`, `InvoicePolicyHandlers`, `InvoiceDeliveryHandlers` in `apps/api/src/index.ts`. Register `invoicePdfStatements`, `invoicePolicyStatements`, `invoiceDeliveryStatements` in `apps/api/src/db/query.ts`.
- In `apps/api/src/application/capabilities.ts`, bind `commerce_get_invoice_pdf`, `commerce_invoice_pdf_history`, `commerce_get_invoice_policy_candidate`, `commerce_get_invoice_delivery`, `commerce_invoice_delivery_history` to corresponding statement names with `[scopeParameter(input.scope), input.id]`. Bind `commerce_invoice_policy_history` with `[scopeParameter(input.scope)]`. Mutations are human operator-only REST, absent from ordinary MCP.
- Apply forward7200,7201,7202 in order through the versioned migration runner in an isolated database before using these routes. No migration, browser, provider, runtime or financial verification is claimed.

REST under `/v1/entities/:entityId/books/:bookId/commerce`:

- PDFs: POST `/invoice-pdfs`, GET `/invoice-pdfs/:id`, POST `/invoice-pdfs/:id/render`, GET `/invoice-issues/:id/pdfs`.
- Policy: POST `/invoice-policies`, POST `/invoice-policies/:id/review`, GET `/invoice-policies/:id`, GET `/invoice-policies`.
- Delivery: POST `/invoice-deliveries`, POST `/invoice-deliveries/:id/approve`, POST `/invoice-deliveries/:id/simulate`, POST `/invoice-delivery-attempts/:id/resolve`, GET `/invoice-deliveries/:id`, GET `/invoice-pdfs/:id/deliveries`.

All mutations require an `Idempotency-Key`. The old HTML review document routes remain available.

## Forward7600 legal sales policy activation (generic tenant input)

A **new** activation record references the exact immutable candidate and independent review,
asserted legal seller, distinct uppercase legal series (never `SYN`), explicit tenant evidence,
and a third current operator's acceptance. It only admits a native SEK/two-decimal book,
Swedish seller identity and VAT registration assertion, sequential-per-series proposal,
domestic standard-rate 25% version, and half-up minor-unit line rounding proposal.
The candidate effective date cannot precede activation or exceed 2027-12-31 in this pinned
rule version. Changed terms require a new candidate/review and distinct legal series.
`legalInvoiceEnabled`, `creditEnabled` and `deliveryEnabled` stay **false**. Activation
is not statutory proof or issuance. No issue number is allocated and SYN history is not
reclassified. Activation is reachable through POST `/legal-sales-policies`; GET by ID and
GET collection return complete bounded snapshots. All operations use an authorized book.

Primary-source review: [Mervärdesskattelag (2023:200)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/mervardesskattelag-2023200_sfs-2023-200/)
was retrieved from the Riksdag on 2026-09-24 (HTTP 200, response SHA256
`2253cdec0ac7b73af3213e72e7b804fa256131bb82a2b5d24154ec462c0f88e4`).
9 kap. 2 § states the standard 25% rate subject to exceptions. 17 kap. 24 § requires
an issue date, unique sequential number from one or more series, VAT seller identity,
customer identity, supply facts, tax base/rate/amount and other applicable statements.
17 kap. 22–23 §§ cover linked corrections and customer credits. This page is a dated
research entry: full official response bytes are not archived in the repository, and
neither tax classification, rounding method, seller registration nor a specific
transaction is proven by this lookup. The review record and retained tenant evidence
are required, and any exceptions remain unsupported. The current posting kernel only
admits `taxAssessment=not_applicable` in `synthetic-core-v1`, and the commerce register
admits `synthetic_invoice_v1`; legal issue, legal PDF, credits and external delivery
cannot safely reuse those paths. D-04/D-08/D-10 and runtime verification remain open.

Root-owned integration for this addition: export `./legal-sales-policy` from
`packages/contracts/package.json`; compose `LegalSalesPolicyApi` in shared API and
read-only `LegalSalesPolicyCapabilities` in the capability catalog; register
`LegalSalesPolicyHandlers` in `apps/api/src/index.ts` and `legalSalesPolicyStatements`
in `apps/api/src/db/query.ts`; bind `commerce_get_legal_sales_policy` to
`getLegalSalesPolicy` with `[scopeParameter(input.scope),input.id]`, and
`commerce_legal_sales_policy_history` to `legalSalesPolicyHistory` with
`[scopeParameter(input.scope)]` in `apps/api/src/application/capabilities.ts`.
Run 7600 only after 7201. Source review and static checks are not authenticated
runtime or legal-acceptance proof.

## Forward7610/7620 legal PDF and outbound evidence

Forward7610 captures only an **immutable 8100 legal issue** with its reviewed seller policy,
complete approved draft, exact output-VAT lines, posted execution receipt and customer
register identity. A capture binds one issue and one renderer version. Unlike historical
SYN PDF bytes, `openerp-se-invoice-takumi-v1` uses Takumi 0.11.3 with locally bundled
IBM Plex Mono fonts (OFL license in `src/application/fonts/IBM-Plex-LICENSE.txt`).
It prints A4 Swedish invoice facts and exact approved minor-unit strings, never a
floating-point recalculation. Seller/customer addresses, date and number, item quantity,
unit price, net, discount/charge, rate, VAT amount, gross, terms and payment deadline
come from the issued snapshots. No tenant logo or bank account is invented. Font coverage,
missing facts or a >2 MiB artifact fail rather than silently omit data. A success stores
immutable PDF bytes, SHA256 and exact byte length. GET/history recover after interruption;
sealed SYN bytes remain unchanged. PDF retrieval does not imply transmission.

Forward7620 separates an immutable email/Peppol delivery request from a **different
current operator's send-handoff approval**. It binds sealed bytes, hash, channel,
recipient and explicit provider-profile key. An approved email operator may reserve
an attempt with a saved unique provider request ID. The state becomes
`provider_unknown` **before any possible external call**; this database function
neither sends email nor claims that network traffic occurred. The original request ID
must be reconciled before another attempt. Another current operator may retain
provider evidence and classify `provider_accepted`, `provider_rejected`, or
`confirmed_not_sent`; only `confirmed_not_sent` permits a fresh attempt. Provider
acceptance is not customer receipt. `delivered` remains false. Peppol request/review
is visible but attempt admission remains blocked until an exact Peppol BIS Billing XML
payload, participant scheme, access point and provider contract are supported. A PDF
is not Peppol BIS XML. An email provider adapter also requires D-10 credentials,
actual API semantics, idempotency and reconciliation proof before it may use this
handoff. No credentials or fabricated delivery outcome are stored or invoked here.

Root-owned integration: add `LegalInvoicePdfApi` and `LegalDeliveryApi` to shared API,
read-only capabilities to catalog, handlers to `apps/api/src/index.ts`, and statement
maps to `apps/api/src/db/query.ts`. Bind `commerce_get_legal_invoice_pdf` and
`commerce_get_legal_delivery` to `getLegalInvoicePdf`/`getLegalDelivery` with
`[scopeParameter(input.scope),input.id]`; bind PDF/delivery history similarly to
`legalInvoicePdfHistory`/`legalDeliveryHistory` in application capabilities. Mutations
stay human operator REST-only. Install `takumi-pdf@0.11.3` in `apps/api`; root owns
manifests and shared wiring. Apply 7610/7620 before 8100; 8100 adds the issue FK.

Static migration application was observed in an isolated PostgreSQL cluster through
8100 on 2026-09-24. A separate illustrative PDF sample was rendered with Takumi,
converted by `sips` and visually inspected against the supplied Midday image:
`/tmp/open-erp-ar-visual/render.ts`, `invoice.pdf`, `invoice-white.png`. This illustrative
visual preview alone is **not** an authenticated issue-to-delivery exercise or legal
content acceptance. A separate synthetic Worker PDF observation is recorded below;
no provider call, real tenant setup, browser route or recipient delivery has been verified. Original PDF layout uses the visual reference's monospace
invoice/date row, From/To columns, sparse table, right total and bottom terms, but
contains no copied brand graphic, fictitious payment details or reused Midday code.

### Full visual review of the illustrative Takumi document

Scope: A4 renderer sample in `/tmp/open-erp-ar-visual/`; plain PDF CSS, no browser
widgets. The attached reference is `/tmp/midday-invoice-pdf-reference.jpg`.

| Area        | Inspected evidence                                                           | Result                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typography  | Sample PNG at 595×842, IBM Plex Mono, tabular amount columns, Swedish labels | Readable; exact money strings remain right-aligned.                                                                                              |
| Surfaces    | Page margins, sparse rule under table header, total separator                | Kept monochrome without cards or shadows.                                                                                                        |
| Animations  | Static PDF                                                                   | Not applicable; no motion.                                                                                                                       |
| Icons       | No logo or payment QR in tenant input                                        | Omitted rather than inventing assets.                                                                                                            |
| Performance | Local subset fonts and sample PDF bytes                                      | 10 KiB single-page sample; 50-line visual stress rendered in five pages, including a trailing footer-only page. Worker limits remain unverified. |

| Severity    | Location                                              | Before                                                                                        | After                                                                                                                  | Why                                                                                            |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| HIGH        | `src/application/legal-invoice-pdf-renderer.ts` table | Six numeric columns collided in the 595px PDF.                                                | Four aligned columns; explicit net/tax/discount facts stay beneath each line.                                          | Prevents overlapping legal amounts.                                                            |
| MEDIUM      | Same renderer, layout                                 | Blue header and shaded terms diverged from reference.                                         | Sparse monochrome mono typography, restrained invoice/date row, seller/customer columns, right total and bottom terms. | Preserves clear reading order without copying branding.                                        |
| MEDIUM      | Same renderer, grand total                            | The sample clipped the trailing `kr` from the amount.                                         | Wider total block and a 21px amount; the 595×842 re-render shows the full currency.                                    | Keeps the legally relevant total legible.                                                      |
| LOW         | Same renderer, number cells                           | Uneven numeric alignment.                                                                     | Tabular numerals and right alignment.                                                                                  | Makes amount columns scannable.                                                                |
| HIGH — OPEN | Takumi 0.11.3 multi-page table                        | A 50-line stress sample splits a row's detail across pages and adds a footer-only final page. | Not resolved by `break-inside: avoid`, grouped `<tbody>`, removing the footer, or reducing section spacing.            | Long-document visual acceptance is blocked; do not infer it from the clean single-page sample. |

Rejected: fake tenant logo, bank account and QR code; these have no reviewed tenant
input. Rejected: float money formatting from the supplied sales-order template; the
issued source already owns exact minor-unit values. Visual inspection covers an
illustrative single page and a 50-line stress preview. The re-rendered single-page
sample is `/tmp/open-erp-ar-visual/invoice-review-white.png`; `render.ts` is the
repeatable local source. The 50-line output still has a footer-only page and splits
row detail across a page boundary. Screen-reader validation, provider handoff,
Worker limits and long-document visual acceptance remain open; the clean sample
is not release proof.

### Live synthetic Worker PDF observation

A fresh disposable PostgreSQL 17 database with the source migrations and a reviewed
**synthetic** legal issue exercised the actual Worker `POST /legal-invoice-pdfs` route.
It first returned HTTP 500 before writing a capture: PostgreSQL could not parse the
unparenthesized JSONB subtraction in versioned `7610`. Forward migration `8210`
replaced that function without editing an applied migration. The same request then
returned a sealed, 9,997-byte PDF whose decoded bytes matched its stored SHA-256.
Same-key retry, GET, and render-resume returned identical records; the database
retained one issue, capture and artifact. The real-Worker PDF image was reviewed.
[Reproduction steps, exact hashes and PDF/PNG evidence](../../docs/plans/evidence/wave2-legal-pdf-worker.md)
keep this synthetic proof distinct from actual-company acceptance. No provider send,
recipient delivery, deployed Worker limit or long-document pagination was proven.
