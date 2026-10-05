import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("A posted reversal retains its balanced voucher and replacement plan after reload", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/books?view=assets`);
  await screen.getByRole("button", "Maskin, verkstad").click();
  await screen.getByText("Återföring av nedskrivning, 2026-10-03", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Nedskrivning återförd, Maskin, verkstad"),
  ).toBeVisible();
  await expect(screen.getByText("Bokförd", { exact: true })).toBeVisible();
  await expect(screen.getByText("Förberett av Sara Lind", { exact: false })).toBeVisible();
  await expect(screen.getByText("godkänt av Elin Sund", { exact: false })).toBeVisible();
  await expect(screen.getByText("Taket 7 000,00 är oförändrat.", { exact: false })).toBeVisible();
  await expect(screen.getByRole("cell", "1 500,00", { exact: true })).toHaveCount(4);
  await app.screenshot("Q35-posted-reversal-balanced-voucher");
  await browser.reload();
  await expect(
    screen.getByRole("heading", "Nedskrivning återförd, Maskin, verkstad"),
  ).toBeVisible();
  await agent.act(
    "Click Visa planen. Finish when the retained depreciation plan shows 2026-12-20 and 6 500,00.",
  );
  await expect(screen.getByRole("cell", "2026-12-20", { exact: true })).toBeVisible();
  await expect(screen.getByRole("cell", "6 500,00", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("cell", "2026-12-20", { exact: true })).toBeVisible();
  await app.screenshot("Q35-retained-replacement-plan");
});
