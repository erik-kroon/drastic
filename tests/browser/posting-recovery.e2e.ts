import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Recovery from "../../packages/contracts/src/posting-recovery";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("saved posting survives a lost execution response and reload with one durable receipt", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const call = async (path: string, body?: unknown, key = crypto.randomUUID()) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, origin, "content-type": "application/json", "idempotency-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    expect(response.status).toBe(200);

    return response.json();
  };

  const before = Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await call("/ledger"));
  const setup = Schema.decodeUnknownSync(Accounting.BookSetup)(await call("/setup"));
  const evidenceKey = crypto.randomUUID();

  const evidenceSaved = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(
    await call(
      "/saved-posting-requests",
      {
        operation: "create_evidence",
        input: {
          title: "Syntetiskt återupptaget underlag",
          content: "Synthetic 125.00 SEK transfer. No company data or provider action.",
          origin: "Synthetic browser recovery",
          mediaType: "text/plain",
        },
      },
      evidenceKey,
    ),
  );

  expect(evidenceSaved.outcome).toBeNull();

  const evidenceResult = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(
    await call(`/saved-posting-requests/${evidenceKey}/run`, {}),
  );

  if (evidenceResult.outcome?.state !== "committed") throw new Error("Evidence did not commit");

  const evidence = Schema.decodeUnknownSync(Accounting.Evidence)(evidenceResult.outcome.result);
  const prepareKey = crypto.randomUUID();

  const saved = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(
    await call(
      "/saved-posting-requests",
      {
        operation: "prepare_journal",
        input: {
          kind: "manual_journal",
          evidenceId: evidence.id,
          eventKey: `recovery_${crypto.randomUUID()}`,
          accountingPeriodId: "period_synthetic_2026",
          postingDate: setup.today,
          series: "A",
          description: "Syntetisk återupptagen kontering",
          rationale: "Verify interrupted response recovery without duplicate posting",
          taxAssessment: "not_applicable",
          lines: [
            {
              accountId: "account_bank",
              debitMinor: "12500",
              creditMinor: "0",
              description: "Bank debit",
            },
            {
              accountId: "account_clearing",
              debitMinor: "0",
              creditMinor: "12500",
              description: "Clearing credit",
            },
          ],
        },
      },
      prepareKey,
    ),
  );

  expect(saved.outcome).toBeNull();
  await app.open(`${workspace}/work?kind=journal&status=all`);
  await screen.getByRole("button", "Återställ en begäran", { exact: true }).click();
  await expect(screen.getByRole("heading", "Återuppta sparat arbete")).toBeVisible();
  await expect(screen.getByRole("button", "Granska sparad begäran").first()).toBeVisible();
  await agent.assert(
    "The saved-work recovery section is open and offers Granska sparad begäran for a retained request. Its unknown-outcome message does not claim failure or posting. Return the configured JSON judgment.",
  );
  await expect(screen.getByRole("heading", "Återuppta sparat arbete")).toBeVisible();
  await screen.getByRole("button", "Granska sparad begäran").first().click();
  await expect(screen.getByRole("heading", "Exakt sparat kommando")).toBeVisible();
  await expect(screen.getByRole("button", "Kör denna sparade begäran")).toBeDisabled();
  expect(Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await call("/ledger"))).toEqual(
    before,
  );
  await browser.evaluate("() => localStorage.clear()");
  await browser.reload();
  await screen.getByText("Återställ en begäran", { exact: true }).click();
  await screen.getByRole("button", "Granska sparad begäran").first().click();
  await screen
    .getByRole(
      "checkbox",
      "Jag har granskat det exakta sparade kommandot. Kör det oförändrat med min nuvarande behörighet.",
    )
    .check();
  await screen.getByRole("button", "Kör denna sparade begäran").click();
  await expect(screen.getByRole("button", "Granska förslag").first()).toBeVisible();

  const prepared = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(
    await call(`/saved-posting-requests/${prepareKey}`),
  );

  if (prepared.outcome?.state !== "committed") throw new Error("Preparation did not commit");

  const plan = Schema.decodeUnknownSync(Accounting.ChangeSet)(prepared.outcome.result);

  expect(prepared.request.commandKey).toBe(saved.request.commandKey);
  await screen.getByRole("button", "Granska förslag").first().click();
  await expect(browser).toHaveURL(new RegExp(`/reviews/${plan.id}/`));
  await expect(
    screen.getByText("Syntetisk återupptagen kontering", { exact: true }).last(),
  ).toBeVisible();
  await screen
    .getByRole("checkbox", "Jag har granskat detta exakta förslag och dess underlag.")
    .check();
  await screen.getByRole("button", "Godkänn förslag").click();
  await expect(screen.getByRole("button", "Bokför posten")).toBeVisible();

  let committed: typeof Recovery.SavedPostingRequest.Type | undefined;

  const runPattern = `${base}/saved-posting-requests/*/run`;

  await browser.route(runPattern, async (route) => {
    const response = await fetch(route.request.url, {
      method: route.request.method,
      headers: { ...route.request.headers, cookie, origin },
      body: route.request.postData ?? undefined,
      signal: AbortSignal.timeout(20_000),
    });

    expect(response.status).toBe(200);
    committed = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(await response.json());
    await route.abort();
  });
  await screen
    .getByRole("checkbox", "Jag har granskat detta exakta förslag och dess underlag.")
    .check();
  await screen.getByRole("button", "Bokför posten").click();
  await expect.poll(() => committed?.outcome?.state).toBe("committed");
  await browser.unroute(runPattern);

  if (committed?.outcome?.state !== "committed") throw new Error("Execution did not commit");

  const receipt = Schema.decodeUnknownSync(Accounting.ExecutionReceipt)(committed.outcome.result);

  await browser.evaluate("() => localStorage.clear()");
  await browser.reload();
  await expect(
    screen.getByRole("heading", new RegExp(`Bokfört.*Verifikation ${receipt.voucherNumber}`)),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Bokför posten")).toHaveCount(0);
  await app.screenshot("posting-receipt-after-lost-response-and-reload");
  await app.open(`${workspace}/work?kind=journal&status=all`);
  await screen.getByRole("button", "Återställ en begäran", { exact: true }).click();
  await expect(screen.getByRole("heading", "Återuppta sparat arbete")).toBeVisible();
  await screen.getByRole("button", "Granska sparad begäran").first().click();
  await expect(screen.getByRole("heading", "Exakt sparat kommando")).toBeVisible();
  await expect(screen.getByRole("button", "Kör denna sparade begäran")).toHaveCount(0);

  const recovered = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(
    await call(`/saved-posting-requests/${committed.request.key}`),
  );

  const replayed = Schema.decodeUnknownSync(Recovery.SavedPostingRequest)(
    await call(`/saved-posting-requests/${committed.request.key}/run`, {}),
  );

  const after = Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await call("/ledger"));

  expect(recovered.outcome).toEqual(committed.outcome);
  expect(replayed.outcome).toEqual(committed.outcome);
  expect(BigInt(after.sequence) - BigInt(before.sequence)).toBe(1n);
  expect(after.accounts.find((entry) => entry.accountId === "account_bank")?.balanceMinor).toBe(
    (
      BigInt(
        before.accounts.find((entry) => entry.accountId === "account_bank")?.balanceMinor ?? "0",
      ) + 12500n
    ).toString(),
  );
  await app.screenshot("posting-original-saved-receipt-discovered-from-daily-work");
  await screen.getByRole("button", "Granska sparad begäran").last().click();
  await screen.getByRole("button", "Använd detta sparade underlag").click();
  await expect(browser).toHaveURL(new RegExp(`savedRequest=${evidenceKey}`));
  await expect(screen.getByText(evidence.title, { exact: true }).first()).toBeVisible();
  await browser.evaluate("() => localStorage.clear()");
  await browser.reload();
  await expect(screen.getByText(evidence.title, { exact: true }).first()).toBeVisible();
  expect(Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await call("/ledger"))).toEqual(after);
  await app.screenshot("posting-retained-evidence-reopened-after-reload");
  await screen.getByRole("button", "Postens referens", { exact: true }).click();
  await screen.getByRole("textbox", "Beskrivning", { exact: true }).fill("Behåll denna kontering");

  const retainedEventKey = await browser.evaluate(
    "() => document.querySelector('input[name=eventKey]').value",
  );

  if (typeof retainedEventKey !== "string") throw new Error("Missing retained event identity");

  let interruptedRead = false;
  const evidencePath = `${base}/saved-posting-requests/${evidenceKey}`;
  await browser.route(evidencePath, async (route) => {
    await fetch(route.request.url, {
      headers: { ...route.request.headers, cookie, origin },
      signal: AbortSignal.timeout(20_000),
    });
    interruptedRead = true;
    await route.abort();
  });
  await screen.getByRole("button", "Återuppta sparat arbete", { exact: true }).click();
  await screen.getByRole("button", "Granska sparad begäran").last().click();
  await screen.getByRole("button", "Kontrollera aktuellt läge", { exact: true }).last().click();
  await expect.poll(() => interruptedRead).toBe(true);
  await expect(screen.getByRole("button", "Granska kontering", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("textbox", "Beskrivning", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("textbox", "Beskrivning", { exact: true })).toHaveValue(
    "Behåll denna kontering",
  );
  await expect(
    screen.getByRole("textbox", "Unik referens för posten", { exact: true }),
  ).toHaveValue(retainedEventKey);
  await browser.unroute(evidencePath);
  await screen.getByRole("button", "Kontrollera aktuellt läge", { exact: true }).first().click();
  await expect(screen.getByRole("textbox", "Beskrivning", { exact: true })).toBeEnabled();
  await expect(screen.getByRole("textbox", "Beskrivning", { exact: true })).toHaveValue(
    "Behåll denna kontering",
  );
  await expect(
    screen.getByRole("textbox", "Unik referens för posten", { exact: true }),
  ).toHaveValue(retainedEventKey);
  await app.screenshot("posting-resumed-draft-preserved-after-read-interruption");
  await writeFile(
    join(process.env.OPENERP_E2E_OUTPUT!, "posting-recovery-journey.json"),
    JSON.stringify(
      { prepareKey, saved, prepared, committed, recovered, replayed, before, after },
      null,
      2,
    ),
  );
});
