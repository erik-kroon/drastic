import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({ route: Schema.String, legalNumber: Schema.String });

test("Peppol recovery retains a sealed PDF email intent and separate credit proposal", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  await signInSyntheticOperator(browser, app.baseUrl);

  const fixture = Schema.decodeUnknownSync(Fixture)(
    JSON.parse(
      await readFile(
        join(process.env.OPENERP_E2E_OUTPUT ?? "", "runtime/peppol-fixture.json"),
        "utf8",
      ),
    ),
  );

  await app.open(fixture.route);
  await expect(screen.getByText("Kan inte skickas", { exact: true })).toBeVisible();
  await agent.act(
    "Open the email recovery using Förbered e-post, then prepare the PDF using Förbered PDF. Stop when Ladda ner PDF is available.",
  );
  await expect(screen.getByRole("button", "Ladda ner PDF", { exact: true })).toBeVisible();
  await screen.getByRole("textbox", "Till", { exact: true }).fill("ekonomi@example.test");
  await screen
    .getByRole("textbox", "Anledning", { exact: true })
    .fill("Synthetic PDF fallback for retained Peppol refusal");
  await agent.act(
    "Submit the populated email handoff form once using its Förbered e-post button. Do not approve or send anything.",
  );
  await expect(screen.getByText("ekonomi@example.test", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Godkänn utskick", { exact: true })).toBeVisible();
  await browser.reload();
  await screen.getByRole("button", "Förbered e-post", { exact: true }).click();
  await expect(screen.getByText("ekonomi@example.test", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Godkänn utskick", { exact: true })).toBeVisible();
  await app.screenshot("M59-sealed-PDF-email-intent-retains-separate-approval-after-reload");
  await screen.getByRole("button", "Förbered kredit", { exact: true }).click();
  await screen
    .getByRole("textbox", "Anledning", { exact: true })
    .fill("Synthetic correction: original invoice lacks buyer reference");
  await agent.act("Save the populated credit reason once using Spara anledning.");
  await expect(screen.getByRole("button", "Skapa kreditutkast", { exact: true })).toBeVisible();
  await agent.act(
    "Create the separately reviewed credit draft once using Skapa kreditutkast. Do not post a credit or issue an invoice.",
  );
  await expect(screen.getByText("Kreditutkast", { exact: true })).toBeVisible();
  await expect(browser).toHaveURL(/credit=/);
  await browser.reload();
  await expect(screen.getByText("Kreditutkast", { exact: true })).toBeVisible();
  await expect(screen.getByText("Originalfakturan ändras inte.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Skicka", { exact: true })).toBeDisabled();
  await app.screenshot("M59-addressable-credit-proposal-retains-original-unchanged-after-reload");
});
