import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({ route: Schema.String, legalNumber: Schema.String });

test("Peppol refusal persists its rule failure and independent return after reload", async ({
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
  await expect(screen.getByRole("alert")).toContainText("PEPPOL-EN16931-R003");
  await expect(
    screen.getByRole("button", "Godkänn exakt det här innehållet", { exact: true }),
  ).toBeDisabled();
  await expect(screen.getByRole("button", "Skicka", { exact: true })).toBeDisabled();
  await browser.reload();
  await expect(screen.getByRole("alert")).toContainText(
    "Köparens referens eller beställningsreferens saknas",
  );
  await app.screenshot("M59-real-R003-refusal-blocks-approval-and-send-after-reload");
  await agent.act(
    "Send this synthetic failed e-invoice proposal back using Skicka tillbaka. Stop when the page says Förslaget har skickats tillbaka.",
  );
  await expect(
    screen.getByText("Förslaget har skickats tillbaka.", { exact: false }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByText("Förslaget har skickats tillbaka.", { exact: false }),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Skicka tillbaka", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("button", "Skicka", { exact: true })).toBeDisabled();
  await app.screenshot("M59-retained-independent-return-never-enables-send");
});
