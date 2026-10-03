import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Sales from "@open-erp/contracts/sales-register";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Source from "@open-erp/contracts/source-intake";
import {
  decoded,
  environment,
  fixture,
  evidence,
  request,
  prepare,
  execute,
  post,
  key,
} from "./support/fixtures";
import { withWorkspaceBrowser } from "./support/workspace-browser";

test("archive URL preserves its filters, cursor, detail selection and return focus", async () => {
  const book = await fixture();

  const timings: { openMs: number; closeMs: number }[] = [];

  await withWorkspaceBrowser(book, "navigation-context", async (page, workspace) => {
    page.on("pageerror", (error) => console.error(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) console.error(`${response.status()} ${response.url()}`);
    });
    const api = `${new URL(workspace).origin}${book.path}`;

    for (let ordinal = 0; ordinal < 13; ordinal += 1) {
      await decoded(
        await fetch(`${api}/source-occurrences`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${book.token}`,
            "content-type": "application/json",
            "idempotency-key": key(),
          },
          body: JSON.stringify({
            occurrenceKey: `navigation_${ordinal}`,
            sourceSystem: "navigation_fixture",
            sourceAccountId: "documents",
            sourceRevision: "1",
            filename: `navigation-${String(ordinal).padStart(2, "0")}.txt`,
            mediaType: "text/plain",
            contentBase64: Buffer.from(`Synthetic navigation original ${ordinal}`).toString(
              "base64",
            ),
          }),
        }),
        Source.SourceOccurrence,
      );
    }

    const firstPage = await decoded(
      await fetch(`${api}/source-archive?sourceSystem=navigation_fixture`, {
        headers: { authorization: `Bearer ${book.token}` },
      }),
      Source.ArchiveSearch,
    );

    expect(firstPage.items).toHaveLength(10);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await decoded(
      await fetch(
        `${api}/source-archive?sourceSystem=navigation_fixture&cursor=${firstPage.nextCursor}`,
        { headers: { authorization: `Bearer ${book.token}` } },
      ),
      Source.ArchiveSearch,
    );

    expect(secondPage.items).toHaveLength(3);
    const selected = secondPage.items[0]!;

    const queue =
      "?period=period_2026&status=open&sort=oldest&q=navigation&after=invoice_navigation";

    await page.goto(`${workspace}/purchases?view=documents&work=${encodeURIComponent(queue)}`);
    await page.getByLabel("Source system", { exact: true }).fill("navigation_fixture");
    await page.getByRole("button", { name: "Search archive", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sourceSystem"))
      .toBe("navigation_fixture");
    await page.reload();
    expect(await page.getByLabel("Source system", { exact: true }).inputValue()).toBe(
      "navigation_fixture",
    );
    await page.getByRole("button", { name: "Next documents", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("cursor"))
      .toBe(firstPage.nextCursor);
    await page.reload();
    await page.getByRole("link", { name: selected.filename, exact: true }).waitFor();
    expect(await page.getByRole("link", { name: /^navigation-.*\.txt$/ }).count()).toBe(3);

    for (let sample = 0; sample < 35; sample += 1) {
      const opened = performance.now();
      await page.getByRole("link", { name: selected.filename, exact: true }).click();
      await page.getByRole("button", { name: "All documents", exact: true }).waitFor();

      await page
        .getByRole("heading", { name: selected.filename, exact: true })
        .waitFor({ timeout: 5000 });
      const openMs = performance.now() - opened;
      const closed = performance.now();
      await page.getByRole("button", { name: "All documents", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
        .toBe(selected.filename);

      if (sample >= 5) timings.push({ openMs, closeMs: performance.now() - closed });
    }

    expect(new URL(page.url()).searchParams.get("cursor")).toBe(firstPage.nextCursor);
    expect(new URL(page.url()).searchParams.get("sourceSystem")).toBe("navigation_fixture");
    await page.screenshot({
      path: join(environment().artifacts, "archive-return.png"),
      fullPage: true,
    });

    await page.getByRole("link", { name: selected.filename, exact: true }).click();

    const prepareSupplier = page.getByRole("link", {
      name: "Prepare supplier invoice",
      exact: true,
    });

    await prepareSupplier.waitFor();
    await prepareSupplier.click();
    await page
      .getByRole("dialog", { name: "New supplier invoice", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.getByRole("link", { name: "Back to work", exact: true }).click();
    await page.getByRole("heading", { name: selected.filename, exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("work")).toBe(queue);
    expect(new URL(page.url()).searchParams.get("cursor")).toBe(firstPage.nextCursor);
    await page.getByRole("button", { name: "All documents", exact: true }).click();

    await page.goto(`${workspace}/purchases?view=documents&record=${selected.id}`);
    await page.getByRole("button", { name: "All documents", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe("Documents");
    await page.goto(
      `${workspace}/purchases?view=documents&sourceSystem=navigation_fixture&cursor=${firstPage.nextCursor}`,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("link", { name: selected.filename, exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "All documents", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe(selected.filename);
    await page.screenshot({
      path: join(environment().artifacts, "archive-keyboard-320.png"),
      fullPage: true,
    });
    await writeFile(
      join(environment().artifacts, "navigation-journey.json"),
      JSON.stringify(
        {
          scope: { entityId: book.entityId, bookId: book.bookId },
          firstPageCount: 10,
          secondPageCount: 3,
          cursor: firstPage.nextCursor,
          selected: { id: selected.id, filename: selected.filename },
          finalUrl: page.url(),
          nativeZoom: "not_observed",
        },
        null,
        2,
      ),
    );
  });

  const percentile = (values: number[], fraction: number) =>
    values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

  await writeFile(
    join(environment().artifacts, "performance.json"),
    JSON.stringify(
      {
        fixtureSize: 13,
        warmups: 5,
        trials: timings,
        open: {
          p50: percentile(
            timings.map((item) => item.openMs),
            0.5,
          ),
          p95: percentile(
            timings.map((item) => item.openMs),
            0.95,
          ),
        },
        close: {
          p50: percentile(
            timings.map((item) => item.closeMs),
            0.5,
          ),
          p95: percentile(
            timings.map((item) => item.closeMs),
            0.95,
          ),
        },
        baseline:
          "Archive cursor URLs absent before P01. Interleaved parent and trunk measurements remain required.",
      },
      null,
      2,
    ),
  );
}, 180000);

test("invoice Escape preserves unsaved fields until an explicit discard", async () => {
  const book = await fixture();
  await withWorkspaceBrowser(book, "navigation-unsaved", async (page, workspace) => {
    page.on("pageerror", (error) => console.error(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) console.error(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${workspace}/sales`);
    await page.getByRole("button", { name: "New invoice", exact: true }).click();
    await page.getByRole("dialog", { name: "New invoice", exact: true }).waitFor();
    const title = page.getByRole("textbox", { name: "Invoice · Draft", exact: true });
    await title.fill("Synthetic unsaved navigation invoice");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Close this invoice draft?", exact: true }).waitFor();
    await page.getByRole("button", { name: "Keep editing", exact: true }).last().click();
    expect(await title.inputValue()).toBe("Synthetic unsaved navigation invoice");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("record")).toBe(null);
    await writeFile(
      join(environment().artifacts, "navigation-unsaved.json"),
      JSON.stringify(
        {
          retainedTitle: "Synthetic unsaved navigation invoice",
          discardClosed: true,
          finalUrl: page.url(),
        },
        null,
        2,
      ),
    );
  });
}, 120000);

test("bank voucher links preserve scoped owner state and reject unknown return owners", async () => {
  const book = await fixture();
  const receipt = await execute(book, await prepare(book));

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: "navigation_statement",
    sourceBankAccountId: "navigation_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "12500",
    completeness: { declaredComplete: false, basis: "Synthetic navigation fixture" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-09-22",
        description: "Synthetic bank original",
        amountMinor: "12500",
      },
    ],
  };

  const original = await post(
    book,
    "/evidence",
    {
      title: "Navigation statement",
      mediaType: "application/json",
      content: JSON.stringify(statement),
      origin: "Synthetic navigation E2E",
    },
    Accounting.Evidence,
  );

  await post(
    book,
    "/bank-statements",
    { ...statement, evidenceId: original.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  await withWorkspaceBrowser(book, "navigation-bank", async (page, workspace) => {
    page.on("pageerror", (error) => console.error(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) console.error(`${response.status()} ${response.url()}`);
    });

    const bankSearch =
      "account=account_bank&from=2026-01-01&to=2026-12-31&tab=ledger&q=Bank&page=1";

    await page.goto(`${workspace}/accounts?${bankSearch}`);
    const voucherLink = page.getByRole("link", { name: "View voucher", exact: true }).first();

    await voucherLink.waitFor({ timeout: 5000 });
    const href = await voucherLink.getAttribute("href");
    expect(
      JSON.parse(
        decodeURIComponent(new URL(href!, workspace).searchParams.get("returnTo")!.slice(6)),
      ),
    ).toEqual({
      owner: "bank",
      search: {
        account: "account_bank",
        from: "2026-01-01",
        to: "2026-12-31",
        tab: "ledger",
        q: "Bank",
        page: "1",
      },
    });
    await voucherLink.click();
    await page.getByRole("button", { name: "Back to vouchers", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/entities/${book.entityId}/books/${book.bookId}/accounts`);
    const returned = new URL(page.url()).searchParams;
    expect(Object.fromEntries(returned)).toEqual({
      account: "account_bank",
      from: "2026-01-01",
      to: "2026-12-31",
      tab: "ledger",
      q: "Bank",
      page: '"1"',
    });

    for (const action of [
      "Review statement coverage",
      "Payment allocations",
      "Consents and account mappings",
    ]) {
      await page.goto(`${workspace}/accounts?${bankSearch}`);
      await page.getByText("Reconciliation reports and more tools", { exact: true }).click();
      await page.getByRole("link", { name: action, exact: true }).click();
      await page.getByRole("link", { name: "Back to work", exact: true }).click();
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toBe(`/entities/${book.entityId}/books/${book.bookId}/accounts`);
      expect(new URL(page.url()).searchParams.get("account")).toBe("account_bank");
      expect(new URL(page.url()).searchParams.get("q")).toBe("Bank");
      expect(new URL(page.url()).searchParams.get("from")).toBe("2026-01-01");
      expect(new URL(page.url()).searchParams.get("to")).toBe("2026-12-31");
    }

    const unsafe = encodeURIComponent(
      "owner:" +
        encodeURIComponent(
          JSON.stringify({ owner: "external", search: { href: "https://example.invalid" } }),
        ),
    );

    await page.goto(
      `${workspace}/books?view=vouchers&record=${receipt.voucherId}&returnTo=${unsafe}`,
    );
    await page.getByRole("button", { name: "Back to vouchers", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/entities/${book.entityId}/books/${book.bookId}/books`);
    expect(new URL(page.url()).searchParams.get("record")).toBe(null);
    await writeFile(
      join(environment().artifacts, "navigation-bank.json"),
      JSON.stringify(
        {
          voucherId: receipt.voucherId,
          returned: Object.fromEntries(returned),
          unsafeOwner: "rejected",
          finalUrl: page.url(),
        },
        null,
        2,
      ),
    );
  });
}, 120000);

test("sales page two, secondary routes and browser history retain the register and work return", async () => {
  const book = await fixture();
  const source = await evidence(book);

  const customer = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "customer",
      displayName: "Navigation customer",
      evidenceId: source.id,
      reason: "Synthetic navigation fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "Navigation identity",
    registrationId: null,
    taxId: null,
    address: null,
    countryCode: "SE",
    evidenceId: source.id,
  };

  for (let ordinal = 0; ordinal < 53; ordinal += 1) {
    await post(
      book,
      "/commerce/invoice-drafts",
      {
        draftKey: `navigation_${ordinal}`,
        content: {
          title: `Navigation invoice ${String(ordinal).padStart(2, "0")}`,
          counterpartyId: customer.id,
          counterpartyRevision: customer.revision,
          seller: identity,
          customer: identity,
          currency: "SEK",
          currencyScale: 2,
          plannedIssueDate: "2026-09-22",
          supplyDate: "2026-09-22",
          dueDate: "2026-10-22",
          paymentTerms: null,
          sourceTotalMinor: "12500",
          lines: [
            {
              id: "line_1",
              description: "Synthetic navigation service",
              quantity: "1",
              unitPriceMinor: "10000",
              baseMinor: "10000",
              discountMinor: "0",
              chargeMinor: "0",
              taxMinor: "2500",
              taxDescription: "Synthetic tax",
              taxEvidenceId: source.id,
              sourceGrossMinor: "12500",
            },
          ],
        },
      },
      Drafts.InvoiceDraftRevision,
    );
  }

  const second = await decoded(
    await request(book, "/commerce/sales-register?status=draft&sort=oldest&q=Navigation&page=2"),
    Sales.SalesPage,
  );

  expect(second.items).toHaveLength(3);
  const selected = second.items[0]!;

  await withWorkspaceBrowser(book, "navigation-sales", async (page, workspace) => {
    const queue = "?period=period_2026&status=open&q=Navigation";
    const register = `${workspace}/sales?status=draft&sort=oldest&q=Navigation&page=2&work=${encodeURIComponent(queue)}`;
    await page.goto(register);
    const opener = page.getByRole("link", { name: selected.title, exact: true });
    await opener.click();
    await page.getByRole("button", { name: "Edit draft", exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("work")).toBe(queue);
    await page.getByRole("button", { name: "Close invoice", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("record")).toBe(null);
    expect(String(JSON.parse(new URL(page.url()).searchParams.get("page")!))).toBe("2");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe(selected.title);

    for (const action of ["Quotes and orders", "Article catalog", "Collections"]) {
      await page.getByRole("link", { name: action, exact: true }).click();
      await page.getByRole("link", { name: "Back to invoices", exact: true }).click();
      expect(new URL(page.url()).searchParams.get("q")).toBe("Navigation");
      expect(new URL(page.url()).searchParams.get("sort")).toBe("oldest");
      expect(new URL(page.url()).searchParams.get("status")).toBe("draft");
      expect(new URL(page.url()).searchParams.get("work")).toBe(queue);
      expect(String(JSON.parse(new URL(page.url()).searchParams.get("page")!))).toBe("2");
    }

    await opener.click();
    await page.getByRole("button", { name: "Review invoice", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("stage")).toBe("review");
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get("stage")).toBe(null);
    expect(new URL(page.url()).searchParams.get("record")).toBe(selected.id);
    await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.get("stage")).toBe("review");
    expect(new URL(page.url()).searchParams.get("record")).toBe(selected.id);
    await writeFile(
      join(environment().artifacts, "navigation-sales.json"),
      JSON.stringify(
        {
          selected: { id: selected.id, title: selected.title },
          fixtureSize: 53,
          page: 2,
          finalUrl: page.url(),
        },
        null,
        2,
      ),
    );
  });
}, 120000);
