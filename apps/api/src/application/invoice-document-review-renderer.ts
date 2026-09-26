import * as Accounting from "@open-erp/contracts/accounting";
import * as Documents from "@open-erp/contracts/invoice-documents";
import type * as Drafts from "@open-erp/contracts/invoice-drafts";

const boundary = "SYNTHETIC REVIEW DOCUMENT — NOT A LEGAL INVOICE — NOT DELIVERED";

function unsupported(message: string): never {
  throw new Accounting.AccountingError({ code: "UnsupportedProfile", message });
}

// Source values only enter text nodes. Controls are displayed, never interpreted.
export function text(value: string | null) {
  if (value === null) return "Not supplied";

  if (!value.isWellFormed()) unsupported("The captured document text contains malformed Unicode.");

  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      character === "\n" || character === "\t"
        ? character
        : `[U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}]`,
    )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fact(label: string, value: string | null) {
  return `<dt>${label}</dt><dd><pre>${text(value)}</pre></dd>`;
}

function identity(label: string, value: typeof Drafts.DraftIdentity.Type) {
  return `<section><h2>${label} (captured, not independently verified)</h2><dl>${[
    fact("Name", value.legalName),
    fact("Registration ID", value.registrationId),
    fact("Tax ID", value.taxId),
    fact("Address", value.address),
    fact("Country code", value.countryCode),
  ].join("")}</dl></section>`;
}

export function amount(value: string | null, scale: number) {
  if (value === null || !/^(?:0|-?[1-9][0-9]{0,40})$/.test(value))
    return unsupported(
      "The issued source requires exact bounded amounts for every rendered amount.",
    );
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(scale + 1, "0");

  return `${negative ? "-" : ""}${scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`}`;
}

/** Pure fixed English/UTF-8/LF rendering. No current-state reads, clock, locale or assets. */
export function renderInvoiceReviewDocument(capture: typeof Documents.InvoiceDocumentCapture.Type) {
  if (
    (capture.generatorVersion !== Documents.invoiceDocumentV1Generator &&
      capture.generatorVersion !== Documents.invoiceDocumentGenerator) ||
    capture.language !== "en" ||
    capture.format !== "synthetic-invoice-review-html"
  )
    unsupported("Unsupported invoice document rendering profile.");
  const { review, issue } = capture.source;
  const draft = review.draftSnapshot;
  const content = draft.content;
  const scale = content.currencyScale;

  if (
    scale < 0 ||
    scale > 6 ||
    !Number.isInteger(scale) ||
    content.lines.length < 1 ||
    content.lines.length > 50 ||
    draft.calculatedLines.length !== content.lines.length ||
    issue.id !== capture.input.issueId ||
    issue.digest !== capture.input.issueDigest ||
    issue.reviewId !== review.id ||
    issue.reviewDigest !== review.digest ||
    issue.draftId !== draft.id ||
    issue.draftRevision !== draft.revision ||
    issue.draftDigest !== draft.digest ||
    issue.postingReceipt.changeSetId !== review.postingPlan.id ||
    issue.postingReceipt.planDigest !== review.postingPlan.planDigest ||
    draft.totals.taxMinor !== "0" ||
    content.plannedIssueDate === null ||
    content.dueDate === null
  )
    unsupported("The complete immutable synthetic issued source is required for rendering.");

  const rows = content.lines
    .map((line, index) => {
      const calculated = draft.calculatedLines[index];

      if (!calculated || calculated.id !== line.id || line.taxMinor !== "0")
        return unsupported("Every captured line must have its matching synthetic calculation.");

      return `<tr><th scope="row">${text(line.id)}</th><td>${text(line.description)}</td><td>${text(line.quantity)}</td>${[
        line.unitPriceMinor,
        line.baseMinor,
        line.discountMinor,
        line.chargeMinor,
        calculated.netMinor,
        line.taxMinor,
        calculated.grossMinor,
      ]
        .map((value) => `<td>${amount(value, scale)}</td>`)
        .join("")}<td>${text(line.taxDescription)}</td></tr>`;
    })
    .join("\n");

  const totals = [
    ["Base", draft.totals.baseMinor],
    ["Discounts", draft.totals.discountMinor],
    ["Charges", draft.totals.chargeMinor],
    ["Net", draft.totals.netMinor],
    ["Asserted tax", draft.totals.taxMinor],
    ["Total", draft.totals.grossMinor],
    ["Declared source total", content.sourceTotalMinor],
  ]
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${text(label ?? null)}</th><td>${amount(value ?? null, scale)}</td></tr>`,
    )
    .join("\n");

  const evidence = [
    ["Issue source", review.evidence.id, review.evidence.sha256],
    ["Seller identity", draft.sellerEvidence.evidenceId, draft.sellerEvidence.sha256],
    ["Customer identity", draft.customerEvidence.evidenceId, draft.customerEvidence.sha256],
    [
      "Counterparty revision",
      draft.counterparty.evidence.evidenceId,
      draft.counterparty.evidence.sha256,
    ],
    ...draft.calculatedLines.flatMap((line) =>
      line.taxEvidence
        ? [[`Asserted tax: ${line.id}`, line.taxEvidence.evidenceId, line.taxEvidence.sha256]]
        : [],
    ),
  ]
    .map((row) => `<tr>${row.map((value) => `<td>${text(value)}</td>`).join("")}</tr>`)
    .join("\n");

  const journal = review.postingPlan.groups
    .flatMap((group) =>
      group.actions.flatMap((action) =>
        action.lines.map(
          (line) =>
            `<tr><td>${text(line.lineId)}</td><td>${text(line.accountId)}</td><td>${amount(line.debitMinor, scale)}</td><td>${amount(line.creditMinor, scale)}</td><td>${text(line.description)}</td></tr>`,
        ),
      ),
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Synthetic invoice review document</title>
</head>
<body>
<header><h1>${boundary}</h1><p>This retained historical review artifact is not a legal invoice, a payment instruction or proof of delivery. No legal format, VAT treatment or external acceptance is established.</p></header>
<main>
<h2>Internal synthetic document ${text(issue.internalDocumentNumber)}</h2>
<p>The SYN number is internal only. It is not a legal invoice number. The source draft's historical draft status does not replace the committed synthetic issue receipt shown here.</p>
<dl>${[
    fact("Title", content.title),
    fact("Captured issue date", content.plannedIssueDate),
    fact("Captured supply date", content.supplyDate),
    fact("Captured due date", content.dueDate),
    fact("Captured payment terms (not an instruction)", content.paymentTerms),
    fact("Currency", content.currency),
    fact("Currency scale", String(scale)),
    fact("Issued at", issue.createdAt),
    fact("Draft identity / revision", `${draft.id} / ${draft.revision}`),
  ].join("")}</dl>
${identity("Seller", content.seller)}
${identity("Customer", content.customer)}
<section><h2>Captured commercial lines</h2><p>Amounts use exact decimal notation at the captured currency scale. No exchange conversion or rounding is applied. Asserted zero tax is an evidenced synthetic input, not a VAT exemption or legal tax conclusion.</p>
<table><caption>All captured invoice lines</caption><thead><tr><th scope="col">Line</th><th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Base</th><th scope="col">Discount</th><th scope="col">Charge</th><th scope="col">Net</th><th scope="col">Asserted tax</th><th scope="col">Gross</th><th scope="col">Captured tax description</th></tr></thead><tbody>
${rows}
</tbody></table></section>
<section><h2>Captured totals (${text(content.currency)})</h2><table><caption>Immutable issue totals, not current outstanding balances</caption><thead><tr><th scope="col">Amount</th><th scope="col">Value</th></tr></thead><tbody>
${totals}
</tbody></table></section>
<section><h2>Committed synthetic posting and register identities</h2><p>This document does not post again. It does not describe later allocations, corrections, current balances or current company details.</p><dl>${[
    fact("Issue ID", issue.id),
    fact("Review ID", review.id),
    fact("Register invoice ID", issue.registerInvoiceId),
    fact("Posting receipt ID", issue.postingReceipt.id),
    fact("Voucher ID", issue.postingReceipt.voucherId),
    fact("Series", review.input.series),
    fact("Voucher number", issue.postingReceipt.voucherNumber),
    fact("Ledger sequence at posting", issue.postingReceipt.sequence),
    fact("Posted at", issue.postingReceipt.committedAt),
  ].join(
    "",
  )}</dl><table><caption>Captured approved journal lines</caption><thead><tr><th scope="col">Line</th><th scope="col">Account ID</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Description</th></tr></thead><tbody>
${journal}
</tbody></table></section>
<section><h2>Retained evidence references</h2><p>Evidence content is not embedded or fetched. References are plain text, not links.</p><table><caption>Captured evidence identities and SHA-256 hashes</caption><thead><tr><th scope="col">Use</th><th scope="col">Evidence ID</th><th scope="col">SHA-256</th></tr></thead><tbody>
${evidence}
</tbody></table></section>
<section><h2>Unresolved legal boundaries</h2><ul>${issue.legalBlockers.map((blocker) => `<li>${text(blocker)}</li>`).join("")}</ul></section>
<section><h2>Artifact provenance</h2><dl>${[
    fact("Entity / book", `${capture.scope.entityId} / ${capture.scope.bookId}`),
    fact("Capture ID", capture.id),
    fact("Capture digest", capture.digest),
    fact("Source digest", capture.sourceDigest),
    fact("Issue digest", issue.digest),
    fact("Review digest", review.digest),
    fact("Draft digest", draft.digest),
    fact("Generator", capture.generatorVersion),
    fact("Capture created at", capture.createdAt),
    fact("Format", "Self-contained HTML; fixed English; UTF-8; LF line endings"),
  ].join("")}</dl></section>
</main>
<footer><h2>${boundary}</h2><p>Historical only. Downloading or printing this artifact does not issue another number, post, deliver, activate VAT treatment or establish legal compliance.</p></footer>
</body>
</html>
`;

  const bytes = new TextEncoder().encode(html);

  if (bytes.length > Documents.invoiceDocumentMaxBytes)
    unsupported(
      "The complete synthetic document exceeds1 MiB. No truncated artifact is supported.",
    );

  return bytes;
}
