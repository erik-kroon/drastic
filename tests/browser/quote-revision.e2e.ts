import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "@e2e-dev/web";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Commerce from "../../packages/contracts/src/commerce";
import * as Company from "../../packages/contracts/src/company-setup";
import * as Drafts from "../../packages/contracts/src/invoice-drafts";
import * as Sales from "../../packages/contracts/src/sales-orders";
import { signInSyntheticOperator } from "./synthetic-session";

const revisionLabel = "Spara ny offertrevision";

const sourceLabel = "Fakturaunderlag";

const previewLabel = "Granskat ersättningsunderlag";

async function quoteFixture(browser: Browser, baseUrl: string | undefined, name: string) {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, baseUrl);
  const origin = new URL(workspace).origin;
  const scopePath = new URL(workspace).pathname;
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const request = (path: string, body?: unknown, key: string = randomUUID()) =>
    fetch(`${origin}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await request(path, body);

    if (response.status !== 200)
      throw new Error(`Synthetic ${path} returned ${response.status}: ${await response.text()}`);

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  const commercePath = `${scopePath}/commerce`;
  const documentsPath = `${commercePath}/sales-documents`;
  const beforeLedger = await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot);
  const beforeInvoices = await call(`${commercePath}/invoices`, Commerce.InvoicePage);

  const makeSource = async (path: string, variant: "A" | "B") => {
    const evidence = await call(`${path}/evidence`, Accounting.Evidence, {
      title: `Synthetic quote evidence ${name} ${variant}`,
      content: "Disposable source transcription with explicitly retained zero tax. No real sale.",
      mediaType: "text/plain",
      origin: "Synthetic quote revision E2E",
    });

    const customerName = `Synthetic customer ${variant} ${name}`;

    const customer = await call(`${path}/commerce/counterparties`, Commerce.CounterpartyRevision, {
      kind: "synthetic_counterparty_v1",
      externalKey: randomUUID(),
      role: "customer",
      displayName: customerName,
      evidenceId: evidence.id,
      reason: "Disposable quote revision customer",
    });

    const identity = {
      registrationId: null,
      taxId: null,
      address: null,
      countryCode: "SE",
      evidenceId: evidence.id,
    };

    const content: typeof Drafts.DraftContent.Type = {
      title: `Synthetic source ${variant} ${name}`,
      counterpartyId: customer.id,
      counterpartyRevision: customer.revision,
      seller: { ...identity, legalName: "Synthetic quote seller" },
      customer: { ...identity, legalName: customerName },
      currency: "SEK",
      currencyScale: 2,
      plannedIssueDate: null,
      supplyDate: null,
      dueDate: null,
      paymentTerms: "Synthetic retained payment terms",
      note: `Retained note ${variant}`,
      buyerReference: `Buyer ${variant}`,
      orderReference: `Reference ${variant}`,
      sourceTotalMinor: variant === "A" ? "25000" : "23700",
      lines: [
        {
          id: variant === "A" ? "quote_line_a" : "quote_line_b",
          description: `Synthetic line ${variant}`,
          quantity: variant === "A" ? "2" : "3",
          unitPriceMinor: variant === "A" ? "12500" : "7900",
          baseMinor: variant === "A" ? "25000" : "23700",
          discountMinor: "0",
          chargeMinor: "0",
          taxMinor: "0",
          taxDescription: "Synthetic retained zero tax",
          taxEvidenceId: evidence.id,
          sourceGrossMinor: variant === "A" ? "25000" : "23700",
        },
      ],
    };

    const input = Schema.encodeSync(Drafts.SourceCreateInvoiceDraft)({
      draftKey: `quote_source_${randomUUID()}`,
      content,
    });

    const record = await call(
      `${path}/commerce/invoice-drafts`,
      Drafts.InvoiceDraftRevision,
      input,
    );

    expect(record.totals.grossMinor).toBe(variant === "A" ? "25000" : "23700");
    expect(record.content).toEqual(content);

    return record;
  };

  const sourceA = await makeSource(scopePath, "A");
  const sourceB = await makeSource(scopePath, "B");

  const quoteA = await call(documentsPath, Sales.SalesDocument, {
    kind: "quote",
    content: { ...sourceA.content, title: `Synthetic quote A ${name}` },
  });

  const quoteB = await call(documentsPath, Sales.SalesDocument, {
    kind: "quote",
    content: { ...sourceB.content, title: `Synthetic quote B ${name}` },
  });

  const view = (id: string) => call(`${documentsPath}/${id}`, Sales.SalesDocumentView);

  const revise = (record: typeof Sales.SalesDocument.Type, source = sourceB) =>
    call(`${documentsPath}/${record.id}/revisions`, Sales.SalesDocument, {
      expectedRevision: record.revision,
      expectedDigest: record.digest,
      content: source.content,
      reason: "Synthetic concurrent revision",
    });

  const transition = (record: typeof Sales.SalesDocument.Type, action: "accept" | "cancel") =>
    call(`${documentsPath}/${record.id}/transitions`, Sales.SalesDocument, {
      expectedRevision: record.revision,
      expectedDigest: record.digest,
      action,
    });

  const invariants = async () => {
    expect(
      (await call(`${commercePath}/invoice-drafts/${sourceA.id}`, Drafts.InvoiceDraftView)).record,
    ).toEqual(sourceA);
    expect(
      (await call(`${commercePath}/invoice-drafts/${sourceB.id}`, Drafts.InvoiceDraftView)).record,
    ).toEqual(sourceB);
    expect(await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot)).toEqual(beforeLedger);
    expect(await call(`${commercePath}/invoices`, Commerce.InvoicePage)).toEqual(beforeInvoices);
    expect((await view(quoteB.id)).conversions).toEqual([]);
  };

  return {
    output,
    workspace,
    origin,
    cookie,
    scopePath,
    commercePath,
    documentsPath,
    sourceA,
    sourceB,
    quoteA,
    quoteB,
    request,
    call,
    view,
    revise,
    transition,
    invariants,
    makeSource,
  };
}

test("a reloaded quote deliberately reviews its own replacement and retains exact stored content", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const fixture = await quoteFixture(browser, app.baseUrl, "review");
  const { sourceA, sourceB, quoteA, quoteB } = fixture;
  const page = `${fixture.workspace}/sales?view=orders`;
  const sheet = screen.getByRole("complementary", "Vald offert eller order", { exact: true });
  const form = sheet.getByRole("form", revisionLabel, { exact: true });
  const preview = sheet.getByRole("region", previewLabel, { exact: true });

  const choose = async (source: typeof sourceA) => {
    await form
      .getByRole("combobox", sourceLabel, { exact: true })
      .selectOption({ value: source.id });
  };

  await app.open(page);
  await browser.reload();
  const opener = screen.getByRole("button", quoteB.content.title, { exact: true });

  await opener.press("Enter");
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", revisionLabel, { exact: true })).toBeDisabled();
  await expect(preview).toHaveCount(0);
  await browser.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();

  await screen.getByRole("button", "Ny offert", { exact: true }).click();
  const creation = screen.getByRole("dialog", "Ny offert eller order", { exact: true });

  await creation.getByRole("combobox", sourceLabel, { exact: true }).click();
  await screen
    .getByRole("option", `${sourceA.content.customer.legalName}, ${sourceA.content.title}`, {
      exact: true,
    })
    .click();
  await creation.getByRole("button", "Hämta underlag", { exact: true }).click();
  await expect(creation.getByRole("button", "Skapa offert", { exact: true })).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(creation).toBeHidden();
  await opener.click();
  await expect(form).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(form.getByRole("button", revisionLabel, { exact: true })).toBeDisabled();
  await choose(sourceA);
  await expect(preview).toContainText(sourceA.content.title);
  await form.getByRole("textbox", "Skäl till ändring", { exact: true }).fill("Abandoned review");
  await browser.keyboard.press("Escape");
  expect((await fixture.view(quoteB.id)).record).toEqual(quoteB);
  await opener.press("Enter");
  await expect(preview).toHaveCount(0);
  await expect(form.getByRole("textbox", "Skäl till ändring", { exact: true })).toHaveCount(0);
  await choose(sourceB);
  await expect(preview).toContainText(sourceB.content.title);
  await expect(preview).toContainText(sourceB.content.customer.legalName);
  await expect(preview).toContainText("Synthetic line B");
  await expect(preview).toContainText("237,00");
  const before = await app.screenshot("quote-revision-reviewed-source");

  await browser.setViewport({ width: 400, height: 900 });
  expect(await browser.evaluate("() => document.documentElement.scrollWidth <= innerWidth")).toBe(
    true,
  );
  await agent.act(
    "Use the keyboard to fill the textbox named Skäl till ändring with 'Granskat sparat underlag B'. Leave the quote unsaved for inspection.",
  );
  const reason = form.getByRole("textbox", "Skäl till ändring", { exact: true });

  await expect(reason).toHaveValue("Granskat sparat underlag B");
  await reason.press("Tab");
  const save = form.getByRole("button", revisionLabel, { exact: true });

  await expect(save).toBeFocused();
  await expect(save).toBeEnabled();
  await save.press("Enter");
  await expect.poll(async () => (await fixture.view(quoteB.id)).record.revision).toBe("2");
  const replaced = (await fixture.view(quoteB.id)).record;

  expect(replaced.id).toBe(quoteB.id);
  expect(replaced.content).toEqual(sourceB.content);
  expect(replaced.calculation).toMatchObject({ totals: { grossMinor: "23700" } });
  await browser.reload();
  await screen.getByRole("button", sourceB.content.title, { exact: true }).click();
  await sheet.getByLabel("Visa sparat offertinnehåll", { exact: true }).click();
  const saved = sheet.getByRole("region", "Sparat offertinnehåll", { exact: true });

  await expect(saved).toContainText(sourceB.content.customer.legalName);
  await expect(saved).toContainText("Synthetic line B");
  await expect(saved).toContainText("237,00");
  const after = await app.screenshot("quote-revision-reloaded-400");

  await browser.keyboard.press("Escape");
  await screen.getByRole("button", quoteA.content.title, { exact: true }).click();
  await expect(form).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(form.getByRole("textbox", "Skäl till ändring", { exact: true })).toHaveCount(0);
  expect((await fixture.view(quoteA.id)).record).toEqual(quoteA);
  await fixture.invariants();
  await writeFile(
    join(fixture.output, "quote-revision-review.json"),
    JSON.stringify(
      {
        qualification:
          "Public saved-source replacement, keyboard review and exact stored owner comparisons",
        limits:
          "Current Paper K03/K05 patterns only. No dedicated quote parity, numbering, expiry or delivery qualification.",
        quoteBefore: quoteB,
        quoteAfter: replaced,
        sourceA,
        sourceB,
        before,
        after,
      },
      null,
      2,
    ),
  );
});

test("late, failed and mismatched source reads cannot qualify another quote replacement", async ({
  app,
  browser,
  screen,
}) => {
  const fixture = await quoteFixture(browser, app.baseUrl, "reads");
  const { sourceA, sourceB, quoteB } = fixture;
  const sheet = screen.getByRole("complementary", "Vald offert eller order", { exact: true });
  const form = sheet.getByRole("form", revisionLabel, { exact: true });
  const preview = sheet.getByRole("region", previewLabel, { exact: true });
  const save = form.getByRole("button", revisionLabel, { exact: true });
  const sourcePath = `${fixture.origin}/api/v1${fixture.commercePath}/invoice-drafts`;

  const choose = async (source: typeof sourceA) => {
    await form
      .getByRole("combobox", sourceLabel, { exact: true })
      .selectOption({ value: source.id });
  };

  const open = async () => {
    await app.open(`${fixture.workspace}/sales?view=orders`);
    await screen.getByRole("button", quoteB.content.title, { exact: true }).click();
    await expect(form).toBeVisible();
  };

  await open();
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let delivered: (() => void) | undefined;

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });

  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });

  const realA = await fixture.request(`${fixture.commercePath}/invoice-drafts/${sourceA.id}`);

  expect(realA.status).toBe(200);
  const realBody = await realA.text();

  await browser.route(`${sourcePath}/${sourceA.id}`, async (route) => {
    if (!entered || !delivered) throw new Error("The late source barriers must be initialized");
    entered();
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: realBody });
    delivered();
  });

  try {
    await choose(sourceA);
    await started;
    await expect(preview).toHaveCount(0);
    await expect(save).toBeDisabled();
    await choose(sourceB);
    await expect(preview).toContainText(sourceB.content.title);

    if (!release) throw new Error("The held source must have a release barrier");
    release();
    await finished;
    await expect(preview).toContainText(sourceB.content.title);
    await expect(preview).not.toContainText(sourceA.content.title);
  } finally {
    release?.();
    await browser.unroute(`${sourcePath}/${sourceA.id}`);
  }

  await browser.reload();
  await open();
  await choose(sourceA);
  await expect(preview).toContainText(sourceA.content.title);
  await browser.route(`${sourcePath}/${sourceB.id}`, async (route) => {
    await route.continue({ url: `${sourcePath}/missing_quote_source` });
  });
  await choose(sourceB);
  await expect(form.getByText("NotFound", { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(save).toBeDisabled();
  await browser.unroute(`${sourcePath}/${sourceB.id}`);

  const foreign = await fixture.call("/companies", Company.CompanySetup, {
    name: "Synthetic independent quote source book",
  });

  const foreignScope = `/entities/${foreign.scope.entityId}/books/${foreign.scope.bookId}`;

  await fixture.call(`${foreignScope}/company-setup/native-ledger`, Company.NativeLedgerSetup, {
    expectedRevision: foreign.revision,
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    accounts: [{ code: "1930", name: "Synthetic independent quote source account" }],
  });

  const foreignRead = await fixture.request(
    `${foreignScope}/commerce/invoice-drafts/${sourceB.id}`,
  );

  expect(foreignRead.status).toBe(404);

  for (const responseUrl of [
    `${sourcePath}/${sourceA.id}`,
    `${fixture.origin}/api/v1${foreignScope}/commerce/invoice-drafts/${sourceB.id}`,
  ]) {
    await browser.reload();
    await open();
    await browser.route(`${sourcePath}/${sourceB.id}`, async (route) => {
      await route.continue({ url: responseUrl });
    });
    await choose(sourceB);
    await expect(
      form.getByText(
        responseUrl.includes(foreignScope) ? "NotFound" : "Kunde inte läsa in poster. Försök igen.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(preview).toHaveCount(0);
    await expect(save).toBeDisabled();
    await browser.unroute(`${sourcePath}/${sourceB.id}`);
  }

  await app.open(`${fixture.origin}${foreignScope}/sales?view=orders`);
  await expect(screen.getByRole("button", quoteB.content.title, { exact: true })).toHaveCount(0);
  await open();
  await expect(preview).toHaveCount(0);
  expect((await fixture.view(quoteB.id)).record).toEqual(quoteB);
  expect((await fixture.view(fixture.quoteA.id)).record).toEqual(fixture.quoteA);
  await fixture.invariants();
  const screenshot = await app.screenshot("quote-revision-source-boundary");

  await writeFile(
    join(fixture.output, "quote-revision-reads.json"),
    JSON.stringify(
      {
        qualification:
          "Real public source records, delayed delivery, real 404 and foreign identity/scope refusal",
        limits:
          "Transport timing and rerouting exercise client parsing; no mocked financial records or calculation.",
        unchangedQuote: quoteB,
        sourceA,
        sourceB,
        foreignScope: foreign.scope,
        screenshot,
      },
      null,
      2,
    ),
  );
});

test("stale quote commands refuse overwrite and lost responses recover the exact request after acceptance", async ({
  app,
  browser,
  screen,
}) => {
  const fixture = await quoteFixture(browser, app.baseUrl, "recovery");
  const { quoteA, quoteB, sourceB } = fixture;
  const page = `${fixture.workspace}/sales?view=orders`;
  const sheet = screen.getByRole("complementary", "Vald offert eller order", { exact: true });
  const form = sheet.getByRole("form", revisionLabel, { exact: true });
  const revisionPath = `${fixture.origin}/api/v1${fixture.documentsPath}/${quoteB.id}/revisions`;

  const chooseB = async () => {
    await form
      .getByRole("combobox", sourceLabel, { exact: true })
      .selectOption({ value: sourceB.id });
    await expect(sheet.getByRole("region", previewLabel, { exact: true })).toContainText(
      sourceB.content.title,
    );
    await form
      .getByRole("textbox", "Skäl till ändring", { exact: true })
      .fill("Reviewed replacement");
  };

  await app.open(page);
  await screen.getByRole("button", quoteB.content.title, { exact: true }).click();
  await expect(form).toBeVisible();
  await chooseB();
  const competing = await fixture.revise(quoteB);

  expect(competing.revision).toBe("2");
  await form.getByRole("button", revisionLabel, { exact: true }).click();
  await expect(form.getByText("StaleDependency", { exact: true })).toBeVisible();
  expect((await fixture.view(quoteB.id)).record).toEqual(competing);
  await form.getByRole("button", "Starta en ny åtgärd", { exact: true }).click();
  await browser.reload();
  await screen.getByRole("button", sourceB.content.title, { exact: true }).click();
  await expect(form).toBeVisible();
  await chooseB();

  const requests: { key: string; body: string }[] = [];
  let committed: typeof Sales.SalesDocument.Type | undefined;

  await browser.route(revisionPath, async (route) => {
    requests.push({
      key: route.request.headers["idempotency-key"] ?? "",
      body: route.request.postData ?? "",
    });

    if (committed) {
      await route.continue();

      return;
    }

    const response = await fetch(route.request.url, {
      method: route.request.method,
      headers: { ...route.request.headers, cookie: fixture.cookie, origin: fixture.origin },
      body: route.request.postData ?? undefined,
      signal: AbortSignal.timeout(20000),
    });

    expect(response.status).toBe(200);
    committed = Schema.decodeUnknownSync(Sales.SalesDocument)(await response.json());
    await route.abort();
  });
  await form.getByRole("button", revisionLabel, { exact: true }).click();
  const retry = form.getByRole("button", "Försök igen med exakt begäran", { exact: true });

  await expect(retry).toBeVisible();

  if (!committed) throw new Error("The real quote revision must commit before response loss");
  expect(committed.revision).toBe("3");
  expect(committed.content).toEqual(sourceB.content);
  expect(committed.calculation).toEqual(competing.calculation);
  const accepted = await fixture.transition(committed, "accept");
  const lostResponse = await app.screenshot("quote-revision-response-lost");

  await browser.reload();
  await screen.getByRole("button", sourceB.content.title, { exact: true }).click();
  await expect(retry).toBeVisible();
  await expect(form.getByRole("combobox", sourceLabel, { exact: true })).toHaveCount(0);
  await retry.press("Enter");
  await expect(retry).toBeHidden();
  expect(requests).toHaveLength(2);
  expect(requests[0]?.key).not.toBe("");
  expect(requests[1]).toEqual(requests[0]);
  const exact = requests[0];

  if (!exact) throw new Error("The captured exact revision request is missing");

  const recoveredResponse = await fixture.request(
    `${fixture.documentsPath}/${quoteB.id}/revisions`,
    JSON.parse(exact.body),
    exact.key,
  );

  expect(recoveredResponse.status).toBe(200);
  const recovered = Schema.decodeUnknownSync(Sales.SalesDocument)(await recoveredResponse.json());

  expect(recovered).toEqual(committed);
  expect((await fixture.view(quoteB.id)).record).toEqual(accepted);
  await browser.unroute(revisionPath);
  await browser.reload();
  await screen.getByRole("button", sourceB.content.title, { exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(sheet.getByRole("button", "Skapa order från offert", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", "Avbryt offert", { exact: true })).toBeVisible();

  for (const record of [accepted, await fixture.transition(quoteA, "cancel")]) {
    const response = await fixture.request(`${fixture.documentsPath}/${record.id}/revisions`, {
      expectedRevision: record.revision,
      expectedDigest: record.digest,
      content: sourceB.content,
      reason: "Synthetic forbidden state revision",
    });

    expect(response.status).toBe(422);
    expect(Schema.decodeUnknownSync(Accounting.AccountingError)(await response.json()).code).toBe(
      "InvalidJournal",
    );
    expect((await fixture.view(record.id)).record).toEqual(record);
  }

  await browser.keyboard.press("Escape");
  await screen.getByRole("button", quoteA.content.title, { exact: true }).click();
  await expect(form).toHaveCount(0);
  await fixture.invariants();

  if (process.env.PAPER_FIRM_RECOVERY !== "1")
    throw new Error("Enable PAPER_FIRM_RECOVERY=1 to qualify the independent signed-in human");
  const sessionFile = process.env.OPENERP_E2E_SESSION;

  if (!sessionFile) throw new Error("The disposable operator session is missing");

  const session = Schema.decodeSync(
    Schema.fromJsonString(Schema.Struct({ password: Schema.String })),
  )(await readFile(sessionFile, "utf8"));

  const login = await fetch(`${fixture.origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: fixture.origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "departing@example.test", password: session.password }),
    signal: AbortSignal.timeout(15000),
  });

  expect(login.status).toBe(200);

  const humanCookie = login.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");

  expect(humanCookie.length).toBeGreaterThan(0);

  const denied = await fetch(revisionPath, {
    method: "POST",
    headers: {
      cookie: humanCookie,
      origin: fixture.origin,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      expectedRevision: accepted.revision,
      expectedDigest: accepted.digest,
      content: sourceB.content,
      reason: "Synthetic independent human authority refusal",
    }),
    signal: AbortSignal.timeout(20000),
  });

  expect(denied.status).toBe(403);
  expect(Schema.decodeUnknownSync(Accounting.AccountingError)(await denied.json()).code).toBe(
    "Forbidden",
  );
  expect((await fixture.view(quoteB.id)).record).toEqual(accepted);
  const after = await app.screenshot("quote-revision-cancelled-state");

  await writeFile(
    join(fixture.output, "quote-revision-recovery.json"),
    JSON.stringify(
      {
        qualification:
          "Public competing revision, exact idempotent recovery after acceptance, state and authority refusal",
        limits:
          "Concurrent writer is a public API command. Independent human has no book access; admitted non-operator UI is not qualified.",
        competing,
        committed,
        recovered,
        accepted,
        exactRequests: requests,
        lostResponse,
        after,
      },
      null,
      2,
    ),
  );
});
