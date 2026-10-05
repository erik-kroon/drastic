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
  ).toBeVisible();
  await expect(screen.getByRole("alert")).toContainText(
    "18 750,00 men obetalt belopp är nu 13 750,00",
  );
  await browser.reload();
  await expect(screen.getByText("Godkännandet gäller inte längre", { exact: true })).toBeVisible();
  await app.screenshot("M60-retained-payment-refusal-before-recovery");
  await agent.act(
    "Open Visa betalningen to inspect the actual payment that changed the balance. Do not make a payment or post accounting.",
  );
  await expect(browser).toHaveURL(/allocation=/);
  await browser.back();
  await expect(screen.getByRole("alert")).toContainText("13 750,00");
  await agent.act(
    "Prepare a new reminder using Förbered ny påminnelse på 13 750,00. Do not approve or send anything.",
  );
  await expect(
    screen.getByRole("link", "Öppna den nya påminnelsen", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByRole("link", "Öppna den nya påminnelsen", { exact: true }),
  ).toBeVisible();
  await agent.act(
    "Open the new reminder using Öppna den nya påminnelsen. Do not approve or send it.",
  );
  await expect(
    screen.getByRole("button", "Godkänn exakt meddelande till lokal transport", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Förberett belopp, 13 750,00 SEK", { exact: true })).toBeVisible();
  await agent.act(
    "Cancel this unapproved reminder using Avbryt före leveransförsök. Do not approve or send it.",
  );
  await expect(screen.getByText("Avbruten före leveransförsök", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByText("Avbruten före leveransförsök", { exact: true })).toBeVisible();
  await app.screenshot("M60-replacement-cancelled-without-approval-or-dispatch-after-reload");
});
