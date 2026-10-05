import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("A claimed invoice line stays occupied while a free line creates a separate disposal review", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  await app.open(`${workspace}/books?view=assets`);
  await screen.getByRole("button", "Bildskärm 27 tum").click();
  await screen.getByText("Avyttra Bildskärm 27 tum,", { exact: false }).click();
  await expect(
    screen.getByRole("heading", "Avyttra Bildskärm 27 tum, såld på faktura"),
  ).toBeVisible();
  await expect(
    screen.getByText("En fakturarad kan bara ligga till grund för en avyttring.", { exact: false }),
  ).toBeVisible();
  await expect(screen.getByRole("radio", "Rad 1, Laptop Pro 14")).toBeDisabled();
  await expect(screen.getByRole("radio", "Rad 2, Bildskärm 27 tum")).toBeChecked();
  await expect(screen.getByRole("button", "Använd rad 2")).toBeEnabled();
  await app.screenshot("Q34-occupied-source-free-alternative");
  await browser.reload();
  await expect(screen.getByRole("radio", "Rad 1, Laptop Pro 14")).toBeDisabled();
  await agent.act(
    "Click Använd rad 2 to prepare the disposal review from that free invoice line. Finish when Förslag, ej bokfört is visible.",
  );
  await expect(screen.getByText("Förslag, ej bokfört", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Godkänn")).toBeDisabled();
  await browser.reload();
  await expect(screen.getByText("Förslag, ej bokfört", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Godkänn")).toBeDisabled();
  await app.screenshot("Q34-new-review-retained-before-human-approval");
});
