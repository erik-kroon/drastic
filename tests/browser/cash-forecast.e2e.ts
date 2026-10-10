import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Bank from "../../packages/contracts/src/reconciliation";
import * as Closing from "../../packages/contracts/src/closing";
import * as Coverage from "../../packages/contracts/src/bank-source-coverage";
import * as Settlement from "../../packages/contracts/src/settlements";
import * as Cash from "../../packages/contracts/src/cash-forecast";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";
import { readRunArtifact } from "./reminder-paper-capture";

test("Cash discovery exposes absent sources and retains accessible recovery after reload", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  await app.open(`${workspace}/reports?view=cash_forecast`);
  await expect(screen.getByRole("heading", "Kassaflöde")).toBeVisible({ timeout: 90_000 });
  await expect(screen.getByText("Inga sparade prognoser", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Underlag för prognosen", { exact: true }).focus();
  await screen.getByRole("button", "Underlag för prognosen", { exact: true }).press("Enter");
  await expect(screen.getByRole("heading", "Underlag för prognosen")).toBeVisible();
  await expect(screen.getByText("Inga sparade underlag", { exact: true })).toBeVisible();
  await expect(screen.getByText("Kontoutdrag saknas", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("link", "Bank, Fjällby Konsult AB", { exact: true }),
  ).toHaveAttribute("href", `${new URL(workspace).pathname}/accounts`);
  await expect(screen.getByRole("link", "Bank", { exact: true })).toHaveCount(1);
  await expect(screen.getByRole("link", "Bank", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Bank", { exact: true })).toHaveAttribute(
    "href",
    `${new URL(workspace).pathname}/accounts?view=coverage`,
  );
  await expect(screen.getByRole("button", "Spara underlag")).toBeDisabled();
  await app.screenshot("cash-missing-sources");
  await browser.reload();
  await expect(screen.getByRole("heading", "Kassaflöde")).toBeVisible();
  await screen.getByRole("button", "Underlag för prognosen").click();
  await expect(screen.getByText("Kontoutdrag saknas", { exact: true })).toBeVisible();
  await browser.setViewport({ width: 390, height: 844 });
  await expect(screen.getByRole("link", "Bank", { exact: true })).toHaveCount(1);
  await expect(screen.getByRole("link", "Bank", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Bank", { exact: true })).toHaveAttribute(
    "href",
    `${new URL(workspace).pathname}/accounts?view=coverage`,
  );
  expect(
    await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await app.screenshot("cash-missing-sources-narrow");

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const origin = new URL(workspace).origin;

  const base = workspace.replace(origin, `${origin}/api/v1`);

  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    expect(response.status).toBe(200);

    return response.json();
  };

  const setup = Schema.decodeUnknownSync(Schema.Struct({ today: Schema.String }))(
    await call("/setup"),
  );

  const review = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await call("/evidence", {
      title: "Synthetic browser forecast source declaration",
      content: "Model product fixture. Sources deliberately unknown. No actual company assertion.",
      mediaType: "text/plain",
      origin: "cash-browser-synthetic",
    }),
  );

  const inventory = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await call("/periods/period_synthetic_2026/closing-source-inventories", {
      evidenceId: review.id,
      bankAccountIds: ["account_bank"],
    }),
  );

  const coverage = Schema.decodeUnknownSync(Coverage.BankSourceCoverageReport)(
    await call("/bank-source-coverage", {
      inventoryId: inventory.id,
      startsOn: `${setup.today.slice(0, 4)}-01-01`,
      endsOn: `${setup.today.slice(0, 4)}-12-31`,
    }),
  );

  await browser.setViewport({ width: 1440, height: 900 });
  await browser.reload();
  await screen.getByRole("button", "Underlag för prognosen").click();
  await screen.getByRole("combobox", "Kontoutdragstäckning").click();
  await screen
    .getByRole(
      "option",
      `${coverage.input.startsOn} till ${coverage.input.endsOn}, ${coverage.createdAt}`,
      { exact: true },
    )
    .click();
  await screen.getByRole("button", "1930 Synthetic bank account", { exact: true }).click();
  await expect(screen.getByRole("combobox", "Kontonas användning")).toContainText("Okänt");
  await expect(screen.getByRole("combobox", "Saldotyp")).toContainText("Okänt");
  await screen
    .getByRole("textbox", "Granskningsgrund", { exact: true })
    .fill("Syntetiskt okänt underlag");
  await screen.getByRole("button", "Spara underlag", { exact: true }).focus();
  await screen.getByRole("button", "Spara underlag", { exact: true }).press("Enter");
  await expect(screen.getByRole("heading", "Jämförelse")).toBeVisible();
  await agent.assert(
    "The saved source basis explicitly says Öppningssaldo Saknas and exposes unresolved bank-source blockers rather than claiming a known balance. Jämförelse is available below it.",
  );
  await screen.getByRole("textbox", "Din gräns, SEK").fill("100,00");
  await screen.getByRole("button", "Spara bild").click();
  await expect(
    screen.getByText("Öppningssaldo saknas. Saldo, minimum och marginal kan inte beräknas.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(screen.getByRole("figure", "Saldo framåt", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("figure", "Från öppning till slut", { exact: true })).toHaveCount(
    0,
  );
  await browser.reload();
  await expect(
    screen.getByText("Öppningssaldo saknas. Saldo, minimum och marginal kan inte beräknas.", {
      exact: true,
    }),
  ).toBeVisible();

  const history = Schema.decodeUnknownSync(
    Schema.Struct({
      total: Schema.Int,
      items: Schema.Array(
        Schema.Struct({ id: Schema.String, closingMinor: Schema.NullOr(Schema.String) }),
      ),
    }),
  )(await call("/cash-forecasts"));

  expect(history.total).toBe(1);
  expect(history.items[0]?.closingMinor).toBeNull();

  const view = Schema.decodeUnknownSync(
    Schema.Struct({ artifact: Schema.Struct({ content: Schema.String }) }),
  )(await call(`/cash-forecasts/${history.items[0]!.id}`));

  const downloaded = await browser.waitForDownload(() =>
    screen.getByRole("button", "Ladda ner originalet").click(),
  );

  expect((await readRunArtifact(downloaded.path)).toString("utf8")).toBe(view.artifact.content);
  await app.screenshot("cash-unknown-opening-retained-original");
  await call("/periods/period_synthetic_2026/closing-source-inventories", {
    evidenceId: review.id,
    bankAccountIds: [],
  });
  await screen.getByRole("button", "Läs in igen").click();
  await expect(
    screen.getByText("Inaktuell. Bilden är oförändrad och räknas inte om automatiskt.", {
      exact: true,
    }),
  ).toBeVisible();

  const after = Schema.decodeUnknownSync(
    Schema.Struct({ artifact: Schema.Struct({ content: Schema.String }) }),
  )(await call(`/cash-forecasts/${history.items[0]!.id}`));

  expect(after.artifact.content).toBe(view.artifact.content);
  await app.screenshot("cash-source-change-retains-original-result");
});

test("known opening retains native forecast charts, exact tables and immutable original", async ({
  app,
  browser,
  screen,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  const origin = new URL(workspace).origin;

  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    expect(response.status).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(await response.text());
  };

  const setup = await call("/setup", Accounting.BookSetup);

  const before = await call("/ledger", Accounting.LedgerSnapshot);

  expect(before.sequence).toBe("0");

  const today = setup.today;

  const startsOn = `${today.slice(0, 4)}-01-01`;

  const endsOn = `${today.slice(0, 4)}-12-31`;

  const source = await call("/evidence", Accounting.Evidence, {
    title: "Known synthetic opening",
    content: "Independent synthetic bank funding100000 minor; no real company data.",
    mediaType: "text/plain",
    origin: "DRA-216 native browser fixture",
  });

  const plan = await call("/change-sets", Accounting.ChangeSet, {
    kind: "manual_journal",
    evidenceId: source.id,
    eventKey: crypto.randomUUID(),
    accountingPeriodId: "period_synthetic_2026",
    postingDate: today,
    series: "A",
    description: "Independent synthetic opening",
    rationale: "Known-opening native browser fixture",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "account_bank",
        debitMinor: "100000",
        creditMinor: "0",
        description: "Synthetic bank opening",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "100000",
        description: "Synthetic opening clearing",
      },
    ],
  });

  const approval = await call(`/change-sets/${plan.id}/approvals`, Accounting.Approval, {
    planDigest: plan.planDigest,
    version: plan.version,
  });

  const receipt = await call(`/change-sets/${plan.id}/execute`, Accounting.ExecutionReceipt, {
    planDigest: plan.planDigest,
    version: plan.version,
    approvalId: approval.id,
  });

  const bankLine = plan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === "account_bank",
  );

  if (!bankLine) throw new Error("Native funding needs its bank line");

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: crypto.randomUUID(),
    sourceBankAccountId: "dra216_known_opening",
    accountId: "account_bank",
    currency: "SEK",
    startsOn,
    endsOn: today,
    openingMinor: "0",
    closingMinor: "100000",
    completeness: {
      declaredComplete: true,
      basis: "Independent synthetic closing; no provider attestation",
    },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: today,
        description: "Synthetic opening funding",
        amountMinor: "100000",
      },
    ],
  };

  const original = await call("/evidence", Accounting.Evidence, {
    title: "Independent synthetic bank statement",
    content: JSON.stringify(statement),
    mediaType: "application/json",
    origin: "DRA-216 native browser fixture",
  });

  const imported = await call("/bank-statements", Bank.StatementImportReceipt, {
    ...statement,
    evidenceId: original.id,
    existingMatches: [{ rowOrdinal: 1, voucherId: receipt.voucherId, lineId: bankLine.lineId }],
  });

  const reconciliation = await call(
    "/bank-capacity-reconciliations",
    Settlement.BankCapacityReconciliation,
    { accountId: "account_bank", startsOn, endsOn: today },
  );

  expect(reconciliation).toMatchObject({ bankClosingMinor: "100000", status: "complete" });

  const qualification = await call("/evidence", Accounting.Evidence, {
    title: "Synthetic selected-bank eligibility",
    content:
      "This synthetic entity bank statement closing is unrestricted. No private, restricted, tax or credit funds. Company coverage remains incomplete.",
    mediaType: "text/plain",
    origin: "DRA-216 explicit reviewed assumption",
  });

  const inventory = await call(
    "/periods/period_synthetic_2026/closing-source-inventories",
    Closing.ClosingInventory,
    { evidenceId: qualification.id, bankAccountIds: ["account_bank"] },
  );

  const coverage = await call("/bank-source-coverage", Coverage.BankSourceCoverageReport, {
    inventoryId: inventory.id,
    startsOn,
    endsOn,
  });

  const basis = await call("/cash-bases", Cash.CashBasis, {
    asOf: today,
    expectedDates: [],
    accounts: [
      {
        accountId: "account_bank",
        reconciliationId: reconciliation.id,
        coverageReportId: coverage.id,
        review: {
          evidenceId: qualification.id,
          sha256: qualification.sha256,
          eligibility: "unrestricted_entity_bank",
          balanceType: "statement_closing",
          reason: "Explicit independent synthetic eligibility review",
        },
      },
    ],
  });

  expect(basis.opening).toMatchObject({ status: "qualified", totalMinor: "100000" });
  expect(basis.contributions).toEqual([]);

  const forecast = await call("/cash-forecasts", Cash.CashForecastSnapshot, {
    basisId: basis.id,
    basisDigest: basis.digest,
    horizonDays: 30,
    bufferMinor: "90000",
    expectedDates: [],
  });

  const expectedDays = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);

    day.setUTCDate(day.getUTCDate() + index);

    return {
      on: day.toISOString().slice(0, 10),
      inflowMinor: "0",
      outflowMinor: "0",
      closingMinor: "100000",
      conservativeLowMinor: "100000",
    };
  });

  expect(forecast).toMatchObject({
    label: "known_items",
    companyCoverage: "incomplete",
    contributions: [],
    result: {
      status: "available",
      openingMinor: "100000",
      closingMinor: "100000",
      baseline: { minimum: { amountMinor: "100000", on: today }, headroomMinor: "10000" },
      conservative: { minimum: { amountMinor: "100000", on: today }, headroomMinor: "10000" },
      days: expectedDays,
    },
  });

  await app.open(
    `${workspace}/reports?view=cash_forecast&record=${encodeURIComponent(forecast.id)}`,
  );

  const lines = screen.getByRole("figure", "Saldo framåt", { exact: true });

  const waterfall = screen.getByRole("figure", "Från öppning till slut", { exact: true });

  await expect(lines).toBeVisible({ timeout: 90000 });
  await expect(waterfall).toBeVisible();
  await expect
    .poll(
      async () =>
        await browser.evaluate(() =>
          Array.from(
            document.querySelectorAll(
              "figure[aria-label='Saldo framåt'], figure[aria-label='Från öppning till slut']",
            ),
          ).map((figure) => figure.querySelectorAll("svg").length),
        ),
    )
    .toEqual([1, 1]);

  await lines.scrollIntoView();

  const chartScreenshot = await app.screenshot("cash-known-opening-charts");

  await lines.getByRole("button", "Visa som tabell", { exact: true }).focus();
  await lines.getByRole("button", "Visa som tabell", { exact: true }).press("Enter");
  await waterfall.getByRole("button", "Visa som tabell", { exact: true }).focus();
  await waterfall.getByRole("button", "Visa som tabell", { exact: true }).press("Enter");

  const tables = await browser.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "figure[aria-label='Saldo framåt'], figure[aria-label='Från öppning till slut']",
      ),
    ).map((figure) => ({
      name: figure.getAttribute("aria-label"),
      rows: Array.from(figure.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent),
      ),
    })),
  );

  const dayFormat = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  expect(tables).toEqual([
    {
      name: "Saldo framåt",
      rows: expectedDays.map((day) => [
        dayFormat.format(new Date(`${day.on}T00:00:00Z`)),
        "1\u00a0000,00",
        "1\u00a0000,00",
      ]),
    },
    {
      name: "Från öppning till slut",
      rows: [
        ["Öppning", "1\u00a0000,00"],
        ["In", "0,00"],
        ["Ut", "0,00"],
        ["Slut", "1\u00a0000,00"],
      ],
    },
  ]);

  const tableScreenshot = await app.screenshot("cash-known-opening-exact-tables");

  const view = await call(`/cash-forecasts/${forecast.id}`, Cash.CashForecastView);

  const downloaded = await browser.waitForDownload(() =>
    screen.getByRole("button", "Ladda ner originalet", { exact: true }).click(),
  );

  const artifact = (await readRunArtifact(downloaded.path)).toString("utf8");

  expect(artifact).toBe(view.artifact.content);
  await browser.reload();
  await expect(lines).toBeVisible();
  await expect(waterfall).toBeVisible();
  expect(
    (await call(`/cash-forecasts/${forecast.id}`, Cash.CashForecastView)).artifact.content,
  ).toBe(artifact);

  const after = await call("/ledger", Accounting.LedgerSnapshot);

  expect(BigInt(after.sequence) - BigInt(before.sequence)).toBe(1n);
  await writeFile(
    join(output, "cash-known-opening.json"),
    JSON.stringify(
      {
        synthetic: true,
        sourceId: source.id,
        originalId: original.id,
        originalSha256: original.sha256,
        imported,
        reconciliationId: reconciliation.id,
        coverageId: coverage.id,
        basisId: basis.id,
        basisDigest: basis.digest,
        forecast,
        expectedDays,
        tables,
        receipt,
        before,
        after,
        artifactSha256: createHash("sha256").update(artifact).digest("hex"),
        downloadAndReloadPreserveOriginal: true,
        chartScreenshot,
        tableScreenshot,
        qualification:
          "Known opening with zero scheduled inflow/outflow; incomplete company coverage; inconsistent snapshot guard inspected, not fabricated",
      },
      null,
      2,
    ),
  );
});
