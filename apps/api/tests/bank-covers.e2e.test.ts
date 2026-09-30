import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { createTestHarness } from "wrangler";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import * as Settlement from "@open-erp/contracts/settlements";
import {
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
  apiDirectory,
  run,
} from "./support/fixtures";

// Independent expectations: 70+30 = 60+40 = 100; neither explanation wins
// when all dates are equal. Discovery must not consume either capacity.
async function setup(amounts = ["70", "30", "60", "40"], rows = ["100"]) {
  const book = await fixture();
  const source = await evidence(book);

  for (const amount of amounts) {
    const plan = await post(book, "/change-sets", journal(source.id, amount), Accounting.ChangeSet);
    await execute(book, plan);
  }

  const content = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: rows.reduce((sum, amount) => sum + BigInt(amount), 0n).toString(),
    completeness: { declaredComplete: false, basis: "NEXT-97 synthetic rows" },
    rows: rows.map((amountMinor, index) => ({
      rowOrdinal: index + 1,
      providerId: null,
      date: "2026-09-22",
      description: `Grouped receipt ${index + 1}`,
      amountMinor,
    })),
  };

  const original = await post(
    book,
    "/evidence",
    {
      title: "Synthetic grouped statement",
      mediaType: "application/json",
      content: JSON.stringify(content),
      origin: "NEXT-97 E2E",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    { ...content, evidenceId: original.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  return { book, statementId: imported.statement.id };
}

test("NEXT-97 preserves exact alternatives, budgets and cross-observation conflicts", async () => {
  const { book, statementId } = await setup(undefined, ["100", "100"]);
  const before = await persisted(book);

  const discovery = await post(
    book,
    "/bank-match-candidates",
    { statementId, rowOrdinal: 1 },
    Candidates.BankMatchCandidates,
  );

  expect(discovery.coverSearch.status).toBe("ambiguous");
  expect(discovery.coverSearch.covers).toHaveLength(2);
  expect(
    discovery.coverSearch.covers
      .map((cover) =>
        cover.legs
          .map((leg) => leg.amountMinor)
          .sort((left, right) =>
            BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
          ),
      )
      .sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")),
  ).toEqual([
    ["30", "70"],
    ["40", "60"],
  ]);
  expect(
    discovery.coverSearch.covers.every(
      (cover) => cover.totalMinor === "100" && cover.leftoverMinor === "0",
    ),
  ).toBe(true);
  expect(discovery.coverConflicts.completeWithinStatement).toBe(true);
  expect(discovery.coverConflicts.conflicts).toHaveLength(2);
  expect(discovery.coverConflicts.conflicts.every((conflict) => conflict.rowOrdinal === 2)).toBe(
    true,
  );
  expect(await persisted(book)).toEqual(before);

  const bounded = await post(
    book,
    "/bank-match-candidates",
    {
      statementId,
      rowOrdinal: 1,
      coverLimits: { maxCandidates: 40, maxSetSize: 4, maxVisited: 6 },
    },
    Candidates.BankMatchCandidates,
  );

  expect(bounded.coverSearch.status).toBe("incomplete_search");
  expect(bounded.coverSearch.limitReasons).toContain("visit_budget");

  const capped = await post(
    book,
    "/bank-match-candidates",
    {
      statementId,
      rowOrdinal: 1,
      coverLimits: { maxCandidates: 2, maxSetSize: 4, maxVisited: 10000 },
    },
    Candidates.BankMatchCandidates,
  );

  expect(capped.coverSearch.status).toBe("incomplete_search");
  expect(capped.coverSearch.populationCount).toBe(4);
  expect(capped.coverSearch.limitReasons).toContain("candidate_limit");

  const agent = await decoded(
    await request({ ...book, token: book.agentToken }, "/bank-match-candidates", {
      method: "POST",
      body: JSON.stringify({ statementId, rowOrdinal: 1 }),
    }),
    Candidates.BankMatchCandidates,
  );

  expect(agent.coverSearch).toEqual(discovery.coverSearch);
  await writeFile(
    join(environment().artifacts, "next-97-cover-discovery.json"),
    JSON.stringify(
      {
        independentExpectation: "70+30=60+40=100; equal dates retain both covers",
        discovery,
        bounded,
        capped,
        noWrites: true,
      },
      null,
      2,
    ),
  );
});

test("NEXT-97 selected covers use reviewed allocation, same-key recovery and stale competing-consumer refusal", async () => {
  const { book, statementId } = await setup(undefined, ["100", "100"]);

  const found = await post(
    book,
    "/bank-match-candidates",
    { statementId, rowOrdinal: 1 },
    Candidates.BankMatchCandidates,
  );

  expect(found.coverSearch.status).toBe("ambiguous");

  const cover = found.coverSearch.covers.find((candidate) =>
    candidate.legs.some((leg) => leg.amountMinor === "70"),
  );

  if (!cover) throw new Error("An exact 70+30 cover is required.");

  const input = {
    accountId: "account_bank",
    reason: "Independently reviewed 70+30 grouped receipt",
    ambiguityAcknowledged: true,
    legs: cover.legs.map((leg) => ({ ...leg, statementId, rowOrdinal: 1 })),
  };

  const first = await post(book, "/bank-allocation-plans", input, Settlement.BankAllocationPlan);

  const second = await post(
    book,
    "/bank-allocation-plans",
    { ...input, legs: input.legs.map((leg) => ({ ...leg, rowOrdinal: 2 })) },
    Settlement.BankAllocationPlan,
  );

  const approval = await post(
    book,
    `/bank-allocation-plans/${first.id}/approve`,
    { digest: first.digest, version: first.version },
    Settlement.BankAllocationApproval,
  );

  const competingApproval = await post(
    book,
    `/bank-allocation-plans/${second.id}/approve`,
    { digest: second.digest, version: second.version },
    Settlement.BankAllocationApproval,
  );

  const executeKey = key();

  const body = JSON.stringify({
    digest: first.digest,
    version: first.version,
    approvalId: approval.id,
  });

  const receipt = await decoded(
    await request(book, `/bank-allocation-plans/${first.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executeKey },
      body,
    }),
    Settlement.BankAllocationExecution,
  );

  const replayed = await decoded(
    await request(book, `/bank-allocation-plans/${first.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": executeKey },
      body,
    }),
    Settlement.BankAllocationExecution,
  );

  expect(replayed).toEqual(receipt);
  await failure(
    await request(book, `/bank-allocation-plans/${second.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        digest: second.digest,
        version: second.version,
        approvalId: competingApproval.id,
      }),
    }),
    409,
    "StaleDependency",
  );

  const after = await post(
    book,
    "/bank-match-candidates",
    { statementId, rowOrdinal: 2 },
    Candidates.BankMatchCandidates,
  );

  expect(after.coverSearch.status).toBe("unique_within_declared_pool");
  const remainingCover = after.coverSearch.covers[0];

  if (!remainingCover) throw new Error("The disjoint unused cover must remain available.");

  const recovered = await post(
    book,
    "/bank-allocation-plans",
    { ...input, legs: remainingCover.legs.map((leg) => ({ ...leg, statementId, rowOrdinal: 2 })) },
    Settlement.BankAllocationPlan,
  );

  const recoveredApproval = await post(
    book,
    `/bank-allocation-plans/${recovered.id}/approve`,
    { digest: recovered.digest, version: recovered.version },
    Settlement.BankAllocationApproval,
  );

  const recoveredKey = key();

  const recoveredBody = JSON.stringify({
    digest: recovered.digest,
    version: recovered.version,
    approvalId: recoveredApproval.id,
  });

  const secondReceipt = await decoded(
    await request(book, `/bank-allocation-plans/${recovered.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": recoveredKey },
      body: recoveredBody,
    }),
    Settlement.BankAllocationExecution,
  );

  expect(
    await decoded(
      await request(book, `/bank-allocation-plans/${recovered.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": recoveredKey },
        body: recoveredBody,
      }),
      Settlement.BankAllocationExecution,
    ),
  ).toEqual(secondReceipt);

  const used = await post(
    book,
    "/bank-match-candidates",
    { statementId, rowOrdinal: 1 },
    Candidates.BankMatchCandidates,
  );

  expect(used.coverSearch.status).toBe("unavailable");
  await writeFile(
    join(environment().artifacts, "next-97-cover-allocation.json"),
    JSON.stringify(
      { found, first, second, receipt, replayed, after, recovered, secondReceipt, used },
      null,
      2,
    ),
  );
});

test("NEXT-97 exposes no-match and statement conflict limits without claiming global uniqueness", async () => {
  const { book, statementId } = await setup(
    ["70", "30"],
    ["101", ...Array.from({ length: 11 }, () => "100")],
  );

  const noMatch = await post(
    book,
    "/bank-match-candidates",
    { statementId, rowOrdinal: 1 },
    Candidates.BankMatchCandidates,
  );

  expect(noMatch.coverSearch.status).toBe("no_match_within_declared_pool");
  expect(noMatch.coverSearch.covers).toEqual([]);

  const unique = await post(
    book,
    "/bank-match-candidates",
    { statementId, rowOrdinal: 2 },
    Candidates.BankMatchCandidates,
  );

  expect(unique.coverSearch.status).toBe("unique_within_declared_pool");
  expect(unique.coverConflicts.completeWithinStatement).toBe(false);
  expect(unique.coverConflicts.populationCount).toBe(11);
  expect(unique.coverConflicts.searchedCount).toBe(10);

  const invalid = await request(book, "/bank-match-candidates", {
    method: "POST",
    body: JSON.stringify({
      statementId,
      rowOrdinal: 2,
      coverLimits: { maxCandidates: 41, maxSetSize: 4, maxVisited: 10000 },
    }),
  });

  expect(invalid.status).toBe(400);
});

test("NEXT-97 operator reviews a discovered group and confirms it through the real browser", async () => {
  const { book, statementId } = await setup();
  const email = `${book.actorId}@e2e.invalid`;
  const password = randomBytes(24).toString("hex");
  await run("bun", ["scripts/create-user.ts", book.actorId], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: environment().adminUrl,
      OPENERP_EMAIL: email,
      OPENERP_PASSWORD: password,
    },
  });
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No browser port allocated");
  const port = address.port;
  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  const url = `http://127.0.0.1:${port}`;

  const worker = createTestHarness({
    root: apiDirectory,
    workers: [
      {
        configPath: "wrangler.jsonc",
        secrets: {
          DATABASE_URL: environment().runtimeUrl,
          BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
          BETTER_AUTH_URL: url,
        },
      },
    ],
  });

  const listening = await worker.listen();

  const web = spawn(
    "bun",
    [
      "run",
      "dev",
      "--config",
      "tests/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: resolve(apiDirectory, "../web"),
      env: { ...process.env, OPENERP_E2E_API_URL: listening.url.origin },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );

  let webLog = "";
  web.stdout.on("data", (chunk: Buffer) => {
    webLog += chunk.toString();
  });
  web.stderr.on("data", (chunk: Buffer) => {
    webLog += chunk.toString();
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    browser = await chromium.launch();

    await expect
      .poll(
        async () => {
          if (web.exitCode !== null) throw new Error(webLog);

          return fetch(url).then(
            (response) => response.ok,
            () => false,
          );
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/companies`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Synthetic E2E book", { exact: true }).first().waitFor();
    await page.goto(
      `${url}/entities/${book.entityId}/books/${book.bookId}/accounts?account=account_bank&statement=${statementId}&row=1`,
    );
    await page.getByText("Several equally ranked exact combinations", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Review combination 2", exact: true }).waitFor();
    await page.screenshot({ path: join(environment().artifacts, "next-97-covers-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: join(environment().artifacts, "next-97-covers-narrow.png") });
    const choose = page.getByRole("button", { name: "Review combination 1", exact: true });
    await choose.focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Why do these transactions belong together?", { exact: true })
      .fill("Independent synthetic grouped-payment review");
    await page
      .getByLabel("I have compared the transactions and checked the evidence.", { exact: true })
      .check();
    await page.getByRole("button", { name: "Prepare match", exact: true }).click();
    await page
      .getByLabel("I have reviewed the amounts and statement evidence.", { exact: true })
      .check();
    await page.getByRole("button", { name: "Approve match", exact: true }).click();
    await page.getByRole("button", { name: "Confirm match", exact: true }).click();
    await page
      .getByText(
        "The match is saved. Account transactions and remaining balances have been updated.",
        { exact: true },
      )
      .waitFor();
    await page.screenshot({ path: join(environment().artifacts, "next-97-cover-saved.png") });
    expect(errors).toEqual([]);

    const after = await post(
      book,
      "/bank-match-candidates",
      { statementId, rowOrdinal: 1 },
      Candidates.BankMatchCandidates,
    );

    expect(after.source.remainingMinor).toBe("0");
    expect(after.coverSearch.status).toBe("unavailable");
    await writeFile(
      join(environment().artifacts, "next-97-browser.json"),
      JSON.stringify(
        {
          keyboardSelected: true,
          narrowWidth: 390,
          remainingMinor: after.source.remainingMinor,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    await writeFile(join(environment().artifacts, "next-97-web.log"), webLog);

    if (web.pid && web.exitCode === null) {
      const exited = once(web, "exit");
      process.kill(-web.pid, "SIGTERM");
      await exited;
    }

    await worker.close();
  }
}, 120000);
