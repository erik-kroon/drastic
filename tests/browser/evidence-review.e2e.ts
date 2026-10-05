import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Schema from "effect/Schema";
import { signInSyntheticOperator } from "./synthetic-session";

function twoPageOriginal() {
  const pages = ["Independent original page one", "Independent original page two"];
  const streams = pages.map((text) => `BT /F1 14 Tf 30 250 Td (${text}) Tj ET`);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...streams.map(
      (stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ),
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const start = Buffer.byteLength(body);
  body += `xref\n0 8\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;

  return Buffer.from(body);
}

test("the retained original keeps page and zoom while supplier decisions change", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("The disposable browser launcher must supply the output directory");

  const filename = `evidence-pages-${randomUUID()}.pdf`;
  const bytes = twoPageOriginal();
  await mkdir(output, { recursive: true });
  const file = join(output, filename);
  await writeFile(file, bytes);
  await app.open(`${workspace}/purchases?view=supplier-drafts`);
  await expect(screen.getByRole("button", "Ladda upp original")).toBeVisible({ timeout: 90_000 });
  await agent.act(
    "Open the upload form with Ladda upp original. Stop when Dokument and Spara original are visible.",
  );
  await expect(screen.getByLabel("Dokument", { exact: true })).toBeVisible();
  await screen.getByLabel("Dokument", { exact: true }).setInputFiles(file);
  const retainedResponse = browser.waitForResponse("**/source-occurrences");
  await screen.getByRole("button", "Spara original", { exact: true }).click();
  const retained = await retainedResponse;

  expect(retained.status).toBe(200);

  const occurrence = Schema.decodeUnknownSync(
    Schema.Struct({ id: Schema.String, sha256: Schema.String }),
  )(await retained.json());

  const expectedHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  expect(occurrence.sha256).toBe(expectedHash);
  await expect(screen.getByRole("combobox", "Sida", { exact: true })).toContainText("1 av 2");
  await agent.act("Open Granska och fyll i faktura for the retained original.");
  const review = screen.getByRole("dialog", "Ny leverantörsfaktura");

  await expect(review.getByLabel("Leverantörens fakturanummer")).toBeVisible();
  await review.getByRole("combobox", "Sida", { exact: true }).click();
  await screen.getByRole("option", "2 av 2", { exact: true }).click();
  await review.getByRole("combobox", "Zoom", { exact: true }).click();
  await screen.getByRole("option", "125 %", { exact: true }).click();
  await expect(review.getByRole("img", `${filename}, sida 2`)).toBeVisible();
  await review.getByText("Sidtext", { exact: true }).click();
  await expect(review.getByText("Independent original page two", { exact: true })).toBeVisible();
  await review.getByLabel("Leverantörens fakturanummer").fill("P03-REVIEW-002");
  await review.getByLabel("Total enligt fakturan, SEK").fill("1250,00");
  await expect(review.getByRole("combobox", "Sida", { exact: true })).toContainText("2 av 2");
  await expect(review.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");
  await expect(review.getByLabel("Leverantörens fakturanummer")).toHaveValue("P03-REVIEW-002");
  await expect(review.getByText("Independent original page two", { exact: true })).toBeVisible();
  await app.screenshot("p03-page-two-unsaved-decision");
  await review.getByRole("combobox", "Sida", { exact: true }).click();
  await screen.getByRole("option", "1 av 2", { exact: true }).click();
  await expect(review.getByText("Independent original page one", { exact: true })).toBeVisible();
  await expect(review.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");
  await expect(review.getByLabel("Leverantörens fakturanummer")).toHaveValue("P03-REVIEW-002");
  await app.screenshot("p03-page-one-return");
  await writeFile(
    join(output, "p03-original-edit-retention.json"),
    JSON.stringify(
      {
        synthetic: true,
        occurrenceId: occurrence.id,
        expectedHash,
        filename,
        page: 1,
        zoom: 125,
        unsavedInvoiceNumber: "P03-REVIEW-002",
        browserUrl: await browser.url(),
      },
      null,
      2,
    ),
  );
});

test("a corrupt original stays unavailable when its rendering is retried", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("The disposable browser launcher must supply the output directory");

  const filename = `evidence-corrupt-${randomUUID()}.pdf`;
  const file = join(output, filename);
  await writeFile(file, "%PDF-1.4\nSynthetic corrupt original without a page tree\n%%EOF");
  await app.open(`${workspace}/purchases?view=supplier-drafts`);
  await expect(screen.getByRole("button", "Ladda upp original")).toBeVisible({ timeout: 90_000 });
  await screen.getByRole("button", "Ladda upp original").click();
  await screen.getByLabel("Dokument", { exact: true }).setInputFiles(file);
  await screen.getByRole("button", "Spara original", { exact: true }).click();
  await expect(screen.getByText("Sidan kunde inte visas.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("img", new RegExp(filename))).toHaveCount(0);
  await agent.act("Retry the original page using Försök visa sidan igen.");
  await expect(screen.getByText("Sidan kunde inte visas.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("img", new RegExp(filename))).toHaveCount(0);
  await expect(screen.getByText("Independent original page two", { exact: true })).toHaveCount(0);
  await app.screenshot("p03-corrupt-original-retry");
  await writeFile(
    join(output, "p03-corrupt-original.json"),
    JSON.stringify(
      { synthetic: true, filename, retry: "same retained bytes", rendered: false },
      null,
      2,
    ),
  );
});
