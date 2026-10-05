import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("Changed historical pool retains the approved basis and blocks adoption until reconciliation", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/history`);
  await screen.getByRole("link", "Kundfaktura 2025-0127", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Övertagandet gjordes inte, poolen ändrades", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("3 Godkänd, gäller inte längre", { exact: true })).toBeVisible();
  await expect(screen.getByRole("row", /Kundfaktura 2025-0127/)).toContainText("9 000,00");
  await expect(screen.getByRole("row", /Poolens summa/)).toContainText("41 500,00");
  await expect(screen.getByRole("row", /Huvudbokens ingående balans/)).toContainText("42 500,00");
  await expect(screen.getByRole("row", /Skillnad mellan pool och huvudbok/)).toContainText(
    "1 000,00",
  );
  await expect(screen.getByText("Stämmer inte", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Godkänn", { exact: true })).toHaveCount(0);
  await app.screenshot("Q36-retained-plan-and-changed-source-pool");
  await browser.reload();
  await expect(screen.getByText("3 Godkänd, gäller inte längre", { exact: true })).toBeVisible();
  await agent.act(
    "Click Förbered ny plan once. The unreconciled pool must refuse. Stop when StaleDependency is visible; do not leave this page.",
  );
  await expect(screen.getByText("StaleDependency", { exact: true })).toBeVisible();
  await expect(screen.getByRole("row", /Skillnad mellan pool och huvudbok/)).toContainText(
    "1 000,00",
  );
  await expect(screen.getByRole("button", "Godkänn", { exact: true })).toHaveCount(0);
  await app.screenshot("Q36-new-plan-refused-with-unresolved-control-difference");
  await screen.getByRole("link", "Visa ändringen i importen", { exact: true }).click();
  await expect(screen.getByRole("heading", "Historik.se", { exact: true })).toBeVisible();
  await screen.getByText("Sparade öppna poster", { exact: false }).click();
  await expect(screen.getByText("900000", { exact: false })).toBeVisible();
  await app.screenshot("Q36-recovery-opens-the-retained-corrected-import");
});
