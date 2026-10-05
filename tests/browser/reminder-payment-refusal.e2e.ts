import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({ path: Schema.String, legalNumber: Schema.String });

test("M60 keeps changed-payment refusal and prepares a separately approved reminder", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  await signInSyntheticOperator(browser, app.baseUrl);

  const fixture = Schema.decodeUnknownSync(Fixture)(
    JSON.parse(
      await readFile(
        join(process.env.OPENERP_E2E_OUTPUT ?? "", "runtime/reminder-fixture.json"),
        "utf8",
      ),
    ),
  );

  await app.open(fixture.path);
  await expect(
    screen.getByRole("heading", `Påminnelse, ${fixture.legalNumber} skickades inte`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 45000 });
  await expect(screen.getByRole("alert")).toContainText(
    "18 750,00 men obetalt belopp är nu 13 750,00",
  );
  await browser.reload();
  await expect(screen.getByText("Godkännandet gäller inte längre", { exact: true })).toBeVisible();
  await app.screenshot("M60-retained-payment-refusal-before-recovery");
  await screen.getByRole("link", "Visa betalningen", { exact: true }).click();
  await expect(browser).toHaveURL(/allocation=/);
  await browser.back();
  await expect(screen.getByRole("alert")).toContainText("13 750,00");
  await agent.act(
    "Click Förbered ny påminnelse på 13 750,00 once. Stop when the new reminder is prepared and Öppna den nya påminnelsen is visible.",
  );
  await expect(
    screen.getByRole("link", "Öppna den nya påminnelsen", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByRole("link", "Öppna den nya påminnelsen", { exact: true }),
  ).toBeVisible();
  await screen.getByRole("link", "Öppna den nya påminnelsen", { exact: true }).click();
  await expect(
    screen.getByRole("button", "Godkänn exakt meddelande till lokal transport", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Förberett belopp, 13 750,00 SEK", { exact: true })).toBeVisible();
  await agent.act(
    "Click Avbryt före leveransförsök once. Stop when Avbruten före leveransförsök is shown.",
  );
  await expect(screen.getByText("Avbruten före leveransförsök", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByText("Avbruten före leveransförsök", { exact: true })).toBeVisible();
  await app.screenshot("M60-replacement-cancelled-without-approval-or-dispatch-after-reload");
});
