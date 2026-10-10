import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const { chromium } = createRequire(import.meta.resolve("e2e"))("playwright");

const artifacts = process.env.PAPER_ARTIFACTS ?? "test-results/paper";

const runtime = JSON.parse(await readFile(join(artifacts, "runtime.json"), "utf8"));

const session = JSON.parse(await readFile(runtime.sessionFile, "utf8"));

const seed = JSON.parse(await readFile(join(artifacts, "demo-seed.json"), "utf8"));

assert.equal(new URL(session.url).hostname, "127.0.0.1");

assert.equal(session.workspace, `${session.url}/entities/entity_synthetic/books/book_synthetic`);

assert.equal(session.demoMode, seed.mode);

const expected = {
  demo: { open: "3", bank: 2, clients: 3 },
  worst: { open: "5", bank: 3, clients: 101 },
  empty: { open: "0", bank: 0, clients: 0 },
  one: { open: "1", bank: 1, clients: 1 },
  many: { open: "1003", bank: 1001, clients: 101 },
}[seed.mode];

assert.ok(expected, "Known disposable demo mode");

const browser = await chromium.launch({ headless: true });

try {
  // capture.mjs signs in and retains this private state before verification.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "sv-SE",
    storageState: join(dirname(runtime.sessionFile), "browser-state.json"),
    extraHTTPHeaders: session.testNow ? { "x-openerp-test-now": session.testNow } : undefined,
  });

  const base = `${session.url}/api/v1${new URL(session.workspace).pathname}`;

  const read = async (path) => {
    const response = await context.request.get(`${base}${path}`);

    assert.equal(response.ok(), true, `Read ${path}`);

    return response.json();
  };

  const obligations = await read("/bureau-obligations");

  assert.equal(obligations.checkedAt, "2026-10-02T06:54:00.000Z", "Board application instant");
  assert.equal(seed.applicationClock, obligations.checkedAt);

  const ledgerBefore = await read("/ledger");
  const keys = new Set();
  let after = null;

  do {
    const batch = await read(
      `/attention?status=open&sort=oldest${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    );

    assert.equal(batch.counts.open, expected.open);

    for (const item of batch.items) {
      assert.ok(!keys.has(item.key), "Pagination must not repeat records");
      keys.add(item.key);
    }

    after = batch.next;
  } while (after);

  assert.equal(keys.size, Number(expected.open), "Every waiting item remains reachable");

  let bankRows = 0;

  for (const retained of seed.bankStatements ?? []) {
    const view = await read(`/bank-statements/${encodeURIComponent(retained.statement.id)}`);

    assert.deepEqual(view.statement.rows, retained.statement.rows);
    bankRows += view.statement.rows.length;
  }

  assert.equal(bankRows, expected.bank, "Every imported bank row remains retained");

  const page = await context.newPage();
  await page.goto(`${session.url}${session.boards["K-10"].route}`, { waitUntil: "networkidle" });

  if (seed.portfolio) {
    const response = await context.request.get(
      `${session.url}/api/v1/firms/${seed.portfolio.firmId}/portfolio`,
    );

    assert.equal(response.ok(), true, "Read retained portfolio");
    const portfolio = await response.json();

    assert.equal(portfolio.workspace.clients.length, expected.clients);
    assert.equal(portfolio.clients.length, expected.clients);

    if (seed.mode === "worst" || seed.mode === "many") {
      assert.equal(seed.portfolio.limitRefusal.owner, "company_create");
      assert.equal(seed.portfolio.limitRefusal.attemptedCreatedCompany, 101);
      assert.equal(seed.portfolio.limitRefusal.status, 422);
      assert.equal(seed.portfolio.limitRefusal.code, "InvalidJournal");
    }
  }

  if (seed.mode === "worst") {
    await page.getByText("Jo AB, faktura 1", { exact: true }).click();
    const panel = page.locator("aside").last();
    const figure = panel.locator("header p").first();

    assert.equal((await figure.innerText()).replace(/\D/g, ""), "9".repeat(38));

    const dimensions = await panel.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));

    assert.ok(dimensions.scroll <= dimensions.client + 1, "Maximum amount is not clipped");
    await page.getByText("Đặng Thị Ngọc Hân, faktura 1", { exact: true }).click();
    assert.equal((await figure.innerText()).trim(), "0,00");
  }

  if (seed.mode === "many") {
    const next = page.getByRole("link", { name: "Nästa sida", exact: true });
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await page.waitForLoadState("networkidle");
    assert.ok(new URL(page.url()).searchParams.has("after"), "Browser reaches the next page");
    await page
      .getByRole("button", { name: /Skannad_bild_\d+\.jpg/ })
      .first()
      .waitFor();
  }

  if (seed.mode === "demo") {
    await page.goto(`${session.url}${session.boards["K-21"].route}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Välj", exact: true }).first().click();
    await page.locator("canvas[role=img]").waitFor({ state: "visible" });
    assert.equal(
      await page.getByRole("button", { name: "Förbered matchning", exact: true }).isDisabled(),
      true,
    );

    await page.goto(`${session.url}${session.boards["K-15"].route}`, { waitUntil: "networkidle" });

    for (const name of session.boards["K-15"].buttonClicks)
      await page.getByRole("button", { name, exact: true }).first().click();
    await page.getByText("Okänt utfall", { exact: true }).waitFor();
    const retained = await read(`/saved-posting-requests/${seed.unknown.key}`);

    assert.equal(retained.outcome, null, "Unknown remains an unattempted saved request");
    assert.equal(retained.request.operation, "prepare_journal");
  }

  assert.deepEqual(await read("/ledger"), ledgerBefore, "Browsing never changes posted history");

  const result = {
    synthetic: true,
    mode: seed.mode,
    passed: true,
    waitingItems: keys.size,
    retainedBankRows: bankRows,
    retainedClients: expected.clients,
    applicationClock: obligations.checkedAt,
    checks: [
      "board application instant",
      "all waiting pages",
      "retained bank rows",
      "unchanged ledger",
    ],
  };

  if (seed.mode === "demo")
    result.checks.push("bank original and acknowledgment gate", "stored unknown without execution");

  if (seed.mode === "worst")
    result.checks.push("38-digit amount without clipping", "Unicode", "zero");

  if (seed.mode === "many") result.checks.push("browser pagination");

  await writeFile(join(artifacts, "demo-check.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
