import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Workspace from "../../packages/contracts/src/workspace";
import { retainForeignBrowserOriginal } from "../../apps/api/tests/support/browser-original-fixture";
import { signInSyntheticOperator } from "./synthetic-session";
import { twoPageOriginal } from "./original-fixture";

function originalHash(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function originalClient(browser: Browser, workspace: string) {
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const requestUrl = (url: string, body?: unknown) =>
    fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

  const request = (path: string, body?: unknown) => requestUrl(`${base}${path}`, body);

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await request(path, body);
    const text = await response.text();

    expect(response.status).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(text);
  };

  return { origin, base, call, request, requestUrl };
}

async function retainedOriginalReview(
  client: Awaited<ReturnType<typeof originalClient>>,
  wrongExpectedHash: boolean,
) {
  const suffix = randomUUID();
  const bytes = twoPageOriginal();
  const filename = `original-reader-${suffix}.pdf`;

  const occurrence = await client.call("/source-occurrences", Source.SourceOccurrence, {
    sourceSystem: "synthetic-p03-browser",
    sourceAccountId: "synthetic_originals",
    occurrenceKey: suffix,
    sourceRevision: "1",
    filename,
    mediaType: "application/pdf",
    contentBase64: bytes.toString("base64"),
  });

  expect(occurrence.sha256).toBe(originalHash(bytes));

  const expectedHash = wrongExpectedHash ? `sha256:${"0".repeat(64)}` : occurrence.sha256;
  const description = `Original reader ${suffix}`;

  const evidence = await client.call("/evidence", Accounting.Evidence, {
    title: description,
    origin: "Synthetic immutable original reader acceptance",
    mediaType: "application/json",
    content: JSON.stringify({
      kind: "supplier_invoice_source_v1",
      source: { occurrenceId: occurrence.id, sha256: expectedHash, filename },
    }),
  });

  const setup = await client.call("/setup", Accounting.BookSetup);

  const plan = await client.call("/change-sets", Accounting.ChangeSet, {
    kind: "manual_journal",
    evidenceId: evidence.id,
    eventKey: `original_${suffix}`,
    accountingPeriodId: "period_synthetic_2026",
    postingDate: setup.today,
    series: "A",
    description,
    rationale: "Inspect the retained original without changing the reviewed proposal",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "account_bank",
        debitMinor: "12500",
        creditMinor: "0",
        description: "Synthetic bank debit",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "12500",
        description: "Synthetic clearing credit",
      },
    ],
  });

  const inventoryPath = `/work?status=all&q=${encodeURIComponent(description)}`;
  const inventory = await client.call(inventoryPath, Workspace.WorkPage);
  const ledger = await client.call("/ledger", Accounting.LedgerSnapshot);

  expect(inventory.items.map((item) => item.id)).toEqual([plan.id]);

  return {
    bytes,
    filename,
    occurrence,
    expectedHash,
    evidence,
    plan,
    inventoryPath,
    inventory,
    ledger,
  };
}

async function unchangedOriginalReview(
  client: Awaited<ReturnType<typeof originalClient>>,
  fixture: Awaited<ReturnType<typeof retainedOriginalReview>>,
) {
  const ledger = await client.call("/ledger", Accounting.LedgerSnapshot);
  const plan = await client.call(`/change-sets/${fixture.plan.id}`, Accounting.ChangeSet);
  const inventory = await client.call(fixture.inventoryPath, Workspace.WorkPage);

  expect(ledger).toEqual(fixture.ledger);
  expect(plan).toEqual(fixture.plan);
  expect(inventory.items).toEqual(fixture.inventory.items);
  expect(inventory.total).toBe(fixture.inventory.total);
  expect(inventory.counts).toEqual(fixture.inventory.counts);

  return { ledger, plan, inventory };
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
  await screen.getByRole("button", "Ladda upp original", { exact: true }).click();
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
  await screen.getByRole("button", "Granska och fyll i faktura", { exact: true }).click();
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
  await agent.assert(
    "The Ny leverantörsfaktura dialog shows the original's second page and readable page-two text, Sida 2 av 2 and Zoom 125 %, while the entered invoice number remains P03-REVIEW-002. Return only the configured JSON judgment.",
    { timeout: 30000 },
  );
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
  await screen.getByRole("button", "Försök visa sidan igen", { exact: true }).click();
  await expect(screen.getByText("Sidan kunde inte visas.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("img", new RegExp(filename))).toHaveCount(0);
  await expect(screen.getByText("Independent original page two", { exact: true })).toHaveCount(0);
  await agent.assert(
    "The retried retained original still visibly reports Sidan kunde inte visas. No PDF page image or text from another original is shown. A remaining error is the expected correct result for this corrupt PDF. Return only the configured JSON judgment.",
    { timeout: 30000 },
  );
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

test("a retained proposal refuses an original with a different expected hash", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const client = await originalClient(browser, workspace);
  const fixture = await retainedOriginalReview(client, true);

  const original = await client.call(
    `/source-occurrences/${fixture.occurrence.id}`,
    Source.SourceOccurrenceView,
  );

  expect(original.occurrence.sha256).toBe(
    originalHash(Buffer.from(original.contentBase64, "base64")),
  );
  expect(original.occurrence.sha256).not.toBe(fixture.expectedHash);

  await app.open(
    `${workspace}/reviews/${encodeURIComponent(fixture.plan.id)}/${encodeURIComponent(fixture.plan.planDigest)}`,
  );
  await expect(
    screen.getByText("Kunde inte läsa in poster. Försök igen.", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(screen.getByRole("img", `${fixture.filename}, sida 1`, { exact: true })).toHaveCount(
    0,
  );
  await expect(screen.getByRole("button", "Ladda ned original", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("Independent original page one", { exact: true })).toHaveCount(0);
  await agent.assert(
    "The original pane visibly reports a read failure and shows neither the retained PDF page nor a download action. Return only the configured JSON judgment.",
    { timeout: 30000 },
  );

  const unchanged = await unchangedOriginalReview(client, fixture);
  const screenshot = await app.screenshot("p03-original-expected-hash-refused");

  await writeFile(
    join(output, "p03-original-expected-hash.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        occurrence: fixture.occurrence,
        actualHash: original.occurrence.sha256,
        expectedHash: fixture.expectedHash,
        descriptorEvidence: fixture.evidence,
        originalResponse:
          "Actual retained bytes independently hashed; no HTTP response was replaced",
        unchanged,
        screenshot,
      },
      null,
      2,
    ),
  );
});

test("a foreign retained original refuses both bytes and metadata to the current operator", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;
  const sessionFile = process.env.OPENERP_E2E_SESSION;

  if (!output || !sessionFile) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const client = await originalClient(browser, workspace);
  const team = await client.call("/workspace", Workspace.Coordination);
  const ledger = await client.call("/ledger", Accounting.LedgerSnapshot);
  const beforeInventory = await client.call("/work?status=all", Workspace.WorkPage);
  const filename = `foreign-original-${randomUUID()}.pdf`;

  const foreign = await retainForeignBrowserOriginal({
    sessionFile,
    origin: client.origin,
    currentActorId: team.actorId,
    bytes: twoPageOriginal(),
    filename,
  });

  const refusals: { path: string; status: number; code: string }[] = [];

  for (const suffix of ["", "/metadata"]) {
    for (const foreignScope of [true, false]) {
      const url = foreignScope
        ? `${client.origin}/api/v1/entities/${foreign.scope.entityId}/books/${foreign.scope.bookId}/source-occurrences/${foreign.occurrence.id}${suffix}`
        : `${client.base}/source-occurrences/${foreign.occurrence.id}${suffix}`;

      const response = await client.requestUrl(url);
      const body = await response.text();
      const error = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(body);

      expect(response.status).toBe(foreignScope ? 403 : 404);
      expect(error.code).toBe(foreignScope ? "Forbidden" : "NotFound");
      expect(body).not.toContain(filename);
      expect(body).not.toContain(foreign.occurrence.sha256);
      expect(body).not.toContain("contentBase64");
      expect(body).not.toContain("Independent original page one");
      refusals.push({
        path: new URL(response.url).pathname,
        status: response.status,
        code: error.code,
      });
    }
  }

  const deniedWorkspace = `${client.origin}/entities/${foreign.scope.entityId}/books/${foreign.scope.bookId}`;

  await app.open(`${deniedWorkspace}/purchases?view=documents&record=${foreign.occurrence.id}`);
  await expect(screen.getByRole("alert")).toHaveText(
    "Den här boken är inte tillgänglig för ditt konto. Välj en behörig arbetsyta.",
    { timeout: 90000 },
  );
  await expect(screen.getByRole("img", new RegExp(filename))).toHaveCount(0);
  await expect(screen.getByRole("button", "Ladda ned original", { exact: true })).toHaveCount(0);
  await expect(screen.getByText(filename, { exact: true })).toHaveCount(0);
  await agent.assert(
    "This book is visibly unavailable to the signed-in operator. Its original PDF, filename and download action are absent. Return only the configured JSON judgment.",
    { timeout: 30000 },
  );
  const afterInventory = await client.call("/work?status=all", Workspace.WorkPage);
  const afterLedger = await client.call("/ledger", Accounting.LedgerSnapshot);

  expect(afterLedger).toEqual(ledger);
  expect(afterInventory.items).toEqual(beforeInventory.items);
  expect(afterInventory.total).toBe(beforeInventory.total);
  expect(afterInventory.counts).toEqual(beforeInventory.counts);

  const screenshot = await app.screenshot("p03-foreign-original-scope-refused");

  await writeFile(
    join(output, "p03-foreign-original-scope.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        foreign,
        currentActorId: team.actorId,
        fixture: "Genuine second book and publicly retained PDF; no current-operator membership",
        refusals,
        beforeLedger: ledger,
        afterLedger,
        beforeInventory,
        afterInventory,
        screenshot,
      },
      null,
      2,
    ),
  );
});

test("the same original and proposal survive a lost original response and a keyboard retry", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const client = await originalClient(browser, workspace);
  const fixture = await retainedOriginalReview(client, false);
  const path = `${client.base}/source-occurrences/${fixture.occurrence.id}`;
  let lostOriginal: typeof Source.SourceOccurrenceView.Type | undefined;

  await browser.route(path, async (route) => {
    if (lostOriginal) {
      await route.continue();

      return;
    }

    try {
      expect(route.request.method).toBe("GET");

      const response = await fetch(route.request.url, {
        headers: route.request.headers,
        signal: AbortSignal.timeout(20000),
      });

      const body = await response.text();

      expect(response.status).toBe(200);

      const original = Schema.decodeSync(Schema.fromJsonString(Source.SourceOccurrenceView))(body);

      expect(original.occurrence).toEqual(fixture.occurrence);
      expect(originalHash(Buffer.from(original.contentBase64, "base64"))).toBe(
        fixture.expectedHash,
      );
      expect(original.contentBase64).toBe(fixture.bytes.toString("base64"));
      lostOriginal = original;
    } finally {
      await route.abort();
    }
  });

  try {
    await app.open(
      `${workspace}/reviews/${encodeURIComponent(fixture.plan.id)}/${encodeURIComponent(fixture.plan.planDigest)}`,
    );

    const retry = screen.getByRole("button", "Försök läsa originalet igen", { exact: true });

    await expect(retry).toBeVisible({ timeout: 90000 });
    expect(lostOriginal?.occurrence.id).toBe(fixture.occurrence.id);
    await expect(
      screen.getByRole("img", `${fixture.filename}, sida 1`, { exact: true }),
    ).toHaveCount(0);

    const interrupted = await unchangedOriginalReview(client, fixture);
    const interruptedScreenshot = await app.screenshot("p03-original-response-lost");
    const recoveredResponse = browser.waitForResponse(path);

    await retry.focus();
    await retry.press("Enter");

    const response = await recoveredResponse;

    expect(response.status).toBe(200);

    const recovered = Schema.decodeUnknownSync(Source.SourceOccurrenceView)(await response.json());

    expect(recovered.occurrence).toEqual(fixture.occurrence);
    expect(originalHash(Buffer.from(recovered.contentBase64, "base64"))).toBe(fixture.expectedHash);
    await expect(
      screen.getByRole("img", `${fixture.filename}, sida 1`, { exact: true }),
    ).toBeVisible();
    await screen.getByText("Sidtext", { exact: true }).click();
    await expect(screen.getByText("Independent original page one", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Ladda ned original", { exact: true })).toBeVisible();
    await agent.assert(
      "The retry has restored the original PDF's first page and its readable page text, beside the same unposted proposal. Return only the configured JSON judgment.",
      { timeout: 30000 },
    );

    const unchanged = await unchangedOriginalReview(client, fixture);
    const recoveredScreenshot = await app.screenshot("p03-original-response-retried");

    await writeFile(
      join(output, "p03-original-response-retry.json"),
      JSON.stringify(
        {
          syntheticOnly: true,
          occurrence: fixture.occurrence,
          expectedHash: fixture.expectedHash,
          transportFault:
            "Real successful original fetch validated before its browser response was aborted once",
          lostOriginal: lostOriginal?.occurrence,
          recoveredOriginal: recovered.occurrence,
          interrupted,
          unchanged,
          screenshots: [interruptedScreenshot, recoveredScreenshot],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.unroute(path);
  }
});
