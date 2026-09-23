# Synthetic invoice review document artifacts

## Failure/security cases recorded before implementation

- Cross-book or missing issue/review IDs, mismatched immutable digests and unissued reviews must fail without capture.
- Generation must never read current party/draft heads, allocate another SYN number, post, register another invoice or deliver anything.
- Source issue/review/evidence/posting identities and digests must agree before capture and before sealing. Later metadata/profile/period changes must not rewrite or mislabel a historical artifact as current.
- Same-key replay and the unique issue/generator target must recover one retained capture. Interrupted capture/render/seal must remain discoverable and resumable. Concurrent seals must either return identical bytes or refuse replacement.
- HTML-sensitive text, tag fragments, quotes, ampersands, URL-looking strings, control characters and bidi controls must never become markup, active content, navigation or remote requests. No user content enters attributes or tags.
- Unsupported generator/format, oversized source/output, partial lines, invalid exact amounts or malformed UTF-8 must fail rather than truncate, round or silently replace bytes.
- Hash, canonical base64, byte length, scope, capture and source digests must be verified at seal and download. An unverified or mismatched artifact must not preview or download.
- The rendering profile has fixed English copy, UTF-8 and LF; it uses no clock, locale formatter, randomness, network, CSS/assets or URLs. All variable facts come from one immutable capture.
- The document must visibly say SYNTHETIC REVIEW DOCUMENT — NOT A LEGAL INVOICE — NOT DELIVERED, identify the internal SYN number as nonlegal, and distinguish evidenced synthetic zero asserted tax from a legal VAT conclusion.
- The UI must not inject retained HTML into the application DOM. Preview requires a sandboxed frame without script, navigation or same-origin privileges; download uses exact verified bytes.
- Rendering/sealing requires current scoped authorization. Sealed historical reads/downloads do not require current invoice approval or an open posting period and do not imply legal/external acceptance.

## Status

Owned source implementation is complete. Shared registration and mounting remain root-owned. All runtime behavior is unverified. No runtime validation, tests, checks, database calls, migration application, build, servers, browser verification, external action or delegation is authorized.

## Implemented source behavior

The fixed generator is `openerp-synthetic-invoice-html-v1`. The sole format is `synthetic-invoice-review-html`: self-contained semantic HTML, fixed English copy, UTF-8 and LF. There are no scripts, styles, links, forms, images, external assets, providers or remote requests. The application panel uses the existing UI primitives and bilingual copy; the artifact itself deliberately has one versioned language/template.

The visible header and footer both state:

> SYNTHETIC REVIEW DOCUMENT — NOT A LEGAL INVOICE — NOT DELIVERED

The document shows captured seller/customer facts, dates and terms, every commercial line, exact decimal totals, the internal nonlegal SYN number, immutable posting receipt/voucher/series/number/sequence, register invoice identity, evidence IDs/hashes, captured legal blockers and source/capture/issue/review/draft digests. It is not current outstanding balance, a credit note, payment instruction, legal invoice format or delivery proof. Zero asserted tax remains a synthetic evidenced input, not legal VAT treatment.

### Durable capture and recovery

1. `capture_invoice_document` authorizes the current scope, locks the book and replays the exact actor/key/operation/input before selection checks.
2. It selects the immutable1400 `invoice_issues.body` and linked `invoice_issue_reviews.body`, verifies their digests and linkage, retained issue evidence, immutable posting receipt and original register identity. It never reads current draft/counterparty heads, current residuals or current accounting configuration as document source.
3. One `(book, issue, generator)` capture can exist. Same-key retry returns it. A new key with the same exact input also returns it, even for another currently authorized book actor. No new document number or accounting effect is created.
4. An Effect application workflow renders only that capture using the pure owned renderer, hashes the bytes with platform SHA-256, and calls internal `seal_invoice_document`.
5. The seal reauthorizes, locks the book, verifies source identity, canonical bounded base64, byte length, SHA-256, valid UTF-8 and fixed outer document markers. An existing identical artifact returns unchanged; different replacement bytes fail with `IdempotencyConflict`.
6. Capture and seal are separate durable transitions. Interrupted generation remains discoverable by issued identity and resumable through the render route. Any currently authorized actor for the book may resume a deterministic historical document; there is no financial approval transfer or creator-only recovery deadlock.
7. A sealed view returns the original bytes without rerendering. There is no generation-day expiration, current-period requirement or freshness claim for current company/book facts.

Bounds: one fixed-generator capture per issue, at most50 source lines inherited from1400,512 KiB capture JSON,1 MiB exact artifact bytes,1398104 canonical base64 characters. Oversized work is rejected without truncation. Scoped per-issue history is complete and bounded to one capture under this migration's fixed profile. It is not a whole-book document inventory.

### HTML and exact-byte boundaries

- Every variable value enters escaped text nodes only. `&`, `<`, `>`, single and double quotes are escaped. No source value is interpolated into an attribute, tag name, CSS or URL.
- Malformed Unicode is refused. CRLF/CR in displayed source text normalize to LF. Unicode control/format characters other than tab/LF display as `[U+....]`, including bidi controls. Original source JSON and its digest remain unchanged.
- Monetary formatting inserts a decimal point into bounded exact strings using the captured scale. It does not use floating point, locale formatting, rounding or FX.
- The HTML has a fixed CSP meta policy `default-src 'none'; base-uri 'none'; form-action 'none'` and `no-referrer` policy. There is no dynamic CSS or executable markup.
- The UI verifies scope, capture/source/issue identities, generator, exact filename, canonical base64, byte length, SHA-256 and UTF-8 before preview or save. It previews only in an empty-sandbox iframe, with no scripts, same-origin permission or navigation grants. It never injects HTML into the application DOM.
- Download saves the exact verified `Uint8Array` in a Blob. It does not regenerate HTML client-side. The Blob URL exists only for the local download control and is revoked on cleanup; it is not a delivery URL or provider action.
- As with retained SIE rendering, the approved backend renderer is a trust boundary. Hash/length checks establish byte integrity, not independent proof that arbitrary HTML is safe. Public HTTP/MCP inputs never include byte content or a seal operation. Do not expose `sealInvoiceDocument` as a user-controlled document API.

## Files and ownership

- `apps/api/migrations/2100-invoice-document-artifacts.sql`
- `packages/contracts/src/invoice-documents.ts`
- `apps/api/src/application/invoice-document-renderer.ts` — pure renderer
- `apps/api/src/application/invoice-documents.ts` — capture/render/hash/seal Effect workflow
- `apps/api/src/db/statements/invoice-documents.ts`
- `apps/api/src/transport/http/routes/invoice-documents.ts`
- `apps/web/src/components/commerce/invoice-documents.tsx`
- `apps/web/src/components/commerce/invoice-document-copy.ts`
- This handoff.

No historical migrations, shared contract registration, shared API composition, shared database dispatch/schema, finance routes or existing invoice-issuance UI were edited. Migration2100 adds two private immutable tables: `invoice_document_captures` and `invoice_document_artifacts`; the runtime receives approved function execution, not table writes.

## Root integration

1. Contracts package export: `"./invoice-documents": "./src/invoice-documents.ts"`.
2. Add `InvoiceDocumentsApi` to shared `Api` and spread `InvoiceDocumentCapabilities` into the shared capability catalog.
3. Spread `invoiceDocumentStatements` from `./statements/invoice-documents` into `db/query.ts`.
4. Compose `InvoiceDocumentHandlers` from `./transport/http/routes/invoice-documents` into the HTTP API layer.
5. Bind capabilities to the Effect application functions, **not raw capture/seal SQL**:

| Capability | Application function from `./invoice-documents` |
| --- | --- |
| `commerce_prepare_invoice_document` | `prepareInvoiceDocument` |
| `commerce_get_invoice_document` | `getInvoiceDocument` |
| `commerce_resume_invoice_document` | `resumeInvoiceDocument` |
| `commerce_invoice_document_history` | `invoiceDocumentHistory` |

6. Add root-owned typed table mappings if required by the maintained schema convention. The capture fields and bytea artifact fields are defined in2100.
7. Exact existing UI insertion in `apps/web/src/components/commerce/invoice-issuance.tsx`:

```tsx
import { InvoiceDocumentPanel } from "./invoice-documents";
```

Inside `IssueContents`, in its `issue ? (...)` success branch, directly after the register identity text:

```tsx
<Text>{copy.register}: {issue.registerInvoiceId}</Text>
<InvoiceDocumentPanel book={book} locale={locale} issue={issue} />
```

This also works in the read-only historical issue review: document capture is a nonfinancial historical presentation operation, not issue approval/execution. Exported `InvoiceDocumentInspector({book, locale, id, issue?})` supports direct capture-ID recovery if a separate route is useful; the optional issue enforces an expected source match. `InvoiceDocumentPanel` remounts on entity/book/issue changes. No additional finance-route changes are needed for the alongside-review mount.

### Fixed SQL dispatch

Arguments below exclude the leading authenticated token. These are backend statements, not all public capabilities.

| Statement | SQL function | Parameters | Output |
| --- | --- | --- | --- |
| `captureInvoiceDocument` | `capture_invoice_document` | scope,key,JSON input | `InvoiceDocumentCapture` |
| `getInvoiceDocument` | `get_invoice_document` | scope,capture id | `InvoiceDocumentView` |
| `sealInvoiceDocument` | `seal_invoice_document` | scope,capture id,JSON internal seal | `InvoiceDocumentView` |
| `invoiceDocumentHistory` | `invoice_document_history` | scope,issue id | `InvoiceDocumentHistory` |

### REST

Prefix: `/api/v1/entities/:entityId/books/:bookId/commerce`.

| Method | Suffix | Input/output |
| --- | --- | --- |
| POST | `/invoice-documents` | `Idempotency-Key`; `PrepareInvoiceDocument` → `InvoiceDocumentView` |
| GET | `/invoice-documents/:id` | `InvoiceDocumentView` |
| POST | `/invoice-documents/:id/render` | No caller bytes; capture identity is the idempotency boundary → `InvoiceDocumentView` |
| GET | `/invoice-issues/:id/documents` | `InvoiceDocumentHistory` |

`PrepareInvoiceDocument` contains `{issueId, issueDigest, generatorVersion:"openerp-synthetic-invoice-html-v1"}`. These values identify an already committed1400 issue; the operation cannot issue or post it again.

## Verification and remaining gates

Only source reads/edits were performed. No tests, test edits, fixtures, checks, builds, dependency/toolchain changes, database execution, migrations applied, servers, browser/mobile work, external actions, commits or nested delegation were performed. No generated artifact has been executed or browser-verified in this wave. Source implementation, future runtime proof and real-company/legal acceptance remain separate. The root must integrate shared source; actual execution/security/accessibility proof is still open under the user's source-only gate.

## Root source integration

Shared contracts exports, API/capability catalogs, fixed statements and HTTP handlers are connected. All four public capabilities call the owning Effect application workflow; no caller-byte seal operation is exposed. Issued review success views mount InvoiceDocumentPanel, including historical read-only issue views. Root source review traced renderer text-only escaping, deterministic exact-string monetary formatting, source admission against1400, scoped capture/seal recovery and unchanged financial authority. Independent source security review is pending. No artifact was executed or browser/runtime-verified.
