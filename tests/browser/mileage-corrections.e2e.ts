import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({ proposalId: Schema.String });

test("R41 submits a retained paid mileage correction without posting", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const output = process.env.OPENERP_E2E_OUTPUT ?? "";

  const fixture = Schema.decodeSync(Schema.fromJsonString(Fixture))(
    await readFile(join(output, "runtime/mileage-fixture.json"), "utf8"),
  );

  const path = `${new URL(workspace).pathname}/tax?view=mileage`;

  await app.open(path);
  await expect(screen.getByText("MIL-2026-0012, Anders Berg", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await screen.getByText("MIL-2026-0012, Anders Berg", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Milersättning rättas efter lönekörning", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(screen.getByText("Förslag, ej godkänt", { exact: true })).toBeVisible();
  await expect(screen.getByText("−22 km", { exact: true })).toBeVisible();
  await expect(screen.getByText("−66,00", { exact: true })).toBeVisible();
  await expect(screen.getByText("−55,00", { exact: true })).toBeVisible();
  await expect(screen.getByText("−11,00", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("heading", "VERIFIKATFÖRSLAG, RÄTTELSE AV MIL-2026-0012", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("button", "Skicka för godkännande", { exact: true })).toBeEnabled();
  await app.screenshot("R41-paid-mileage-correction-before-submission");
  await screen.getByRole("link", "Ruttkontroll 3 okt.pdf, 150 km", { exact: true }).click();
  await expect(screen.getByRole("link", "Tillbaka till rättelsen", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("img", "Ruttkontroll 3 okt.pdf, sida 1", { exact: true }),
  ).toBeVisible();
  await app.screenshot("R41-retained-corrected-route-original");
  await screen.getByRole("link", "Tillbaka till rättelsen", { exact: true }).click();
  await expect(screen.getByRole("button", "Skicka för godkännande", { exact: true })).toBeEnabled();
  await agent.act(
    "Click Skicka för godkännande once and wait for Väntar på godkännande to appear.",
  );
  await expect(screen.getByText("Väntar på godkännande", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("button", "Skicka för godkännande", { exact: true }),
  ).toBeDisabled();
  await browser.reload();
  await expect(
    screen.getByRole("button", "Skicka för godkännande", { exact: true }),
  ).toBeDisabled();
  await expect(screen.getByText("Väntar på godkännande", { exact: true })).toBeVisible();

  const endpoint = `/api/v1${new URL(workspace).pathname}/payroll/mileage-corrections/${encodeURIComponent(fixture.proposalId)}`;

  const retained = await browser.evaluate(
    `async () => {
      const response = await fetch(${JSON.stringify(endpoint)});
      if (!response.ok) throw new Error('Retained mileage read failed: ' + response.status);
      const view = await response.json();
      return { status: view.current.status, submissions: view.submissions.length,
        approvals: view.approvals.length, executed: view.execution !== null,
        entitlementDeltaMinor: view.comparison.entitlementDeltaMinor,
        contributionCorrectionMinor: view.comparison.contributionCorrectionMinor,
        journal: view.journal };
    }`,
  );

  expect(retained).toMatchObject({
    status: "submitted",
    submissions: 1,
    approvals: 0,
    executed: false,
    entitlementDeltaMinor: "-6600",
    contributionCorrectionMinor: "-346",
    journal: {
      debitMinor: "6600",
      creditMinor: "6600",
      receivableMinor: "6600",
      claimedGrossMinor: "1100",
    },
  });
  await writeFile(join(output, "R41-retained-submission.json"), JSON.stringify(retained, null, 2));
  await app.screenshot("R41-submission-retained-after-reload");
});
