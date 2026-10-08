import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({
  path: Schema.String,
  legalNumber: Schema.String,
  preparedPath: Schema.String,
});

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
  await expect(screen.getByRole("button", "Godkänn utskick", { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Det här skickas", { exact: true })).toBeVisible();
  await agent.act(
    "Click Avbryt påminnelsen. Stop when Bekräfta att påminnelsen avbryts is visible.",
  );
  await expect(
    screen.getByRole("heading", "Bekräfta att påminnelsen avbryts", { exact: true }),
  ).toBeVisible();
  await agent.act(
    "Click Bekräfta och avbryt påminnelsen once. Stop when Påminnelsen är avbruten is visible.",
  );
  await expect(
    screen.getByRole("heading", "Påminnelsen är avbruten", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByRole("heading", "Påminnelsen är avbruten", { exact: true }),
  ).toBeVisible();
  await app.screenshot("M60-replacement-cancelled-without-approval-or-dispatch-after-reload");
  await app.open(fixture.preparedPath);
  await expect(screen.getByRole("heading", "Det här skickas", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Godkänn utskick", { exact: true }).press("Enter");
  await expect(screen.getByRole("button", "Skicka påminnelsen", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("heading", "Godkänt innehåll", { exact: true })).toBeVisible();
  await expect(screen.getByText("Samma utskick:")).not.toBeVisible();
  await app.screenshot("M98-approved-before-explicit-send-after-reload");
  await screen.getByRole("button", "Skicka påminnelsen", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Påminnelsens utfall är okänt", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(screen.getByRole("button", "Skicka igen", { exact: true })).toBeDisabled();
  await browser.reload();
  await expect(screen.getByRole("button", "Skicka igen", { exact: true })).toBeDisabled();
  await app.screenshot("M32-unknown-attempt-retained-after-reload");
  await screen.getByRole("button", "Kontrollera samma utskick", { exact: true }).click();
  await expect(screen.getByRole("button", "Skicka igen", { exact: true })).toBeDisabled();
  await expect(
    screen.getByRole("heading", "Påminnelsens utfall är fortfarande okänt", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await app.screenshot("M104-inconclusive-same-attempt-check");
  await screen.getByRole("button", "Kontrollera samma utskick igen", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "✓ Accepterad av e-posttjänsten", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await browser.reload();
  await expect(
    screen.getByText("Leverans till inkorgen är inte styrkt. Skicka inte igen.", { exact: true }),
  ).toBeVisible();
  await app.screenshot("M102-same-attempt-acceptance-retained-without-duplicate-send");

  const delivery = Schema.decodeUnknownSync(
    Schema.Struct({
      submissions: Schema.Array(
        Schema.Struct({
          externalIdentity: Schema.String,
          attachments: Schema.Array(
            Schema.Struct({ byteLength: Schema.Int, sha256: Schema.String }),
          ),
        }),
      ),
      reads: Schema.Array(Schema.String),
    }),
  )(
    JSON.parse(
      await readFile(
        join(process.env.OPENERP_E2E_OUTPUT ?? "", "runtime/reminder-delivery.json"),
        "utf8",
      ),
    ),
  );

  expect(delivery.submissions).toHaveLength(1);
  expect(delivery.reads).toHaveLength(2);
  expect(
    new Set([...delivery.submissions.map((wire) => wire.externalIdentity), ...delivery.reads]).size,
  ).toBe(1);
  expect(delivery.submissions[0]?.attachments).toHaveLength(1);
});
