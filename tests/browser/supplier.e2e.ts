import { randomUUID } from "node:crypto";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("a supplier survives reload and can be found by its retained reference", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  const name = "Tallvik Luna Test AB";
  const reference = `luna_${randomUUID()}`;
  await app.open(`${workspace}/purchases?view=parties`);
  await expect(screen.getByRole("button", "Ny leverantör")).toBeVisible({ timeout: 90_000 });
  await agent.act("Open the form to add a new supplier (Ny leverantör).");
  await expect(screen.getByRole("dialog", "Ny leverantör")).toBeVisible();
  await screen.getByLabel("Namn", { exact: true }).fill(name);
  await screen.getByLabel("Kontaktnummer / referens (valfritt)").fill(reference);
  await screen
    .getByLabel("Anteckning (valfritt)")
    .fill("Synthetic Luna E2E supplier; no invoices or payments.");
  await agent.act("Save the supplier using Spara kontakt.");
  await expect(screen.getByRole("dialog", "Ny leverantör")).not.toBeVisible();
  await expect(screen.getByText(reference, { exact: true }).first()).toBeVisible();

  await browser.reload();
  await expect(screen.getByRole("button", "Ny leverantör")).toBeVisible();
  await screen.getByRole("button", "Sök", { exact: true }).click();
  await screen.getByRole("searchbox", "Sök kontakter").fill(reference);
  await screen.getByRole("searchbox", "Sök kontakter").press("Enter");
  await expect(screen.getByText(reference, { exact: true }).first()).toBeVisible();
  await expect(screen.getByRole("button", new RegExp(reference))).toBeVisible();
  await expect(screen.getByRole("button", new RegExp(reference))).toHaveCount(1);
  await expect(screen.getByRole("button", new RegExp(reference))).toContainText(name);
  await expect(screen.getByRole("button", new RegExp(reference))).toContainText("Leverantör");
  await screen.getByRole("searchbox", "Sök kontakter").press("Escape");
  await app.screenshot("supplier-retained-after-reload");

  await screen.getByRole("button", "Sök", { exact: true }).click();
  await screen.getByRole("searchbox", "Sök kontakter").fill(`missing_${reference}`);
  await screen.getByRole("searchbox", "Sök kontakter").press("Enter");
  await expect(screen.getByText("Inga matchande kontakter", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", new RegExp(reference))).toHaveCount(0);
  await screen.getByRole("searchbox", "Sök kontakter").press("Escape");
  await app.screenshot("supplier-unmatched-reference");
});
