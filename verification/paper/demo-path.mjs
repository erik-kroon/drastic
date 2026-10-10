import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const { chromium } = createRequire(import.meta.resolve("e2e"))("playwright");

const artifacts = process.env.PAPER_ARTIFACTS ?? "test-results/paper";

const runtime = JSON.parse(await readFile(join(artifacts, "runtime.json"), "utf8"));

const session = JSON.parse(await readFile(runtime.sessionFile, "utf8"));

assert.equal(session.demoMode, "demo", "Run on the disposable demo book");

assert.equal(new URL(session.url).hostname, "127.0.0.1");

const seed = JSON.parse(await readFile(join(artifacts, "demo-seed.json"), "utf8"));

const browser = await chromium.launch({ headless: true });

try {
  const stateFile = join(dirname(runtime.sessionFile), "browser-state.json");
  const retainedSession = existsSync(stateFile);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "sv-SE",
    storageState: retainedSession ? stateFile : undefined,
  });

  if (!retainedSession) {
    const login = await context.request.post(`${session.url}/api/auth/sign-in/email`, {
      headers: { origin: session.url },
      data: { email: session.email, password: session.password },
    });

    assert.equal(login.ok(), true, "Synthetic browser sign-in");
    await writeFile(stateFile, JSON.stringify(await context.storageState()), { mode: 0o600 });
  }

  const page = await context.newPage();

  const read = async (path) => {
    const response = await context.request.get(
      `${session.workspace.replace(session.url, "")}${path}`.replace(/^/, `${session.url}/api/v1`),
    );

    assert.equal(response.ok(), true, `Read ${path}`);

    return response.json();
  };

  await page.goto(`${session.url}${session.boards["K-10"].route}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Granska förslag", exact: true }).click();
  await page.getByRole("button", { name: "Sidtext", exact: true }).click();
  const text = page.locator("pre").first();
  await text.waitFor();
  const originalText = (await text.innerText()).replace(/\s+/g, " ");

  for (const expected of ["Nordhamn Studio AB", "1048", "10 000,00", "2 500,00", "12 500,00 SEK"])
    assert.ok(originalText.includes(expected), `Original contains ${expected}`);
  await page.getByRole("button", { name: "Sidtext", exact: true }).first().click();

  const geometry = await page.locator("canvas[role=img]").evaluate((canvas) => ({
    page: canvas.getBoundingClientRect().height,
    viewport: canvas.parentElement.parentElement.clientHeight,
    width: canvas.getBoundingClientRect().width,
    available: canvas.parentElement.parentElement.clientWidth,
  }));

  assert.ok(
    geometry.viewport >= geometry.page,
    "Original totals are visible without a cropped page",
  );
  assert.ok(
    geometry.available >= Math.round(geometry.width),
    `Original is not horizontally cropped: ${JSON.stringify(geometry)}`,
  );

  if (!process.argv.includes("--inspect-only")) {
    const before = await read("/ledger");
    const approval = page.getByRole("button", { name: "Attestera bokföring", exact: true });
    await approval.locator("xpath=ancestor::form").getByRole("checkbox").check();
    await approval.click();
    const execute = page.getByRole("button", { name: "Bokför och registrera", exact: true });
    await execute.waitFor();
    assert.deepEqual(await read("/ledger"), before, "Approval alone does not post");
    await execute.locator("xpath=ancestor::form").getByRole("checkbox").check();
    await execute.click();
    await page.getByRole("link", { name: "Visa verifikation", exact: true }).waitFor();
    const view = await read(`/commerce/supplier-acceptance-reviews/${seed.reviews[0].reviewId}`);
    assert.ok(view.acceptance, "Stored execution receipt");
    const vouchers = await read("/vouchers");
    const after = await read("/ledger");

    const retained = vouchers.items.filter(
      (item) => item.id === view.acceptance.postingReceipt.voucherId,
    );

    assert.equal(retained.length, 1, "Exactly one retained voucher");

    const totals = retained[0].action.lines.reduce(
      (sum, line) => ({
        debit: sum.debit + BigInt(line.debitMinor),
        credit: sum.credit + BigInt(line.creditMinor),
      }),
      { debit: 0n, credit: 0n },
    );

    assert.deepEqual(totals, { debit: 1250000n, credit: 1250000n });
    await page.getByRole("link", { name: "Visa verifikation", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await page.reload({ waitUntil: "networkidle" });
    const dialog = page.getByRole("dialog", { name: "Verifikat", exact: true });
    const summary = dialog.getByRole("table").first();
    await summary.getByText("Summa", { exact: true }).waitFor();
    const summarized = await summary.getByRole("row").all();

    const cells = await Promise.all(
      summarized
        .slice(1)
        .map(async (row) =>
          (await row.getByRole("cell").allTextContents()).map((value) => value.replace(/\s/g, " ")),
        ),
    );

    assert.deepEqual(
      cells,
      [
        ["6550 Konsultarvoden", "10 000,00", ""],
        ["2641 Debiterad ingående moms", "2 500,00", ""],
        ["2440 Leverantörsskulder", "", "12 500,00"],
        ["Summa", "12 500,00", "12 500,00"],
      ],
      "Posted account totals retain separate sides and empty cells",
    );

    const accountFit = await summary.evaluate((element) => {
      const panel = element.closest('[role="dialog"]').getBoundingClientRect();
      const table = element.getBoundingClientRect();

      return table.left > panel.left && table.right < panel.right;
    });

    assert.ok(accountFit, "Posted account table stays inside the record panel gutters");
    await dialog.getByRole("button", { name: "Bokförda rader", exact: true }).click();
    assert.equal(await dialog.getByRole("table").nth(1).getByRole("row").count(), 8);
    await dialog.getByRole("button", { name: "Bokförda rader", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Verifikat", exact: true })
      .getByRole("button", { name: "Underlag 1", exact: true })
      .click();
    await page
      .getByText("1048_nordhamn.pdf", { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    const source = await read(`/source-occurrences/${seed.reviews[0].occurrenceId}`);
    assert.equal(
      `sha256:${createHash("sha256").update(Buffer.from(source.contentBase64, "base64")).digest("hex")}`,
      source.occurrence.sha256,
      "Retained original bytes match their checksum after posting and reload",
    );
    const route = new URL(page.url());
    const originalCanvas = dialog.locator("canvas[role=img]");
    await originalCanvas.waitFor({ state: "visible" });

    const originalSize = await originalCanvas.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      available: element.parentElement.parentElement.clientWidth,
    }));

    assert.ok(
      originalSize.width <= originalSize.available + 1,
      "Posted original fits record panel",
    );
    await page.keyboard.press("Escape");
    await page.waitForURL(`${session.workspace}/purchases?**`);
    assert.equal(new URL(page.url()).searchParams.get("record"), seed.reviews[0].draftId);
    assert.deepEqual(
      await read("/ledger"),
      after,
      "Inspection and close never change posted history",
    );
    session.boards["K-16"] = {
      route: `${route.pathname}${route.search}`,
      state: "posted voucher selected",
      buttonClicks: ["Underlag 1"],
    };
    runtime.boards = session.boards;
    await writeFile(runtime.sessionFile, JSON.stringify(session), { mode: 0o600 });
    await writeFile(join(artifacts, "runtime.json"), JSON.stringify(runtime), { mode: 0o600 });
    await mkdir(join(artifacts, "demo-path"), { recursive: true });
    await writeFile(
      join(artifacts, "demo-path/result.json"),
      JSON.stringify(
        {
          synthetic: true,
          passed: true,
          route: session.boards["K-16"].route,
          checks: [
            "original independently checked",
            "uncropped original",
            "approval without posting",
            "one voucher",
            "balanced 1250000 minor units",
            "original retained after reload",
            "separate account-side totals and empty cells",
            "account table inside record panel gutters",
            "all seven posted lines remain available",
            "posted original fits record panel",
            "Escape returns to supplier owner without ledger writes",
          ],
          geometry,
        },
        null,
        2,
      ),
    );
  }

  console.log("Demo path checks passed");
} finally {
  await browser.close();
}
