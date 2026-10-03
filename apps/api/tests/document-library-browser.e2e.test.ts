import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Source from "@open-erp/contracts/source-intake";
import { supplierFixture, createDraft, acceptDraft } from "./support/supplier-review";
import { database, decoded, environment, failure, post, request, key } from "./support/fixtures";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Tax from "@open-erp/contracts/expense-tax";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import { withWorkspaceBrowser } from "./support/workspace-browser";

test("P05 Documents searches owner metadata, preserves cursor and opens exact owner revisions", async () => {
  const { book, content, supplier } = await supplierFixture();
  const acquisitions = [];

  for (let index = 0; index < 13; index += 1) {
    const occurrence = await post(
      book,
      "/source-occurrences",
      {
        sourceSystem: "library_browser",
        sourceAccountId: "supplier",
        occurrenceKey: key(),
        sourceRevision: "1",
        filename: `business-${index}.csv`,
        mediaType: "text/csv",
        contentBase64: Buffer.from(`retained supplier document ${index}\n`).toString("base64"),
      },
      Source.SourceOccurrence,
    );

    const source = await post(
      book,
      "/evidence",
      {
        title: "Retained supplier original",
        origin: "Synthetic browser library",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "supplier_invoice_source_v1",
          source: { occurrenceId: occurrence.id, sha256: occurrence.sha256 },
        }),
      },
      Accounting.Evidence,
    );

    const draft = await createDraft(book, {
      ...content,
      title: `Document owner ${index}`,
      sourceEvidenceId: source.id,
    });

    acquisitions.push({ occurrence, draft });
  }

  const archive = await decoded(
    await request(book, "/source-archive?sourceSystem=library_browser"),
    Source.ArchiveSearch,
  );

  const tail = await decoded(
    await request(
      book,
      `/source-archive?sourceSystem=library_browser&cursor=${archive.nextCursor}`,
    ),
    Source.ArchiveSearch,
  );

  const selected = acquisitions.find((item) => item.occurrence.id === tail.items[0]?.id)!;
  const acceptance = await acceptDraft(book, selected.draft);
  const historical = acquisitions.find((item) => item.occurrence.id !== selected.occurrence.id)!;
  await post(
    book,
    `/commerce/supplier-invoice-drafts/${historical.draft.id}/revisions`,
    {
      expectedRevision: historical.draft.revision,
      expectedDigest: historical.draft.digest,
      reason: "Retain a second owner revision",
      content: { ...historical.draft.content, title: "Revised owner title" },
    },
    Drafts.SupplierInvoiceDraftRevision,
  );

  const expenseOriginal = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "library_browser",
      sourceAccountId: "expense",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "expense-history.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from("synthetic expense original\n").toString("base64"),
    },
    Source.SourceOccurrence,
  );

  const expenseReference = await post(
    book,
    "/evidence",
    {
      title: "Retained expense original",
      origin: "Synthetic browser library",
      mediaType: "application/json",
      content: JSON.stringify({
        kind: "expense_entry_v1",
        source: { occurrenceId: expenseOriginal.id, sha256: expenseOriginal.sha256 },
      }),
    },
    Accounting.Evidence,
  );

  const expense = await post(
    book,
    "/expense-tax/sources",
    {
      sourceKey: key(),
      expectedSourceDigest: null,
      facts: {
        evidenceId: expenseReference.id,
        sourceLocator: "original",
        description: "Earlier expense description",
        recordClass: "synthetic",
        amounts: { grossMinor: "1000", netMinor: null, vatMinor: null },
        currency: "SEK",
        currencyScale: 2,
        supplierJurisdiction: null,
        supplyJurisdiction: null,
        issuedOn: null,
        receivedOn: null,
        suppliedOn: null,
        taxPointOn: null,
        changeSetId: null,
        voucherId: null,
      },
    },
    Tax.TaxSourceRevision,
  );

  const expenseReview = await post(
    book,
    `/expense-tax/sources/${expense.sourceId}/reviews`,
    {
      sourceDigest: expense.digest,
      expectedReviewDigest: null,
      facts: {
        evidenceId: expenseReference.id,
        rationale: "Retained earlier expense review",
        amounts: { grossMinor: "1500", netMinor: null, vatMinor: null },
        registration: "unknown",
        registrationEvidenceId: null,
        method: "unknown",
        methodEvidenceId: null,
        bookJurisdiction: "SE",
        suppliedOn: null,
        taxPointOn: null,
        dateBasis: null,
        dateEvidenceId: null,
        treatment: "unknown",
        profileId: null,
        profileVersion: null,
        rateNumerator: null,
        rateDenominator: null,
        deductionNumerator: null,
        deductionDenominator: null,
        deductionBasis: null,
        deductionEvidenceId: null,
        roundingPolicy: "unknown",
      },
    },
    Tax.TaxReview,
  );

  await post(
    book,
    "/expense-tax/sources",
    {
      sourceKey: expense.sourceKey,
      expectedSourceDigest: expense.digest,
      facts: {
        ...expense.facts,
        description: "Current expense description",
        amounts: { grossMinor: "2000", netMinor: null, vatMinor: null },
      },
    },
    Tax.TaxSourceRevision,
  );
  await withWorkspaceBrowser(book, "document-library", async (page, workspace) => {
    const pageErrors: string[] = [];
    const failedResponses: { path: string; status: number }[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(`${workspace}/purchases?view=documents`);
    await page
      .getByLabel("Filename or supplier", { exact: true })
      .fill("Architecture review supplier");
    await page.getByLabel("Exact gross amount", { exact: true }).fill("100.00");
    await page.getByLabel("Currency", { exact: true }).fill("SEK");
    await page.getByLabel("Currency decimals", { exact: true }).fill("2");
    await page.getByLabel("Exact gross amount", { exact: true }).fill("100.001");
    await page.getByRole("button", { name: "Search archive", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Check the dates, references and exact amount" })
      .waitFor();
    expect(new URL(page.url()).searchParams.has("amountMinor")).toBe(false);
    await page.getByLabel("Exact gross amount", { exact: true }).fill("100.00");
    const submitted = performance.now();
    await page.getByRole("button", { name: "Search archive", exact: true }).click();
    await page.getByRole("link", { name: archive.items[0]!.filename, exact: true }).waitFor();
    const displayMs = performance.now() - submitted;
    expect(new URL(page.url()).searchParams.get("amountMinor")).toBe(JSON.stringify("10000"));
    expect(new URL(page.url()).searchParams.get("q")).toBe("Architecture review supplier");
    expect(await page.getByText(/^Entered draft ·/).count()).toBeGreaterThan(0);
    await page.screenshot({
      path: join(environment().artifacts, "P05-lane-02.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Next documents", exact: true }).click();
    await page.getByRole("link", { name: selected.occurrence.filename, exact: true }).waitFor();
    const cursor = new URL(page.url()).searchParams.get("cursor");
    expect(cursor).toMatch(/^arc1:/);
    await page.reload();
    expect(await page.getByLabel("Exact gross amount", { exact: true }).inputValue()).toBe(
      "100.00",
    );
    expect(new URL(page.url()).searchParams.get("cursor")).toBe(cursor);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export this page and originals", exact: true }).click();
    const download = await downloadEvent;

    const exported = Schema.decodeSync(Schema.fromJsonString(Source.ArchiveExport))(
      await readFile((await download.path())!, "utf8"),
    );

    expect(exported.items.map((item) => item.occurrence.id)).toEqual(
      tail.items.map((item) => item.id),
    );
    await page.getByRole("link", { name: selected.occurrence.filename, exact: true }).click();
    await page.getByRole("heading", { name: selected.occurrence.filename, exact: true }).waitFor();

    const voucherLink = page.getByRole("link", {
      name: `Voucher ${acceptance.postingReceipt.voucherId}`,
      exact: true,
    });

    const voucherHref = await voucherLink.getAttribute("href");

    try {
      await voucherLink.click();
      await page.waitForURL((url) => url.pathname.endsWith("/books"));
      await page.getByRole("dialog").waitFor();
    } finally {
      await writeFile(
        join(environment().artifacts, "document-voucher-navigation.json"),
        JSON.stringify(
          {
            voucherHref,
            destination: page.url(),
            pageErrors,
            links: await page.getByRole("link").allTextContents(),
            buttons: await page
              .getByRole("dialog")
              .getByRole("button")
              .evaluateAll((nodes) =>
                nodes.map((node) => ({
                  label: node.getAttribute("aria-label"),
                  text: node.textContent,
                })),
              ),
            backToWorkHidden: await page
              .getByRole("link", { name: "Back to work", exact: true, includeHidden: true })
              .evaluateAll((nodes) =>
                nodes.map((node) => node.closest('[aria-hidden="true"], [inert]') !== null),
              ),
            body: await page.locator("body").innerText(),
          },
          null,
          2,
        ),
      );
    }

    try {
      const returnToDocuments = page.getByRole("button", {
        name: "Back to documents",
        exact: true,
      });

      expect(await returnToDocuments.count()).toBe(1);
      await returnToDocuments.click();
    } finally {
      await writeFile(
        join(environment().artifacts, "document-voucher-return.json"),
        JSON.stringify(
          {
            voucherHref,
            destination: page.url(),
            pageErrors,
            failedResponses,
            links: await page.getByRole("link").allTextContents(),
            body: await page.locator("body").innerText(),
          },
          null,
          2,
        ),
      );
    }

    await page.getByRole("heading", { name: selected.occurrence.filename, exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("cursor")).toBe(cursor);
    await page.screenshot({
      path: join(environment().artifacts, "P05-lane-07.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "All documents", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe(selected.occurrence.filename);
    await page.getByLabel("Document from", { exact: true }).fill("2026-09-23");
    await page.getByRole("button", { name: "Search archive", exact: true }).click();
    await page.getByRole("heading", { name: "No matching documents", exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("cursor")).toBeNull();
    await page.screenshot({
      path: join(environment().artifacts, "P05-lane-03.png"),
      fullPage: true,
    });
    await page.goto(`${workspace}/purchases?view=documents&record=${historical.occurrence.id}`);
    await page.getByRole("link", { name: `Supplier draft version 1`, exact: true }).click();
    await page.getByText("Earlier version 1", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("draftRevision")).toBe(JSON.stringify("1"));
    await page.reload();
    await page.getByText("Earlier version 1", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Back to work", exact: true }).click();
    await page
      .getByRole("heading", { name: historical.occurrence.filename, exact: true })
      .waitFor();
    await page.screenshot({
      path: join(environment().artifacts, "P05-lane-05.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "All documents", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByLabel("Filename or supplier", { exact: true }).focus();
    await page.keyboard.type("Architecture review supplier");
    await page.getByRole("button", { name: "Search archive", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: archive.items[0]!.filename, exact: true }).waitFor();
    await page.screenshot({
      path: join(environment().artifacts, "P05-lane-09.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.goto(`${workspace}/purchases?view=documents&record=${expenseOriginal.id}`);

    const enteredAndReviewedSource = page.getByRole("link", {
      name: "Expense source version 1",
      exact: true,
    });

    await enteredAndReviewedSource.first().waitFor();
    expect(await enteredAndReviewedSource.count()).toBe(2);
    await enteredAndReviewedSource.first().click();
    await page.getByText("10.00 SEK", { exact: true }).waitFor();
    expect(
      await page.getByRole("button", { name: /^Source revision 1 ·/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(new URL(page.url()).searchParams.get("expenseRevision")).toBe(JSON.stringify("1"));
    await page.reload();
    await page.getByText("10.00 SEK", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Back to work", exact: true }).click();
    await page.getByRole("link", { name: "Expense review version 1", exact: true }).click();
    await page.getByText("Retained earlier expense review", { exact: true }).last().waitFor();
    expect(new URL(page.url()).searchParams.get("expenseReviewId")).toBe(expenseReview.id);
    expect(
      await page.getByRole("button", { name: /^Review revision 1 ·/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    await page.reload();
    await page.getByText("Retained earlier expense review", { exact: true }).last().waitFor();
    await page.getByRole("link", { name: "Back to work", exact: true }).click();
    await page.getByRole("heading", { name: expenseOriginal.filename, exact: true }).waitFor();
    await page.goto(`${workspace}/tax?view=expenses&record=${expense.sourceId}`);
    await page.getByRole("button", { name: /^Source revision 1 ·/ }).click();
    await page.getByText("10.00 SEK", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("10.00 SEK", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("expenseRevision")).toBe(JSON.stringify("1"));
    const archiveStorage = await database();

    try {
      await archiveStorage.query("BEGIN");
      await archiveStorage.query("SET LOCAL session_replication_role = replica");
      await archiveStorage.query(
        "update openerp.intake_contents set bytes=null,object_key=$3,byte_length=$4 where book_id=$1 and sha256=$2",
        [
          book.bookId,
          expenseOriginal.sha256,
          `v1/${book.bookId}/${expenseOriginal.sha256.slice(7)}`,
          expenseOriginal.byteLength,
        ],
      );
      await archiveStorage.query("COMMIT");
    } finally {
      await archiveStorage.end();
    }

    await failure(
      await request(book, `/source-occurrences/${expenseOriginal.id}`),
      422,
      "MissingEvidence",
    );
    await page.goto(`${workspace}/purchases?view=documents&record=${expenseOriginal.id}`);
    await page.getByRole("heading", { name: expenseOriginal.filename, exact: true }).waitFor();
    await page.getByRole("link", { name: "Expense source version 2", exact: true }).waitFor();
    expect(
      await page.getByRole("button", { name: "Download original", exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByRole("button", { name: "Retry original", exact: true }).waitFor();
    expect(await page.getByRole("link", { name: "Prepare expense", exact: true }).count()).toBe(0);
    await page.screenshot({
      path: join(environment().artifacts, "P05-original-unavailable.png"),
      fullPage: true,
    });
    await writeFile(
      join(environment().artifacts, "document-library-browser.json"),
      JSON.stringify(
        {
          supplierId: supplier.id,
          selected: selected.occurrence.id,
          cursor,
          displayMs,
          expenseSource: expense.sourceId,
          expenseReview: expenseReview.id,
          historical: historical.draft.id,
          exactRevision: "1",
          nativeZoom: "not_observed",
        },
        null,
        2,
      ),
    );
  });
}, 180000);
