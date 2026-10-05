import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("Backdated loan interest is reviewed and posted only as the retained difference", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/books?view=accounts`);
  await screen.getByRole("link", "2893 Lån från aktieägare", { exact: true }).click();
  await screen
    .getByRole("link", "Förbered ränta, 2026-09-30, skillnad 20,55", { exact: true })
    .click();
  await expect(screen.getByRole("heading", "Ränta 1 till 30 sep räknas om")).toBeVisible();
  await expect(screen.getByText("Förslag, ej bokfört", { exact: true })).toBeVisible();
  await expect(screen.getByText("513,6986", { exact: true })).toBeVisible();
  await expect(screen.getByText("513,70", { exact: true })).toBeVisible();
  await expect(screen.getByText("−493,15", { exact: true })).toBeVisible();
  await expect(screen.getByRole("cell", "20,55", { exact: true })).toHaveCount(2);
  await expect(
    screen.getByText("Skillnaden mot långivarens uppgift är okänd, inte noll.", { exact: false }),
  ).toBeVisible();
  await app.screenshot("O23-backdated-rate-recalculated-difference");
  await browser.reload();
  await expect(screen.getByText("513,6986", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Aviseringsbrev 2 okt.pdf", { exact: true }).click();
  await expect(screen.getByRole("dialog")).toBeVisible();
  await expect(
    screen.getByText("Synthetic notice: 6.5% from 2026-09-16.", { exact: false }),
  ).toBeVisible();
  await screen.getByRole("button", "Stäng", { exact: true }).click();
  await screen.getByRole("button", "Skicka för godkännande", { exact: true }).click();
  await expect(screen.getByRole("button", "Godkänn", { exact: true })).toBeEnabled();
  await expect(screen.getByRole("button", "Bokför", { exact: true })).toBeDisabled();
  await agent.act(
    "Click Godkänn to approve this synthetic loan interest difference, then click Bokför. Finish when Bokfört is visible.",
  );
  await expect(screen.getByText("Bokfört", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByText("Bokfört", { exact: true })).toBeVisible();
  await expect(screen.getByText("Bokförd", { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "VERIFIKAT A3", { exact: true })).toBeVisible();
  await expect(screen.getByRole("cell", "20,55", { exact: true })).toHaveCount(2);
  await app.screenshot("O23-loan-interest-difference-posted-and-reloaded");
});
