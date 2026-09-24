import * as Accounting from "@open-erp/contracts/accounting";
import type * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import { render } from "takumi-pdf";
import {
  plexLatin400,
  plexLatin600,
  plexExtended400,
  plexExtended600,
} from "./fonts/plex-mono-embedded";

const unsupported = (message: string): never => {
  throw new Accounting.AccountingError({ code: "UnsupportedProfile", message });
};
const fontBytes = (source: string) =>
  Uint8Array.from(atob(source), (character) => character.charCodeAt(0));
const fonts = [
  {
    name: "Plex Latin 400",
    subsetOf: "OpenERP Plex",
    subsetRank: 0,
    weight: 400,
    data: fontBytes(plexLatin400),
  },
  {
    name: "Plex Latin 600",
    subsetOf: "OpenERP Plex",
    subsetRank: 0,
    weight: 600,
    data: fontBytes(plexLatin600),
  },
  {
    name: "Plex Extended 400",
    subsetOf: "OpenERP Plex",
    subsetRank: 1,
    weight: 400,
    data: fontBytes(plexExtended400),
  },
  {
    name: "Plex Extended 600",
    subsetOf: "OpenERP Plex",
    subsetRank: 1,
    weight: 600,
    data: fontBytes(plexExtended600),
  },
];
const css = `
* { box-sizing:border-box; }
html,body { margin:0; padding:0; }
body { color:#151515; font-family:'OpenERP Plex',monospace; font-size:10px; line-height:1.5; }
.meta { display:flex; justify-content:space-between; padding-top:102px; font-size:10px; }
.meta span { white-space:nowrap; }
.parties { display:flex; justify-content:space-between; gap:56px; margin-top:54px; }
.party { width:48%; overflow-wrap:anywhere; }
.party h2 { font-size:10px; font-weight:400; margin:0 0 14px; }
.party strong { display:block; font-weight:600; }
.party div { margin-top:2px; }
.table-title { font-size:10px; margin-top:57px; margin-bottom:13px; }
table { border-collapse:collapse; table-layout:fixed; width:100%; }
td { padding:7px 0 0; vertical-align:top; overflow-wrap:anywhere; }
.line-header, .line { display:flex; width:100%; }
.line-header { border-bottom:1px solid #333; }
.line-header > span { padding:6px 0 9px; }
.line { break-inside:avoid; padding-top:7px; }
.line > span { overflow-wrap:anywhere; }
.line-header .qty { text-align:center; }
.summary { break-inside:avoid; }
.num { font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; }
.desc { width:45%; }
.qty { width:10%; }
.price { width:22%; }
.net { width:13%; }
.vat { width:23%; }
.line-note { color:#666; font-size:8px; }
.totals { display:flex; justify-content:flex-end; margin-top:58px; }
.totals table { width:53%; }
.totals td { padding:7px 0; }
.totals .grand td { border-top:1px solid #333; padding-top:14px; }
.totals .grand .num { font-size:21px; font-weight:600; }
.payment { display:flex; justify-content:space-between; gap:56px; margin-top:75px; }
.payment section { width:48%; overflow-wrap:anywhere; }
.payment h2 { font-size:10px; font-weight:400; margin:0 0 13px; }
.footer { display:flex; justify-content:space-between; font-size:8px; color:#555; }
`;

function text(value: string) {
  if (
    !value.isWellFormed() ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code !== 9 &&
        code !== 10 &&
        code !== 13 &&
        !(code >= 32 && code <= 126) &&
        !(code >= 160 && code <= 591) &&
        !(code >= 8192 && code <= 8303) &&
        code !== 8364 &&
        code !== 8482
      );
    })
  ) {
    unsupported(
      "Legal invoice contains characters outside the bundled font coverage. No text was replaced.",
    );
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "<br>");
}
function money(minor: string) {
  if (!/^(0|[1-9][0-9]{0,37})$/.test(minor))
    unsupported("Legal invoice amount is not an exact minor-unit string.");
  const padded = minor.padStart(3, "0");
  const major = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${major},${padded.slice(-2)} kr`;
}
function required(value: string | null, field: string): string {
  if (value === null || value === "") return unsupported(`Legal invoice is missing ${field}.`);
  return value;
}

/** Only immutable issue and policy snapshots enter this versioned visual template. */
export async function renderLegalInvoicePdfV2(
  capture: Omit<typeof Pdf.LegalInvoicePdfCapture.Type, "input"> & {
    input: Omit<typeof Pdf.PrepareLegalInvoicePdf.Type, "rendererVersion"> & {
      rendererVersion: string;
    };
  },
) {
  const issue = capture.source.issue;
  const draft = issue.draftSnapshot;
  const policy = issue.policySnapshot;
  const content = draft.content;
  const seller = policy.candidate.input.sellerIdentity;
  if (
    capture.input.rendererVersion !== "openerp-se-invoice-takumi-v2" ||
    issue.policyId !== policy.id ||
    issue.policyDigest !== policy.digest ||
    policy.input.ruleVersion !== "se-domestic-standard-25-2023-200-v1" ||
    content.currency !== "SEK" ||
    content.currencyScale !== 2 ||
    content.seller.legalName !== seller.legalName ||
    content.seller.taxId !== seller.vatRegistrationNumber ||
    content.seller.registrationId !== seller.registrationNumber ||
    content.seller.address !== seller.postalAddress ||
    content.lines.length !== issue.lines.length ||
    draft.totals.taxMinor !== issue.totals.taxMinor ||
    draft.totals.netMinor !== issue.totals.netMinor ||
    draft.totals.grossMinor !== issue.totals.grossMinor ||
    !draft.totals.sourceTotalMatches
  ) {
    unsupported(
      "The legal PDF source does not match its approved seller, version or exact invoice amounts.",
    );
  }
  const rows = issue.lines
    .map((line, index) => {
      const asserted = content.lines[index];
      if (
        !asserted ||
        asserted.id !== line.id ||
        line.vatTreatment !== "se-domestic-standard-25-v1" ||
        asserted.taxMinor !== line.taxMinor ||
        asserted.sourceGrossMinor !== line.grossMinor ||
        asserted.unitPriceMinor !== line.unitPriceMinor
      ) {
        unsupported("A legal invoice line is not the exact approved issued line.");
      }
      return (
        `<section class="line"><span class="desc">${text(line.description)}<div class="line-note">Netto ${money(line.netMinor)} · moms 25 % ${money(line.taxMinor)}<br>` +
        `Rabatt ${money(line.discountMinor)} · tillägg ${money(line.chargeMinor)}</div></span>` +
        `<span class="qty num">${text(line.quantity)}</span><span class="price num">${money(line.unitPriceMinor)}</span>` +
        `<span class="vat num">${money(line.grossMinor)}</span></section>`
      );
    })
    .join("");
  const number = text(issue.legalDocumentNumber);
  const html =
    `<main lang="sv-SE"><section class="meta"><span>Fakturanr: ${number}</span>` +
    `<span>Fakturadatum: ${text(issue.issuedOn)}</span>` +
    `<span>Förfallodatum: ${text(required(content.dueDate, "due date"))}</span></section>` +
    `<section class="parties"><div class="party"><h2>Från</h2><strong>${text(seller.legalName)}</strong>` +
    `<div>${text(seller.postalAddress)}</div><div>${text(seller.countryCode)}</div><div>Org.nr: ${text(seller.registrationNumber)}</div>` +
    `<div>Momsnr: ${text(required(seller.vatRegistrationNumber, "seller VAT registration"))}</div></div>` +
    `<div class="party"><h2>Till</h2><strong>${text(content.customer.legalName)}</strong>` +
    `<div>${text(required(content.customer.address, "customer address"))}</div><div>${text(required(content.customer.countryCode, "customer country"))}</div>` +
    `<div>Org.nr: ${text(required(content.customer.registrationId, "customer registration"))}</div></div></section>` +
    `<div class="table-title">${text(content.title)} · Leveransdatum: ${text(required(content.supplyDate, "supply date"))}</div>` +
    `<div class="line-header"><span class="desc">Beskrivning</span><span class="qty">Ant.</span>` +
    `<span class="price num">À-pris exkl.</span><span class="vat num">Totalt inkl.</span></div>` +
    `<div>${rows}</div><section class="summary"><section class="totals"><table><tbody>` +
    `<tr><td>Netto</td><td class="num">${money(issue.totals.netMinor)}</td></tr>` +
    `<tr><td>Moms 25 %</td><td class="num">${money(issue.totals.taxMinor)}</td></tr>` +
    `<tr class="grand"><td>Att betala</td><td class="num">${money(issue.totals.grossMinor)}</td></tr>` +
    `</tbody></table></section><section class="payment"><section><h2>Betalningsvillkor</h2>` +
    `${text(required(content.paymentTerms, "payment terms"))}<div>Ange fakturanummer ${number} vid betalning.</div></section>` +
    `<section><h2>Information</h2><div>Fakturan avser en svensk försäljning med 25 % moms.</div>` +
    `<div>Valuta: SEK · Leveransdatum: ${text(required(content.supplyDate, "supply date"))}</div></section></section></section></main>`;
  const bytes = await render(html, {
    size: "a4",
    margin: { top: 40, right: 32, bottom: 45, left: 32 },
    lang: "sv-SE",
    fonts,
    fontFamilies: ["OpenERP Plex"],
    stylesheets: [css],
    footer:
      `<div class="footer"><span>${text(seller.legalName)} · ${number}</span>` +
      `<span>Sida <span class="pageNumber"></span> av <span class="totalPages"></span></span></div>`,
    metadata: {
      title: `Faktura ${issue.legalDocumentNumber}`,
      creator: "OpenERP",
      creationDate: `${issue.issuedOn}T00:00:00`,
    },
  });
  if (
    bytes.length < 8 ||
    bytes.length > 2097152 ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  ) {
    unsupported("Legal invoice PDF could not be rendered within the 2 MiB artifact limit.");
  }
  return bytes;
}
