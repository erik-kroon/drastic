import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Pdf from "@open-erp/contracts/legal-invoice-pdf";
import * as Commerce from "@open-erp/contracts/commerce";
import { legalFixture } from "./support/legal-commerce";
import { readPdf } from "./support/pdf";
import {
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

const rendererVersion = "openerp-se-invoice-pdfcn-v1";

function line(
  id: string,
  description: string,
  unitPriceMinor: string,
  taxMinor: string,
  sourceGrossMinor: string,
) {
  return {
    id,
    description,
    quantity: "1",
    unitPriceMinor,
    baseMinor: unitPriceMinor,
    discountMinor: "0",
    chargeMinor: "0",
    taxMinor,
    taxDescription: "se-domestic-standard-25-v1",
    sourceGrossMinor,
  };
}

test("pdfcn renders frozen invoice facts and exact amounts beyond Number precision through workerd", async () => {
  const context = await legalFixture([], {
    lines: [
      line(
        "large",
        'Räksmörgås & <faktura> "Åäö"\nRetained detail',
        "9007199254740996",
        "2251799813685249",
        "11258999068426245",
      ),
    ],
    sourceTotalMinor: "11258999068426245",
  });

  const { book, author, original, customer } = context;
  const before = await persisted(book);
  const input = { issueId: original.id, issueDigest: original.digest, rendererVersion };
  const commandKey = key();

  await post(
    author,
    `/commerce/counterparties/${customer.id}/revisions`,
    {
      expectedRevision: customer.revision,
      displayName: "Changed after invoice issue",
      evidenceId: customer.evidence.evidenceId,
      reason: "The PDF must render retained issue facts",
    },
    Commerce.CounterpartyRevision,
  );

  const view = await decoded(
    await request(book, "/commerce/legal-invoice-pdfs", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Pdf.LegalInvoicePdfView,
  );

  expect(view.artifact).not.toBeNull();

  if (!view.artifact) throw new Error("The public request did not seal the invoice PDF.");
  const bytes = Buffer.from(view.artifact.contentBase64, "base64");
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBe(view.artifact.byteLength);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(view.artifact.sha256);
  expect(view.artifact.rendererVersion).toBe(rendererVersion);
  expect(view.artifact.delivered).toBe(false);
  const pages = await readPdf(bytes, "pdfcn-invoice-exact");
  expect(pages).toHaveLength(1);
  const text = pages.map((page) => page.text).join(" ");
  expect(text).toContain('Räksmörgås & <faktura> "Åäö"');
  expect(text).toContain("Retained detail");
  expect(text).toContain("FWD-05 Synthetic Customer");
  expect(text).not.toContain("Changed after invoice issue");
  expect(text).toContain("90 071 992 547 409,96 kr");
  expect(text).toContain("22 517 998 136 852,49 kr");
  expect(text).toContain("112 589 990 684 262,45 kr");
  expect(text).toContain(original.legalDocumentNumber);
  expect(text).toContain("SE556677889901");
  expect(text).toContain("Sida 1 av 1");

  const replay = await decoded(
    await request(book, "/commerce/legal-invoice-pdfs", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Pdf.LegalInvoicePdfView,
  );

  expect(replay).toEqual(view);
  expect(
    await decoded(
      await request(book, `/commerce/legal-invoice-pdfs/${view.capture.id}/render`, {
        method: "POST",
      }),
      Pdf.LegalInvoicePdfView,
    ),
  ).toEqual(view);
  await failure(
    await request(book, "/commerce/legal-invoice-pdfs", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ ...input, issueDigest: original.policyDigest }),
    }),
    409,
    "IdempotencyConflict",
  );
  const outsider = await fixture();
  await failure(
    await request(outsider, `/commerce/legal-invoice-pdfs/${view.capture.id}`),
    404,
    "NotFound",
  );
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "pdfcn-invoice-exact.json"),
    JSON.stringify({ input, view, before, pages }, null, 2),
  );
}, 120000);

test("pdfcn keeps all fifty issued invoice rows and their amounts together across numbered pages", async () => {
  const lines = Array.from({ length: 50 }, (_, index) => {
    const marker = String(index + 1).padStart(2, "0");

    return line(
      `line_${marker}`,
      `Rad-${marker} Återkommande tjänst med sparad beskrivning som ska brytas över flera rader utan att förlora text slut-${marker}`,
      "10000",
      "2500",
      "12500",
    );
  });

  const { book, original } = await legalFixture([], { lines, sourceTotalMinor: "625000" });

  const view = await post(
    book,
    "/commerce/legal-invoice-pdfs",
    {
      issueId: original.id,
      issueDigest: original.digest,
      rendererVersion,
    },
    Pdf.LegalInvoicePdfView,
  );

  if (!view.artifact) throw new Error("The public request did not seal the paginated PDF.");
  const bytes = Buffer.from(view.artifact.contentBase64, "base64");
  const pages = await readPdf(bytes, "pdfcn-invoice-fifty-lines");
  expect(pages.length).toBeGreaterThan(1);

  for (const [index, invoiceLine] of lines.entries()) {
    const marker = String(index + 1).padStart(2, "0");
    const matches = pages.filter((page) => page.text.includes(`Rad-${marker}`));
    expect(matches, invoiceLine.id).toHaveLength(1);
    expect(matches[0]?.text).toContain(`slut-${marker}`);
  }

  for (const page of pages) {
    const rows = page.text.match(/Rad-\d{2}/gu) ?? [];
    expect(page.text.match(/125,00 kr/gu) ?? []).toHaveLength(rows.length);
    expect(page.text).toContain(`Sida ${page.number} av ${pages.length}`);
    expect(rows.length > 0 || page.text.includes("Att betala")).toBe(true);
    const detail = page.items.filter((item) => item.text.includes("tillägg 0,00 kr"));
    expect(detail).toHaveLength(rows.length);
    const lastRowBaseline = Math.min(...detail.map((item) => item.y));
    const contentRules = page.rules.filter((rule) => rule.y > 36);
    expect(contentRules.length).toBeGreaterThan(0);
    expect(
      contentRules.filter((rule) => rule.y < lastRowBaseline),
      `Page ${page.number} has a separator below its last row`,
    ).toHaveLength(0);
  }

  const summary = pages.filter((page) => page.text.includes("Att betala"));
  expect(summary).toHaveLength(1);
  expect(summary[0]?.text).toContain("5 000,00 kr");
  expect(summary[0]?.text).toContain("1 250,00 kr");
  expect(summary[0]?.text).toContain("6 250,00 kr");
  expect(summary[0]?.text).toContain("Synthetic only; no payment requested");
  await writeFile(
    join(environment().artifacts, "pdfcn-invoice-fifty-lines.json"),
    JSON.stringify({ view, pages }, null, 2),
  );
}, 120000);

test("unsupported glyphs refuse the pdfcn artifact while preserving the issued invoice", async () => {
  const { book, original } = await legalFixture([], {
    lines: [line("glyph", "Unsupported glyph 🧾", "10000", "2500", "12500")],
    sourceTotalMinor: "12500",
  });

  const before = await persisted(book);
  await failure(
    await request(book, "/commerce/legal-invoice-pdfs", {
      method: "POST",
      body: JSON.stringify({ issueId: original.id, issueDigest: original.digest, rendererVersion }),
    }),
    422,
    "UnsupportedProfile",
  );
  expect(await persisted(book)).toEqual(before);
}, 120000);
