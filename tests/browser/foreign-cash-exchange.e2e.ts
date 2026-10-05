import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("EUR exchange keeps the fee outside gain and posts the retained bank rows", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/accounts`);
  await screen.getByRole("link", "Valutakonton", { exact: true }).click();
  await screen.getByRole("link", "1941 Valutakonto EUR", { exact: true }).click();
  await screen.getByRole("link", "Växla till SEK, 2026-10-03", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Växla 2 000,00 EUR till SEK", { exact: true }),
  ).toBeVisible();
  await expect(
    screen.getByRole("textbox", "Mottaget före avgift, SEK", { exact: true }),
  ).toHaveValue("22\u00a0650,00");
  await expect(screen.getByRole("textbox", "Växlingsavgift, SEK", { exact: true })).toHaveValue(
    "50,00",
  );
  await expect(screen.getByText("650,00", { exact: true })).toHaveCount(2);
  await expect(screen.getByRole("cell", "22 650,00", { exact: true })).toHaveCount(2);
  await app.screenshot("O24-exchange-retained-gain-fee-and-balanced-journal");
  await screen.getByRole("textbox", "Växlingsavgift, SEK", { exact: true }).fill("60,00");
  await expect(screen.getByRole("alert")).toContainText("Beloppen stämmer inte");
  await expect(
    screen.getByRole("button", "Skicka för godkännande", { exact: true }),
  ).toBeDisabled();
  await expect(screen.getByRole("heading", "VERIFIKATFÖRSLAG", { exact: true })).toHaveCount(0);
  await screen.getByRole("textbox", "Växlingsavgift, SEK", { exact: true }).fill("50,00");
  await expect(screen.getByRole("heading", "VERIFIKATFÖRSLAG", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Växlingsavi 3 okt.pdf", { exact: true }).click();
  await expect(screen.getByRole("dialog")).toBeVisible();
  await expect(screen.getByText("synthetic_foreign_cash_fee_v1", { exact: false })).toBeVisible();
  await screen.getByRole("button", "Stäng", { exact: true }).click();
  await browser.reload();
  await expect(screen.getByText("650,00", { exact: true })).toHaveCount(2);
  await screen.getByRole("button", "Skicka för godkännande", { exact: true }).click();
  await expect(screen.getByRole("button", "Bokför", { exact: true })).toBeDisabled();
  await agent.act(
    "Approve this synthetic EUR exchange with Godkänn, then post it with Bokför. Finish when Bokfört is visible.",
  );
  await expect(
    screen.getByText("Bokfört. Kontot har 4 000,00 EUR med bokfört värde 44 000,00.", {
      exact: true,
    }),
  ).toBeVisible();
  await browser.reload();
  await expect(screen.getByText("Bokförd", { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "VERIFIKAT A2", { exact: true })).toBeVisible();
  await expect(screen.getByRole("cell", "650,00", { exact: true })).toHaveCount(1);
  await expect(screen.getByRole("cell", "50,00", { exact: true })).toHaveCount(1);
  await expect(
    screen.getByText("Bokfört. Kontot har 4 000,00 EUR med bokfört värde 44 000,00.", {
      exact: true,
    }),
  ).toBeVisible();
  await app.screenshot("O24-exchange-posted-voucher-and-remaining-holding-after-reload");
});
