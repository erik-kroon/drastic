import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("returning a processor match persists the refusal and replacing its bank row requires a fresh reviewer", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/accounts?view=processors`);
  await screen.getByRole("link", "1580 Fordran på betalförmedlaren", { exact: true }).click();
  await screen.getByRole("link", "Utbetalning 2026-10-03", { exact: true }).click();
  await agent.act(
    "Send this synthetic processor match back using Skicka tillbaka. Stop when the screen says the proposal was sent back.",
  );
  await expect(screen.getByRole("alert")).toContainText("Förslaget har skickats tillbaka");
  await browser.reload();
  await expect(screen.getByRole("alert")).toContainText("Förslaget har skickats tillbaka");
  await expect(screen.getByRole("button", "Godkänn matchningen", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("button", "Bokför matchningen", { exact: true })).toHaveCount(0);
  await app.screenshot("O25-returned-review-blocks-old-approval-after-reload");
  await screen.getByRole("link", "Byt bankrad", { exact: true }).click();
  await screen
    .getByRole("button", "3 okt, 1 220,00 SEK, Utbetalning från förmedlaren", { exact: true })
    .click();
  await agent.act(
    "Prepare a new proposal with the selected bank row using Förbered med bankraden. Stop when the new proposal says it was prepared by Elin Sund.",
  );
  await expect(screen.getByText("Förberedd av Elin Sund", { exact: false })).toBeVisible();
  await expect(screen.getByRole("alert")).toHaveCount(0);
  await expect(screen.getByRole("button", "Bokför matchningen", { exact: true })).toHaveCount(0);
  await browser.reload();
  await expect(screen.getByText("Förberedd av Elin Sund", { exact: false })).toBeVisible();
  await expect(screen.getByText("Väntar på godkännande", { exact: true })).toBeVisible();
  await app.screenshot("O25-fresh-bank-review-retains-new-preparer-and-needs-new-approval");
});
