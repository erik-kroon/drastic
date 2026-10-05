import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("processor payout retains its first voucher and matches the bank through independent approval", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/accounts`);
  await screen.getByRole("link", "Betalförmedlare", { exact: true }).click();
  await screen.getByRole("link", "1580 Fordran på betalförmedlaren", { exact: true }).click();
  await screen.getByRole("link", "Utbetalning 2026-10-03", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Utbetalning 1 220,00, koppla till bankraden", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Väntar på godkännande", { exact: true })).toBeVisible();
  await expect(
    screen.getByText("Kundbetalning 1 okt, netto 1 220,00, F-2026-0049", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("cell", "1 220,00", { exact: true })).toHaveCount(4);
  await expect(
    screen.getByRole("rowheader", "1 Utbetalningen lämnar förmedlaren", { exact: true }),
  ).toBeVisible();
  await app.screenshot("O25-retained-payout-and-bank-proposal-two-steps");
  await browser.reload();
  await expect(screen.getByRole("cell", "1 220,00", { exact: true })).toHaveCount(4);
  await agent.act(
    "Approve the synthetic payout bank match with Godkänn matchningen, then post with Bokför matchningen. Stop when the posted voucher is shown.",
  );
  await expect(screen.getByText("Bokförd", { exact: true })).toBeVisible();
  await expect(
    screen.getByText("Bokfört i verifikat A4. Utbetalningen på väg är 0,00.", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("cell", "1 220,00", { exact: true })).toHaveCount(4);
  await expect(
    screen.getByText("Bokfört i verifikat A4. Utbetalningen på väg är 0,00.", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Godkänn matchningen", { exact: true })).toHaveCount(0);
  await app.screenshot("O25-posted-bank-voucher-and-zero-payout-transit-after-reload");
});
