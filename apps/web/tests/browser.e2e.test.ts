import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { chromium } from "playwright";
import { expect, test } from "vitest";
import {
  emptyPosting,
  environment,
  fixture,
  ledger,
  onePosting,
  persisted,
  saveEvidence,
} from "../../api/tests/support/fixtures";

async function browserServer() {
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", done);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No browser server port allocated");
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  const url = `http://127.0.0.1:${address.port}`;
  const log = createWriteStream(join(environment().artifacts, "browser-server.log"));
  const child = spawn(
    "bun",
    [
      "run",
      "dev",
      "--config",
      "tests/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      detached: true,
      env: { ...process.env, OPENERP_E2E_API_URL: environment().baseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  async function close() {
    if (child.pid && child.exitCode === null) {
      const exited = new Promise<void>((done) => child.once("exit", () => done()));
      process.kill(-child.pid, "SIGTERM");
      await exited;
    }
    await new Promise<void>((done) => log.end(done));
  }
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error("Browser server exited; see browser-server.log");
      const ready = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
        (response) => response.ok,
        () => false,
      );
      if (ready) return { url, close };
      await setTimeout(100);
    }
    throw new Error("Browser server did not become ready; see browser-server.log");
  } catch (error) {
    await close();
    throw error;
  }
}

test("operator signs in, retains evidence, reviews, posts once and recovers after reload", async () => {
  const book = await fixture();
  const app = await browserServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    await page.goto(app.url);
    await page.getByLabel("Access token", { exact: true }).fill(book.token);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Book", { exact: true }).selectOption(book.bookId);
    await page.getByLabel("Evidence title", { exact: true }).fill("Browser synthetic transfer");
    await page.getByLabel("Source / origin", { exact: true }).fill("Vitest browser fixture");
    await page
      .getByLabel("Source text", { exact: true })
      .fill("Återföring: räksmörgås — synthetic 125,00 SEK.");
    // Capture after login so the trace does not retain the access-token input.
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await page.getByRole("button", { name: "Retain evidence", exact: true }).click();
    await page.getByLabel("Unique event key", { exact: true }).fill("browser_transfer");
    await page.getByLabel("Posting date", { exact: true }).fill("2026-09-22");
    await page.getByLabel("Description", { exact: true }).first().fill("Synthetic transfer");
    await page
      .getByLabel("Rationale", { exact: true })
      .first()
      .fill("Verify browser through database");
    const firstLine = page.getByRole("group", { name: "Journal line 1", exact: true });
    const secondLine = page.getByRole("group", { name: "Journal line 2", exact: true });
    await firstLine.getByLabel("Account", { exact: true }).selectOption("account_bank");
    await firstLine.getByLabel("Debit (minor units)", { exact: true }).fill("12500");
    await firstLine.getByLabel("Description", { exact: true }).fill("Bank debit");
    await secondLine.getByLabel("Account", { exact: true }).selectOption("account_clearing");
    await secondLine.getByLabel("Credit (minor units)", { exact: true }).fill("12500");
    await secondLine.getByLabel("Description", { exact: true }).fill("Clearing credit");
    await page.getByRole("button", { name: "Prepare sealed plan", exact: true }).click();
    await page.getByRole("button", { name: "Validate current dependencies", exact: true }).click();
    await page.getByText("Dependencies validated", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Approve this exact plan", exact: true }).click();
    await page
      .getByText("Exact plan approved. It has not been posted yet.", { exact: true })
      .waitFor();
    expect(await persisted(book)).toEqual(emptyPosting);
    await page.screenshot({
      path: join(environment().artifacts, "browser-approved.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Execute approved plan", exact: true }).click();
    await page.getByText("Posting committed", { exact: true }).waitFor();
    expect(await persisted(book)).toEqual(onePosting);
    expect((await ledger(book)).accounts.map((account) => account.balanceMinor)).toEqual([
      "12500",
      "-12500",
    ]);
    await page.reload();
    await page.getByLabel("Book", { exact: true }).selectOption(book.bookId);
    await page.getByRole("heading", { name: "Posted vouchers", exact: true }).waitFor();
    await expect
      .poll(async () => page.getByRole("table").filter({ hasText: "Synthetic transfer" }).count())
      .toBeGreaterThan(0);
    expect(await persisted(book)).toEqual(onePosting);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(environment().artifacts, "browser-posted-mobile.png"),
      fullPage: true,
    });
    expect(browserErrors).toEqual([]);
    await saveEvidence("browser-posting", book);
  } finally {
    await page.screenshot({
      path: join(environment().artifacts, "browser-final.png"),
      fullPage: true,
    });
    await writeFile(
      join(environment().artifacts, "browser-errors.json"),
      JSON.stringify(browserErrors),
    );
    await context.tracing.stop({ path: join(environment().artifacts, "browser-trace.zip") });
    await browser.close();
    await app.close();
  }
}, 120_000);
