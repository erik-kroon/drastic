import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({ path: Schema.String });

test("R40 retains three receipt outcomes and independently recognizes one balanced debt", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  await signInSyntheticOperator(browser, app.baseUrl);

  const fixture = Schema.decodeUnknownSync(Fixture)(
    JSON.parse(
      await readFile(
        join(process.env.OPENERP_E2E_OUTPUT ?? "", "runtime/claim-fixture.json"),
        "utf8",
      ),
    ),
  );

  await app.open(`${fixture.path.split("?")[0]}?view=claims`);
  await expect(screen.getByText("Anders Berg", { exact: true })).toBeVisible({ timeout: 45000 });
  await screen.getByText("Anders Berg", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Utlägg från Anders Berg, 3 kvitton", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(screen.getByText("Kan bokföras som skuld", { exact: true })).toBeVisible();
  await expect(
    screen.getByText("Betald av företaget, kan inte bli utlägg", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Dubblett av rad 1, räknas inte", { exact: true })).toBeVisible();
  await expect(screen.getByRole("radio", "Dela upp")).toBeChecked();
  await expect(
    screen.getByText("5 000,00 direkt från banken och 7 500,00 i oktoberlönen", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("button", "Godkänn rad 1", { exact: true })).toBeEnabled();
  await app.screenshot("R40-three-receipts-before-approval");
  await screen
    .getByRole("link", "1 Pappershuset AB, kontorsmaterial, kvitto 7731", { exact: true })
    .click();
  await expect(screen.getByRole("link", "Tillbaka till utläggen", { exact: true })).toBeVisible();
  await expect(screen.getByText('"supplierDocumentNumber":"7731"', { exact: false })).toBeVisible();
  await expect(screen.getByText('"grossMinor":"1250000"', { exact: false })).toBeVisible();
  await screen.getByRole("link", "Tillbaka till utläggen", { exact: true }).click();
  await expect(screen.getByRole("button", "Godkänn rad 1", { exact: true })).toBeEnabled();
  await agent.act("Click Godkänn rad 1 once. Stop when Bokförd and BOKFÖRD SKULD are visible.");
  await expect(screen.getByRole("heading", "BOKFÖRD SKULD", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("heading", "BOKFÖRD SKULD", { exact: true })).toBeVisible();
  await expect(screen.getByText("Dubblett av rad 1, räknas inte", { exact: true })).toBeVisible();
  await app.screenshot("R40-balanced-debt-after-approval-and-reload");
});
