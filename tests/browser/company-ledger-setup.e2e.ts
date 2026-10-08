import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import { signInSyntheticOperator } from "./synthetic-session";

test("A new company configures its first native ledger without opening or posting effects", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  await signInSyntheticOperator(browser, app.baseUrl);
  await app.open("/companies");
  await screen.getByRole("button", "Skapa nytt företag").click();
  await screen.getByLabel("Företagsnamn").fill("Synthetic native ledger trial");
  await screen.getByRole("button", "Skapa företag", { exact: true }).click();
  await expect(browser).toHaveURL(/\/entities\/entity_[^/]+\/books\/book_[^/]+\/setup/);
  const workspace = (await browser.url()).split("/setup")[0]!;
  await app.open(`${workspace}/settings?section=accounting`);
  await expect(screen.getByRole("heading", "Konfigurera bokföringen")).toBeVisible();
  await screen.getByLabel("Första dag").fill("2025-05-17");
  await screen.getByLabel("Sista dag").fill("2026-04-30");
  await screen.getByLabel("Kontonummer 1").fill("1930");
  await screen.getByLabel("Kontonamn 1").fill("Företagskonto");
  await agent.act("Add one account row with Lägg till konto. Do not save yet.");
  await expect(screen.getByLabel("Kontonummer 2")).toBeVisible();
  await screen.getByLabel("Kontonummer 2").fill("1930");
  await screen.getByLabel("Kontonamn 2").fill("Aktiekapital");
  await screen.getByRole("button", "Skapa konton och perioder").click();
  await expect(screen.getByRole("alert")).toContainText("Kontonummer måste vara unika.");
  await expect(screen.getByLabel("Kontonamn 1")).toHaveValue("Företagskonto");
  await screen.getByLabel("Kontonummer 2").fill("2081");
  await app.screenshot("native-ledger-before-configuration");
  await agent.act("Save the accounts and periods using Skapa konton och perioder.");
  await expect(screen.getByRole("heading", "Konfigurera bokföringen")).toBeHidden();
  await expect(screen.getByText("2025-05-17 – 2025-05-31", { exact: true })).toBeVisible();
  await expect(screen.getByText("2026-04-01 – 2026-04-30", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByText("2025-05-17 – 2025-05-31", { exact: true })).toBeVisible();
  await app.open(`${workspace}/books?view=accounts`);
  await expect(screen.getByRole("table", "Kontoplan")).toContainText("Företagskonto");
  await expect(screen.getByRole("table", "Kontoplan")).toContainText("Aktiekapital");
  await app.screenshot("native-ledger-persisted-accounts");

  const contents = await browser.evaluate<string>(`async () => {
    const response = await fetch(${JSON.stringify(`/api/v1${new URL(workspace).pathname}/setup`)});
    if (!response.ok) throw new Error('Setup read failed: ' + response.status);
    return response.text();
  }`);

  const observed = Schema.decodeSync(Schema.fromJsonString(Accounting.BookSetup))(contents);
  expect(observed.periods).toHaveLength(12);
  expect(observed.accounts.map((account) => account.code).sort()).toEqual(["1930", "2081"]);
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Browser artifact directory is missing");
  await writeFile(
    join(output, "native-ledger-setup.json"),
    JSON.stringify({ scope: "synthetic new company", expectedPeriodCount: 12, observed }, null, 2),
  );
});
