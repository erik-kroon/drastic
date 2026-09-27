import * as Accounting from "@open-erp/contracts/accounting";
import type * as Credits from "@open-erp/contracts/customer-credit-notes";
import { render } from "takumi-pdf";
import {
  legalDocumentFonts,
  legalDocumentText as text,
  legalDocumentMoney as money,
} from "./legal-invoice-pdf-renderer-takumi-v2";

function party(value: typeof Credits.CustomerCreditParty.Type) {
  if (!value.address || !value.registrationId || value.countryCode !== "SE") {
    throw new Accounting.AccountingError({
      code: "UnsupportedProfile",
      message: "The retained credit party is incomplete for this document profile.",
    });
  }

  return `<strong>${text(value.legalName)}</strong><p>${text(value.address)}</p><p>Org.nr ${text(value.registrationId)}</p>${value.taxId ? `<p>Momsnr ${text(value.taxId)}</p>` : ""}`;
}

// Presentation only: every monetary value comes from the immutable issued document.
export async function renderCreditDocumentPdf(
  document: typeof Credits.CustomerCreditSemanticDocument.Type,
) {
  if (document.currency !== "SEK" || document.currencyScale !== 2 || !document.seller.taxId) {
    throw new Accounting.AccountingError({
      code: "UnsupportedProfile",
      message: "The credit PDF profile requires retained Swedish SEK facts.",
    });
  }

  const rows = document.lines
    .map(
      (line) =>
        `<tr><td>${text(line.description)}<p>Ursprunglig mängd: ${text(line.quantity)}</p></td><td>${money(line.creditedNetMinor)}</td><td>${money(line.creditedTaxMinor)}</td><td>${money(line.creditedGrossMinor)}</td></tr>`,
    )
    .join("");

  const html = `<main lang="sv-SE"><h1>Kreditnota ${text(document.documentNumber)}</h1>
    <p>Kreditdatum: ${text(document.creditDate)}</p>
    <p>Avser faktura ${text(document.originalDocumentNumber)} från ${text(document.originalIssuedOn)}</p>
    <section class="parties"><div><h2>Från</h2>${party(document.seller)}</div><div><h2>Till</h2>${party(document.customer)}</div></section>
    <h2>Orsak</h2><p>${text(document.reason)}</p>
    <table><thead><tr><th>Beskrivning</th><th>Krediterat exkl. moms</th><th>Moms 25 %</th><th>Krediterat inkl. moms</th></tr></thead><tbody>${rows}</tbody></table>
    <section class="totals"><p>Netto: ${money(document.totals.netMinor)}</p><p>Moms: ${money(document.totals.taxMinor)}</p><strong>Krediterat belopp: ${money(document.totals.grossMinor)}</strong></section>
    <p>Krediten minskar den obetalda fordran. Dokumentet är ingen betalningsuppmaning eller bekräftelse på återbetalning.</p></main>`;

  const bytes = await render(html, {
    size: "a4",
    margin: { top: 36, right: 32, bottom: 40, left: 32 },
    lang: "sv-SE",
    fonts: legalDocumentFonts,
    fontFamilies: ["OpenERP Plex"],
    stylesheets: [
      "body{font-family:'OpenERP Plex',monospace;font-size:10px;line-height:1.5;color:#151515}h1{font-size:20px}h2{font-size:11px}.parties{display:flex;gap:36px;margin-block:24px}.parties>div{width:50%;overflow-wrap:anywhere}p{margin:6px 0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:10px 5px;border-bottom:1px solid #ddd;text-align:right;vertical-align:top;overflow-wrap:anywhere}th:first-child,td:first-child{text-align:left;width:40%}tr{break-inside:avoid}.totals{margin-block:24px;text-align:right;break-inside:avoid}",
    ],
    metadata: {
      title: `Kreditnota ${document.documentNumber}`,
      creator: "OpenERP",
      creationDate: `${document.creditDate}T00:00:00`,
    },
    footer: `<div>${text(document.documentNumber)} · Sida <span class="pageNumber"></span> av <span class="totalPages"></span></div>`,
  });

  if (
    bytes.length < 8 ||
    bytes.length > 2097152 ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
  ) {
    throw new Accounting.AccountingError({
      code: "UnsupportedProfile",
      message: "The credit PDF exceeds the supported artifact profile.",
    });
  }

  return bytes;
}
