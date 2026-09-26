# Customer invoice policy, PDF and delivery handoff (AR-1/AR-2)

## Current ownership

Application operations live in [application/invoice-pdf.ts](../src/application/invoice-pdf.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Forward7200 captures an immutable synthetic issue and review, renders a versioned portable PDF from the captured facts, and stores exact bytes with SHA256 and length in PostgreSQL. GET and history rediscover interrupted or completed rendering. Capture replay reuses the issue's unique capture; seal replay only accepts identical bytes. Old SYN issue numbers, receipts, HTML generators and saved HTML bytes are unchanged. The fixed English/WinAnsi Courier renderer paginates; it rejects unsupported characters and oversize artifacts, never silently replaces source facts. The PDF says **SYNTHETIC REVIEW DOCUMENT - NOT A LEGAL INVOICE - NOT DELIVERED**. An artifact download does not prove receipt.

Forward7201 stores up to 50 immutable, evidence-scoped candidate company invoice policies per book. The owner must assert a seller identity, numbering proposal, VAT treatment, rounding method, credit-note and correction policy, effective date and sources. A _different current operator_ may retain review findings tied to the exact candidate digest and review evidence. Both records are permanently **unactivated** and cannot issue a legal number, select a VAT rule, post a credit, or turn a synthetic receipt into a legal invoice. Revised assertions require a new candidate key. D-04/D-08, company facts and applicable primary-source review still govern activation; retained statements alone are not independent proof.

Forward7202 stores up to 50 immutable delivery intents per book. Each binds a sealed PDF capture, byte hash/length, explicit channel and destination. A different current operator approves only **review of the intent**, never sending. `email` and `peppol` are visible but `provider_blocked`; attempting them returns `UnsupportedProfile`. `local_simulation` can record a separately approved simulated-unknown attempt with no provider ID or external traffic. Its exact same-key replay returns the saved snapshot. A different-key attempt stays blocked while unknown. The starting operator may explicitly resolve **simulated_not_sent** with a reason; GET/history retain all attempts and outcomes. The same intent can simulate again only after that resolution, with a bounded attempt count. Simulation has no delivery effect. Neither export, planned destination nor simulation means the invoice was delivered.

Real-company legal issuance, credit/correction posting and email/Peppol dispatch remain unsupported. D-04/D-08 and provider/operator access must be resolved before an activated seller/numbering/VAT/rounding contract or sending authority is implemented. No real attempt, provider uncertainty, retry or receipt is fabricated. A future provider adapter must save an exact byte-hash-bound attempt identity _before_ crossing its side-effect boundary, retain timeout/unknown and reconcile the original provider request before retry. This synthetic dry-run state machine is not provider recovery proof.

### Root-owned shared wiring

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

### Forward7600 legal sales policy activation (generic tenant input)

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

### Forward7610/7620 legal PDF and outbound evidence

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

#### Full visual review of the illustrative Takumi document

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

#### Isolated v2 pagination probe (not activated)

The unchanged pinned `openerp-se-invoice-takumi-v1` still splits a line's
printed description/detail from its amount cells and can add a footer-only
page. On Takumi 0.11.3, 50 synthetic rows whose descriptions are
`Tjänst N — bokföringsunderlag bokföringsunderlag ` reproduce **five pages**:
page 2 has 21 descriptions but only 20 net/VAT notes, page 3 has 17
descriptions but 18 notes, page 4 contains only payable/terms, and page 5
only the repeated footer. The illustrative PDF and all five white-background
images are in `/tmp/open-erp-pdf-pagination/v1-50-two-words.pdf` and
`v1-50-two-words-page-{1..5}.png` (PDF SHA-256
`5b80a04614799f2df7b0111f69c015a01ce53039435aba42278e2baad980dfe1`).
These are local synthetic renderer artifacts, not a captured issue or an
authenticated Worker run. The existing immutable real-Worker v1 artifact
remains unchanged.

The isolated `src/application/legal-invoice-pdf-renderer-v2.ts` requires a
**different** renderer ID, `openerp-se-invoice-takumi-v2`. It replaces the
fragmented multi-page `<table>` rows with flex-aligned, `break-inside:avoid`
row blocks and keeps the total and terms in a single break-inside group. The
same 50-row fixture renders five pages: line/detail/amount counts per page
are 8/8, 14/14, 14/14, 14/14 and 0/0; page 5 has the complete total and
terms. A heavier 50-row fixture with 20 repeated description words per line
rendered 26 pages with all 50 rows and notes, one payable amount and **no
footer-only page**. A one-line sample rendered on one page. Its illustrative
PDFs/PNGs and PDFKit-extracted text are in the same temporary directory
(`v2-50-two-words.pdf`, `v2-50-two-words-page-{1..5}.png`,
`v2-50-twenty-words.pdf`, `v2-50-twenty-words-page-{1..26}.png`,
`v2-1.pdf`, `v2-1-page-1.png`). Visual inspection confirms the rows remain
whole and the total stays with terms. Column captions appear only on the
first page; continued pages keep the same column positions. Very tall single
rows, unusual characters, constrained Worker memory and actual issue capture
still need acceptance evidence.

Repeat the visual probe in a checkout with Bun, Takumi 0.11.3 and macOS
PDFKit: save this self-contained **synthetic**, renderer-only probe as
`apps/api/.pdf-pagination-probe.ts`, run `bun apps/api/.pdf-pagination-probe.ts v1 50 2`
then `bun apps/api/.pdf-pagination-probe.ts v2 50 2`, and delete the temporary
source afterward. Change the final `2` to `20` for the long stress sample or
`50` to `1` for the simple sample. The probe itself is **not** a test file or
an issued invoice:

```ts
import { writeFileSync } from "node:fs";
import { renderLegalInvoicePdf } from "./src/application/legal-invoice-pdf-renderer";
import { renderLegalInvoicePdfV2 } from "./src/application/legal-invoice-pdf-renderer-v2";
const [version = "v1", countText = "50", wordsText = "2"] = process.argv.slice(2);
const count = Number(countText),
  words = Number(wordsText);
const rendererVersion = `openerp-se-invoice-takumi-${version}`;
const lines = Array.from({ length: count }, (_, i) => ({
  id: `line_${i + 1}`,
  description: `Tjänst ${i + 1} — ${"bokföringsunderlag ".repeat(words)}`,
  quantity: "1",
  unitPriceMinor: "10000",
  baseMinor: "10000",
  discountMinor: "0",
  chargeMinor: "0",
  netMinor: "10000",
  taxMinor: "2500",
  grossMinor: "12500",
  vatTreatment: "se-domestic-standard-25-v1",
}));
const seller = {
  legalName: "Exempel AB",
  postalAddress: "Gatan 1\n123 45 Stockholm",
  countryCode: "SE",
  registrationNumber: "556677-8899",
  vatRegistrationNumber: "SE556677889901",
};
const totals = {
  netMinor: String(10000 * count),
  taxMinor: String(2500 * count),
  grossMinor: String(12500 * count),
};
const content = {
  seller: {
    legalName: seller.legalName,
    address: seller.postalAddress,
    taxId: seller.vatRegistrationNumber,
    registrationId: seller.registrationNumber,
  },
  customer: {
    legalName: "Kundbolaget AB",
    address: "Vägen 2\n123 45 Göteborg",
    countryCode: "SE",
    registrationId: "556000-1111",
  },
  title: "Konsultarbete",
  currency: "SEK",
  currencyScale: 2,
  dueDate: "2026-10-25",
  supplyDate: "2026-09-25",
  paymentTerms: "30 dagar netto",
  lines: lines.map((x) => ({
    id: x.id,
    taxMinor: x.taxMinor,
    sourceGrossMinor: x.grossMinor,
    unitPriceMinor: x.unitPriceMinor,
  })),
};
const policy = {
  id: "policy",
  digest: "policy-digest",
  input: { ruleVersion: "se-domestic-standard-25-2023-200-v1" },
  candidate: { input: { sellerIdentity: seller } },
};
const issue = {
  policyId: policy.id,
  policyDigest: policy.digest,
  policySnapshot: policy,
  draftSnapshot: { content, totals: { ...totals, sourceTotalMatches: true } },
  lines,
  totals,
  legalDocumentNumber: "AR-50",
  issuedOn: "2026-09-25",
};
const capture = { input: { rendererVersion }, source: { issue } };
const bytes = await (version === "v1"
  ? renderLegalInvoicePdf(capture as never)
  : renderLegalInvoicePdfV2(capture as never));
const name = `/tmp/${version}-${count}-${words}.pdf`;
writeFileSync(name, bytes);
console.log(name, bytes.length);
```

On macOS, save the following as `/tmp/pdf-pages.swift` and run
`swift /tmp/pdf-pages.swift /tmp/v1-50-2.pdf`, then again for
`/tmp/v2-50-2.pdf`. It prints every page's text and saves each page as a
white-background PNG beside its PDF:

```swift
import Foundation
import PDFKit
import AppKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let pdf = PDFDocument(url: url)!
print("pages=\(pdf.pageCount)")
for i in 0..<pdf.pageCount {
  let page = pdf.page(at: i)!
  print("---PAGE \(i + 1)---\n\(page.string ?? "")")
  let box = page.bounds(for: .mediaBox), scale: CGFloat = 1.5
  let image = NSBitmapImageRep(bitmapDataPlanes: nil,
    pixelsWide: Int(box.width * scale), pixelsHigh: Int(box.height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)
  NSColor.white.setFill()
  NSRect(x: 0, y: 0, width: box.width * scale, height: box.height * scale).fill()
  let graphics = NSGraphicsContext.current!.cgContext
  graphics.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: graphics)
  NSGraphicsContext.restoreGraphicsState()
  let png = url.deletingPathExtension().path + "-page-\(i + 1).png"
  try! image.representation(using: .png, properties: [:])!
    .write(to: URL(fileURLWithPath: png))
}
```

Compare every page and all 50 row/detail counts before accepting a new
renderer. The shared contract now accepts **explicit** v1/v2 values; application
dispatch uses the immutable capture version. Forward migration `8600` admits v2
without changing v1 captures and seals the descriptor with the captured version.
There is no automatic upgrade and existing sealed bytes are never re-rendered.

#### Live synthetic Worker PDF observation

A fresh disposable PostgreSQL 17 database with the source migrations and a reviewed
**synthetic** legal issue exercised the actual Worker `POST /legal-invoice-pdfs` route.
It first returned HTTP 500 before writing a capture: PostgreSQL could not parse the
unparenthesized JSONB subtraction in versioned `7610`. Forward migration `8210`
replaced that function without editing an applied migration. The same request then
returned a sealed, 9,997-byte PDF whose decoded bytes matched its stored SHA-256.
Same-key retry, GET, and render-resume returned identical records; the database
retained one issue, capture and artifact. The real-Worker PDF image was reviewed.
[Reproduction steps, exact hashes and PDF/PNG evidence](../../../docs/plans/evidence/wave2-legal-pdf-worker.md)
keep this synthetic proof distinct from actual-company acceptance. No provider send,
recipient delivery, deployed Worker limit or long-document pagination was proven.

#### Integrated v1/v2 Worker observation

A fresh disposable database applied the complete migration sequence through `8600`.
The Worker sealed v2 from a reviewed synthetic legal issue; identical retry, GET and
resume returned the same 10,047-byte PDF and descriptor. A different-key v1 request
for that issue failed rather than replacing its immutable capture. A second fresh
database sealed v1 after `8600`; its 9,997 PDF bytes matched the pre-v2 v1 artifact
byte for byte. The one-page real-Worker v2 PDF and the separate 50-line page images
were inspected. [Exact hashes, reproduction and PDF/PNG evidence](../../../docs/plans/evidence/wave2-legal-pdf-worker-v2.md)
cover this local synthetic claim only. Extra-tall rows, repeated table headings on
continuation pages, screen-reader tagging and deployed Worker limits remain open;
no provider call, real tenant or customer receipt was observed.

#### Local synthetic delivery-outbox observation

A disposable PostgreSQL 17 and actual Worker HTTP run exercised the PDF-linked
email/Peppol outbox after a synthetic sealed v2 invoice. All 35 bounded HTTP
checks matched their expected statuses. Independent send approval, durable
unknown request identity before any traffic, same-key replay, block while unknown,
mock confirmed-not-sent retry with a distinct request ID, terminal accepted/rejected
classification, Peppol payload refusal and cross-book access denial held. One PDF
capture/artifact and four intents/approvals/attempts plus three reconciliations
were retained. [Token-free reproduction, statuses and sealed bytes](../../../docs/plans/evidence/wave2-legal-delivery-e2e/README.md)
record this local synthetic observation. All `delivered` values remained false
and all `externalTrafficProven` values false. The accepted/rejected/not-sent
labels were explicitly mock operator classifications, **not** provider evidence;
no external request, customer receipt or actual-company authority was verified.
