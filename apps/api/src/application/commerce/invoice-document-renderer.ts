import * as Accounting from "@open-erp/contracts/accounting";
import * as Documents from "@open-erp/contracts/invoice-documents";
import type * as Drafts from "@open-erp/contracts/invoice-drafts";
import { amount, text, renderInvoiceReviewDocument } from "./invoice-document-review-renderer";

/** Versioned, self-contained historical invoice. The original renderer remains byte-stable. */
export function renderInvoiceDocument(capture: typeof Documents.InvoiceDocumentCapture.Type) {
  const reviewBytes = renderInvoiceReviewDocument(capture);

  if (capture.generatorVersion === Documents.invoiceDocumentV1Generator) return reviewBytes;
  const { issue, review } = capture.source;
  const draft = review.draftSnapshot;
  const content = draft.content;

  const money = (value: string | null) => {
    const exact = amount(value, content.currencyScale);
    const [whole = "", fraction] = exact.split(".");

    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction === undefined ? "" : `.${fraction}`}`;
  };

  const lines = content.lines
    .map((line, index) => {
      const calculated = draft.calculatedLines[index];

      if (!calculated)
        throw new Accounting.AccountingError({
          code: "UnsupportedProfile",
          message: "The complete captured invoice calculation is required.",
        });

      const adjustments = [
        line.discountMinor !== "0" ? `Discount ${money(line.discountMinor)}` : "",
        line.chargeMinor !== "0" ? `Charge ${money(line.chargeMinor)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `<tr><td><strong>${text(line.description)}</strong>${line.taxDescription ? `<small>${text(line.taxDescription)}</small>` : ""}${adjustments ? `<small>${adjustments}</small>` : ""}</td><td class="number">${text(line.quantity)}</td><td class="number">${money(line.unitPriceMinor)}</td><td class="number">${money(calculated.netMinor)}</td></tr>`;
    })
    .join("\n");

  const retained = new TextDecoder().decode(reviewBytes);
  const audit = retained.slice(retained.indexOf("<main>") + 6, retained.indexOf("</main>"));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Invoice ${text(issue.internalDocumentNumber)} · ${text(content.seller.legalName)}</title>
<style>${invoiceStyles}</style>
</head>
<body>
<main class="paper">
<div class="demo"><strong>Demo invoice</strong><span>For review only · Not a legal invoice · Not sent</span></div>
<header class="heading"><div><p class="eyebrow">${text(content.seller.legalName)}</p><h1>Invoice</h1><p class="description">${text(content.title)}</p></div><div class="invoice-number"><p class="eyebrow">Invoice reference</p><strong>${text(issue.internalDocumentNumber)}</strong><p>Internal demo reference</p></div></header>
<div class="parties">${party("From", content.seller)}${party("Bill to", content.customer)}<section><h2>Details</h2><dl class="dates"><dt>Invoice date</dt><dd>${text(content.plannedIssueDate)}</dd><dt>Due date</dt><dd>${text(content.dueDate)}</dd>${content.supplyDate ? `<dt>Supply date</dt><dd>${text(content.supplyDate)}</dd>` : ""}<dt>Currency</dt><dd>${text(content.currency)}</dd></dl></section></div>
<table class="items"><thead><tr><th>Description</th><th class="number">Qty</th><th class="number">Unit price</th><th class="number">Amount (${text(content.currency)})</th></tr></thead><tbody>${lines}</tbody></table>
<div class="settlement"><section class="terms"><h2>Terms</h2><p>${text(content.paymentTerms)}</p><p class="muted">Demo only. No payment is requested.</p></section><dl class="totals"><dt>Subtotal</dt><dd>${money(draft.totals.netMinor)}</dd><dt>Tax</dt><dd>${money(draft.totals.taxMinor)}</dd><dt class="total">Total</dt><dd class="total">${money(draft.totals.grossMinor)} <span>${text(content.currency)}</span></dd></dl></div>
<footer><p>This copy preserves the invoice details at issue. Later payments, cancellations and company changes are recorded separately.</p><p class="boundary">SYNTHETIC REVIEW DOCUMENT — NOT A LEGAL INVOICE — NOT DELIVERED</p></footer>
</main>
<details class="audit"><summary>Accounting record and source details</summary><div>${audit}</div></details>
</body>
</html>
`;

  const bytes = new TextEncoder().encode(html);

  if (bytes.length > Documents.invoiceDocumentMaxBytes)
    throw new Accounting.AccountingError({
      code: "UnsupportedProfile",
      message: "The complete invoice document exceeds 1 MiB. No truncated artifact is supported.",
    });

  return bytes;
}

function party(label: string, identity: typeof Drafts.DraftIdentity.Type) {
  return `<section><h2>${label}</h2><p><strong>${text(identity.legalName)}</strong></p>${identity.address ? `<p class="address">${text(identity.address)}</p>` : ""}${identity.countryCode ? `<p>${text(identity.countryCode)}</p>` : ""}${identity.registrationId ? `<p class="muted">Registration ${text(identity.registrationId)}</p>` : ""}${identity.taxId ? `<p class="muted">Tax ID ${text(identity.taxId)}</p>` : ""}</section>`;
}

// Fixed document CSS is embedded in the artifact; no fonts, images or scripts are fetched.
const invoiceStyles = `
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f3f3f1;color:#202326;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper{max-width:880px;margin:0 auto;padding:42px 48px;background:#fff;border:1px solid #e2e3df;min-height:1000px}.demo{display:flex;justify-content:space-between;gap:16px;font-size:11px;border-bottom:1px solid #dedfdc;padding-bottom:14px;margin-bottom:42px;color:#5c6061}.demo strong{text-transform:uppercase;letter-spacing:.1em;font-size:10px}.heading{display:flex;justify-content:space-between;gap:32px;margin-bottom:52px}.eyebrow{font-size:12px;margin:0 0 12px;color:#626668}h1{font:48px/1.1 Georgia,serif;margin:0 0 16px;letter-spacing:-1px}.description{margin:0;max-width:430px;color:#626668;white-space:pre-wrap}.invoice-number{text-align:right;min-width:140px}.invoice-number>strong{font-size:22px;font-weight:500;letter-spacing:-.5px}.invoice-number>p:last-child{font-size:11px;color:#777b7d;margin-top:8px}.parties{display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-bottom:44px}h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:500;color:#666b6d;margin:0 0 14px}p{margin:0 0 4px}.address{white-space:pre-wrap}.muted{color:#717678;font-size:12px}.parties strong{font-weight:550}.dates{display:grid;grid-template-columns:auto auto;gap:6px 12px;margin:0;font-size:12px}.dates dt{color:#717678}.dates dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}.items{width:100%;border-collapse:collapse;table-layout:auto}.items th{text-align:left;padding:12px 10px 12px 0;border-block:1px solid #dfe1de;font-size:11px;font-weight:500;color:#666b6d}.items td{padding:20px 10px 20px 0;vertical-align:top;border-bottom:1px solid #eceeeb}.items td:first-child{width:52%;overflow-wrap:anywhere}.items strong{font-weight:500}.items small{display:block;font-size:11px;color:#777b7d;margin-top:5px;white-space:pre-wrap}.number{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap}.items th:last-child,.items td:last-child{padding-right:0}.settlement{display:grid;grid-template-columns:1fr 300px;gap:48px;margin-top:28px}.terms{padding-top:6px;white-space:pre-wrap}.terms>p{font-size:12px;margin-bottom:8px}.totals{margin:0;display:grid;grid-template-columns:1fr auto;gap:13px 24px;font-variant-numeric:tabular-nums}.totals dt{color:#717678}.totals dd{margin:0;text-align:right}.totals .total{border-top:1px solid #dfe1de;padding-top:18px;margin-top:5px;font-size:22px;color:#202326;font-weight:500}.totals .total span{font-size:12px;font-weight:400;color:#717678}footer{margin-top:92px;padding-top:20px;border-top:1px solid #e2e3df;color:#777b7d;font-size:10px;line-height:1.7}.boundary{font-size:9px;margin-top:10px;letter-spacing:.035em}.audit{max-width:880px;margin:16px auto;font-size:12px;color:#626668}.audit summary{cursor:pointer;padding:12px}.audit>div{padding:24px;background:white;border:1px solid #e2e3df;overflow:auto}.audit h2{margin-top:28px}.audit table{border-collapse:collapse;font-size:10px}.audit td,.audit th{border:1px solid #ddd;padding:6px}.audit pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 monospace}
@media print{body{padding:0;background:white}.paper{border:0;max-width:none;min-height:0;padding:8mm}.audit{display:none}.items tr,.parties,.settlement{break-inside:avoid}thead{display:table-header-group}footer{margin-top:30px}@page{size:A4;margin:12mm}}
`;
