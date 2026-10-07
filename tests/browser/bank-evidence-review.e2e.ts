import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Settlement from "../../packages/contracts/src/settlements";
import * as Candidates from "../../packages/contracts/src/bank-match-candidates";
import * as Schema from "effect/Schema";
import { bankReviewFixture } from "./bank-review-fixture";

test("bank review compares the retained original and prepares without allocating or posting", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const fixture = await bankReviewFixture(browser, app.baseUrl);

  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const discovery = browser.waitForResponse("**/bank-match-candidates");

  await app.open(fixture.path);

  const observedCandidates = Schema.decodeUnknownSync(Candidates.BankMatchCandidates)(
    await (await discovery).json(),
  );

  const review = screen.getByRole("dialog", "Granska matchning", { exact: true });

  await expect(review.getByRole("button", "Förbered matchning", { exact: true })).toHaveCount(0);

  const ambiguity = await app.screenshot("bank-review-ambiguous-unselected");

  const candidateIndex = observedCandidates.candidates.findIndex(
    (item) =>
      item.voucherId === fixture.candidate.voucherId && item.lineId === fixture.candidate.lineId,
  );

  const selectedVoucher = browser.waitForResponse(`**/vouchers/${fixture.candidate.voucherId}`);

  await review
    .getByRole("table", "Bokförda transaktioner", { exact: true })
    .getByRole("row")
    .nth(candidateIndex + 1)
    .getByRole("button", "Välj", { exact: true })
    .click();
  expect((await selectedVoucher).status).toBe(200);
  await expect(
    review.getByRole("img", "bank-review-original.pdf, sida 1", { exact: true }),
  ).toBeVisible();
  await expect(review.getByRole("button", "Förbered matchning", { exact: true })).toBeDisabled();
  await agent.assert(
    "The retained outgoing bank row, the original supplier document, the proposed allocation and explicit uncertainty can be compared on this review screen. No match has been applied.",
  );

  const initial = await app.screenshot("bank-review-original-pre-review");

  const reason = review.getByRole("textbox", "Varför hör transaktionerna ihop?", { exact: true });

  const acknowledgment = review.getByRole(
    "checkbox",
    "Jag har jämfört transaktionerna och kontrollerat underlaget.",
    { exact: true },
  );

  await reason.fill(
    "Leverantörsunderlaget avser kontorsmaterial för 1 250,00 SEK. Mottagare och belopp stämmer med bankraden.",
  );
  await acknowledgment.check();
  await expect(review.getByRole("button", "Förbered matchning", { exact: true })).toBeEnabled();

  const ready = await app.screenshot("bank-review-ready-to-prepare");

  const response = browser.waitForResponse("**/bank-allocation-plans");

  await review.getByRole("button", "Förbered matchning", { exact: true }).click();

  const result = await response;

  expect(result.status).toBe(200);

  const plan = Schema.decodeUnknownSync(Settlement.BankAllocationPlan)(await result.json());

  const view = await fixture.call(
    `/bank-allocation-plans/${plan.id}`,
    Settlement.BankAllocationView,
  );

  const refreshed = await fixture.call("/bank-match-candidates", Candidates.BankMatchCandidates, {
    statementId: fixture.statement.statement.id,
    rowOrdinal: 1,
  });

  expect(view.approval).toBeNull();
  expect(view.execution).toBeNull();
  expect(refreshed.source.remainingMinor).toBe("-125000");
  expect(await fixture.call("/ledger", Accounting.LedgerSnapshot)).toEqual(fixture.ledger);
  await expect(review.getByRole("button", "Granska planen", { exact: true })).toBeVisible();
  await expect(
    review.getByRole("img", "bank-review-original.pdf, sida 1", { exact: true }),
  ).toBeVisible();

  const prepared = await app.screenshot("bank-review-prepared-waiting-for-approval");

  await expect(review.getByRole("button", "Godkänn matchning", { exact: true })).toHaveCount(0);
  await review.getByRole("button", "Granska planen", { exact: true }).click();
  await expect(review.getByRole("button", "Godkänn matchning", { exact: true })).toBeVisible();

  await writeFile(
    join(output, "bank-review-preparation.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        originalHash: fixture.expectedHash,
        statement: fixture.statement,
        vouchers: fixture.vouchers,
        plan,
        view,
        refreshed,
        ledger: fixture.ledger,
        screenshots: [ambiguity, initial, ready, prepared],
      },
      null,
      2,
    ),
  );
});

test("bank review refuses an original that differs from its retained expected checksum", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const fixture = await bankReviewFixture(browser, app.baseUrl, true);

  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const discovery = browser.waitForResponse("**/bank-match-candidates");

  await app.open(fixture.path);

  const observedCandidates = Schema.decodeUnknownSync(Candidates.BankMatchCandidates)(
    await (await discovery).json(),
  );

  const review = screen.getByRole("dialog", "Granska matchning", { exact: true });

  const candidateIndex = observedCandidates.candidates.findIndex(
    (item) =>
      item.voucherId === fixture.candidate.voucherId && item.lineId === fixture.candidate.lineId,
  );

  const selectedVoucher = browser.waitForResponse(`**/vouchers/${fixture.candidate.voucherId}`);

  await review
    .getByRole("table", "Bokförda transaktioner", { exact: true })
    .getByRole("row")
    .nth(candidateIndex + 1)
    .getByRole("button", "Välj", { exact: true })
    .click();
  expect((await selectedVoucher).status).toBe(200);
  await expect(review.getByText("Originalet kan inte visas", { exact: true })).toBeVisible();
  await expect(
    review.getByText(`Sparad SHA-256 ${fixture.expectedHash}`, { exact: true }),
  ).toBeVisible();
  await expect(review.getByRole("img")).toHaveCount(0);
  await expect(review.getByRole("combobox", "Sida", { exact: true })).toHaveCount(0);
  await expect(review.getByRole("combobox", "Zoom", { exact: true })).toHaveCount(0);
  await expect(review.getByRole("button", "Ladda ned original", { exact: true })).toHaveCount(0);
  await expect(review.getByRole("button", "Förbered matchning", { exact: true })).toBeDisabled();
  const retried = browser.waitForResponse("**/source-occurrences/*");

  await review.getByRole("button", "Försök igen", { exact: true }).click();
  expect((await retried).status).toBe(200);
  await expect(review.getByText("Originalet kan inte visas", { exact: true })).toBeVisible();
  await agent.assert(
    "The original is explicitly refused and no substitute document is displayed. Preparing the match is blocked.",
    { vision: true },
  );

  const screenshot = await app.screenshot("bank-review-checksum-refusal-after-retry");

  expect(await fixture.call("/ledger", Accounting.LedgerSnapshot)).toEqual(fixture.ledger);
  await writeFile(
    join(output, "bank-review-checksum.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        expectedHash: fixture.expectedHash,
        retainedOccurrence: fixture.occurrence,
        evidence: fixture.evidence,
        ledger: fixture.ledger,
        screenshot,
      },
      null,
      2,
    ),
  );
});

test("bank review preserves its draft but clears acknowledgment when real capacity changes", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const fixture = await bankReviewFixture(browser, app.baseUrl);

  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const discovery = browser.waitForResponse("**/bank-match-candidates");

  await app.open(fixture.path);

  const observedCandidates = Schema.decodeUnknownSync(Candidates.BankMatchCandidates)(
    await (await discovery).json(),
  );

  const review = screen.getByRole("dialog", "Granska matchning", { exact: true });

  const candidateIndex = observedCandidates.candidates.findIndex(
    (item) =>
      item.voucherId === fixture.candidate.voucherId && item.lineId === fixture.candidate.lineId,
  );

  const selectedVoucher = browser.waitForResponse(`**/vouchers/${fixture.candidate.voucherId}`);

  await review
    .getByRole("table", "Bokförda transaktioner", { exact: true })
    .getByRole("row")
    .nth(candidateIndex + 1)
    .getByRole("button", "Välj", { exact: true })
    .click();
  expect((await selectedVoucher).status).toBe(200);
  await expect(
    review.getByRole("img", "bank-review-original.pdf, sida 1", { exact: true }),
  ).toBeVisible();

  const reason = "Reviewed original before another real partial allocation";

  const acknowledgment = review.getByRole(
    "checkbox",
    "Jag har jämfört transaktionerna och kontrollerat underlaget.",
    { exact: true },
  );

  await review
    .getByRole("textbox", "Varför hör transaktionerna ihop?", { exact: true })
    .fill(reason);
  await acknowledgment.check();

  const concurrent = await fixture.consume();

  const refreshed = browser.waitForResponse("**/bank-match-candidates");

  await browser.evaluate("() => window.dispatchEvent(new Event('visibilitychange'))");
  expect((await refreshed).status).toBe(200);
  await expect(review.getByRole("textbox", "Belopp att matcha, SEK", { exact: true })).toHaveValue(
    "-1250,00",
  );
  await expect(
    review.getByRole("textbox", "Varför hör transaktionerna ihop?", { exact: true }),
  ).toHaveValue(reason);
  await expect(acknowledgment).toBeChecked({ checked: false });
  await expect(review.getByRole("button", "Förbered matchning", { exact: true })).toBeDisabled();
  await agent.assert(
    "The remaining capacity is now 750 SEK, the old entered amount is refused, and the retained review needs acknowledgment again. Nothing has been prepared by this review.",
  );

  const screenshot = await app.screenshot("bank-review-real-capacity-changed-draft-retained");

  expect(await fixture.call("/ledger", Accounting.LedgerSnapshot)).toEqual(fixture.ledger);
  await writeFile(
    join(output, "bank-review-capacity.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        concurrent,
        ledger: fixture.ledger,
        lifecycleSignal:
          "A visibilitychange signal triggered a real public-owner refetch; no financial response was mocked",
        screenshot,
      },
      null,
      2,
    ),
  );
});
