import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("Company facts retain sources and dates without treating saved input as confirmed", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  await app.open(`${workspace}/setup?view=start`);
  await agent.act("Choose Utforska med exempeldata, then continue to Företagsprofil.");
  await expect(screen.getByRole("heading", "Företagsprofil")).toBeVisible();
  await expect(screen.getByText("Organisationsnummer", { exact: true })).toBeVisible();
  await expect(screen.getByText("Momsregistrering", { exact: true })).toBeVisible();
  await agent.act(
    "Edit Organisationsnummer to the synthetic value 559999-0005, set Gäller från to 2026-01-01, and save. Do not confirm it.",
  );
  await expect(screen.getByText("5599990005", { exact: true })).toBeVisible();
  await agent.act(
    "Edit Land, choose Sverige, set Gäller från to 2026-01-01, and save. Do not confirm it.",
  );
  await agent.act(
    "Edit Momsregistrering, choose Registrerad, set Gäller från to 2026-01-01, and save. Do not confirm it.",
  );
  await browser.reload();
  await expect(screen.getByText("5599990005", { exact: true })).toBeVisible();
  await expect(screen.getByText("Sverige", { exact: true })).toBeVisible();
  await expect(screen.getByText("Registrerad", { exact: true })).toBeVisible();
  await expect(screen.getByText("Du angav", { exact: true })).toHaveCount(3);
  await expect(screen.getByText("1 jan 2026", { exact: true })).toHaveCount(3);
  await expect(screen.getByText("○ Läst, behöver bekräftas", { exact: true })).toHaveCount(3);
  await app.screenshot("company-profile-retained-unconfirmed-facts");
});
