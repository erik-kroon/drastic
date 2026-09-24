import * as Accounting from "@open-erp/contracts/accounting";
import * as Pdf from "@open-erp/contracts/invoice-pdf";
import { amount } from "./invoice-document-review-renderer";

// WinAnsi is intentionally bounded: do not silently replace names or financial facts.
const extra = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);
function invalid(): never {
  throw new Accounting.AccountingError({
    code: "UnsupportedProfile",
    message:
      "PDF text contains characters outside the fixed WinAnsi font. No fact was omitted or replaced.",
  });
}
function hex(value: string) {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || code < 32 || (code >= 127 && code < 160)) invalid();
    const byte = code <= 255 ? code : extra.get(code);
    if (byte === undefined) invalid();
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}
function append(label: string, value: string | null, output: string[]) {
  const normalized = (value ?? "Not supplied").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  for (const [index, line] of normalized.split("\n").entries()) {
    const content = `${index === 0 ? label + ": " : "  "}${line}`;
    // Fixed-width 9pt Courier; wrapping changes layout only, never source text.
    const characters = Array.from(content);
    for (let offset = 0; offset < characters.length; offset += 92)
      output.push(characters.slice(offset, offset + 92).join(""));
    if (!content.length) output.push("");
  }
}

/** Versioned portable, paginated synthetic record. It is not a legal delivery document. */
export function renderInvoicePdf(capture: typeof Pdf.InvoicePdfCapture.Type) {
  const { issue, review } = capture.source;
  const draft = review.draftSnapshot;
  const { content } = draft;
  const money = (value: string | null) => amount(value, content.currencyScale);
  const lines: string[] = ["SYNTHETIC REVIEW DOCUMENT - NOT A LEGAL INVOICE - NOT DELIVERED", ""];
  append("Reference (internal SYN)", issue.internalDocumentNumber, lines);
  append("Seller (asserted)", content.seller.legalName, lines);
  append("Seller registration (asserted)", content.seller.registrationId, lines);
  append("Seller tax ID (asserted)", content.seller.taxId, lines);
  append("Seller address (asserted)", content.seller.address, lines);
  append("Seller country (asserted)", content.seller.countryCode, lines);
  append("Customer (asserted)", content.customer.legalName, lines);
  append("Customer registration (asserted)", content.customer.registrationId, lines);
  append("Customer tax ID (asserted)", content.customer.taxId, lines);
  append("Customer address (asserted)", content.customer.address, lines);
  append("Customer country (asserted)", content.customer.countryCode, lines);
  append("Issue date (draft)", content.plannedIssueDate, lines);
  append("Supply date (draft)", content.supplyDate, lines);
  append("Due date (draft)", content.dueDate, lines);
  append("Payment terms (draft)", content.paymentTerms, lines);
  append("Title", content.title, lines);
  append(
    "Asserted source total",
    content.sourceTotalMinor === null
      ? null
      : `${money(content.sourceTotalMinor)} ${content.currency}`,
    lines,
  );
  for (const [index, line] of content.lines.entries()) {
    const calculated = draft.calculatedLines[index];
    if (!calculated) invalid();
    lines.push("", `Line ${index + 1}`);
    append("Description", line.description, lines);
    append("Quantity", line.quantity, lines);
    append(
      "Unit price",
      line.unitPriceMinor === null ? null : `${money(line.unitPriceMinor)} ${content.currency}`,
      lines,
    );
    append("Base", `${money(line.baseMinor)} ${content.currency}`, lines);
    append("Discount", `${money(line.discountMinor)} ${content.currency}`, lines);
    append("Charge", `${money(line.chargeMinor)} ${content.currency}`, lines);
    append("Net", `${money(calculated.netMinor)} ${content.currency}`, lines);
    append("Asserted tax", `${money(line.taxMinor)} ${content.currency}`, lines);
    append("Gross", `${money(calculated.grossMinor)} ${content.currency}`, lines);
    append(
      "Asserted source gross",
      line.sourceGrossMinor === null ? null : `${money(line.sourceGrossMinor)} ${content.currency}`,
      lines,
    );
    append("Tax description (asserted)", line.taxDescription, lines);
  }
  lines.push("");
  append("Net total", `${money(draft.totals.netMinor)} ${content.currency}`, lines);
  append("Asserted tax total", `${money(draft.totals.taxMinor)} ${content.currency}`, lines);
  append("Gross total", `${money(draft.totals.grossMinor)} ${content.currency}`, lines);
  append("Issued receipt", issue.id, lines);
  append("Issued digest", issue.digest, lines);
  append("Draft digest", draft.digest, lines);
  append("Review digest", review.digest, lines);
  lines.push("", "SYNTHETIC REVIEW DOCUMENT - NOT A LEGAL INVOICE - NOT DELIVERED");
  const pages: string[][] = [];
  for (let offset = 0; offset < lines.length; offset += 65)
    pages.push(lines.slice(offset, offset + 65));
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const pageTree = add("");
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  );
  const pageIds: number[] = [];
  for (const page of pages) {
    const stream =
      page
        .map((line, index) => `BT /F1 9 Tf 45 ${790 - index * 11} Td <${hex(line)}> Tj ET`)
        .join("\n") + "\n";
    const streamId = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${streamId} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${offsets.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(output);
  if (bytes.length > 1048576)
    throw new Accounting.AccountingError({
      code: "UnsupportedProfile",
      message: "PDF exceeds 1 MiB. The complete source cannot be rendered within this profile.",
    });
  return bytes;
}
