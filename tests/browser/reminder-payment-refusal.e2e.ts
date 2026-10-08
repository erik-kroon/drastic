import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import {
  captureReminderPaper,
  readRunArtifact,
  type ReminderPaperFrame,
} from "./reminder-paper-capture";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({
  path: Schema.String,
  legalNumber: Schema.String,
  preparedPath: Schema.String,
  rejectedPreparedPath: Schema.String,
  partyPath: Schema.String,
});

test("M60 keeps changed-payment refusal and prepares a separately approved reminder", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const parity: Awaited<ReturnType<typeof captureReminderPaper>>[] = [];

  async function capture(frame: ReminderPaperFrame, label: string) {
    if (frame === "M31" || frame === "M98")
      await expect(
        screen.getByRole("img", `${fixture.legalNumber}.pdf, första sidan`, { exact: true }),
      ).toHaveAttribute("aria-busy", "false");

    parity.push(await captureReminderPaper(app, browser, frame, label));
  }

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
  await capture("M60", "M60-retained-payment-refusal-before-recovery");
  await screen.getByRole("link", "Visa betalningen", { exact: true }).click();
  await expect(browser).toHaveURL(/allocation=/);
  await browser.back();
  await expect(screen.getByRole("alert")).toContainText("13 750,00");
  await screen.getByRole("button", "Förbered ny påminnelse på 13 750,00", { exact: true }).click();
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
  await screen.getByRole("button", "Avbryt påminnelsen", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Bekräfta att påminnelsen avbryts", { exact: true }),
  ).toBeVisible();
  await capture("M101", "M101-cancellation-confirmation");
  await screen.getByRole("button", "Bekräfta och avbryt påminnelsen", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Påminnelsen är avbruten", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByRole("heading", "Påminnelsen är avbruten", { exact: true }),
  ).toBeVisible();
  await agent.assert(
    "The screen says Påminnelsen är avbruten and Inget utskick påbörjades, while the invoice remains available.",
  );
  await capture("M105", "M60-replacement-cancelled-without-approval-or-dispatch-after-reload");
  await app.open(fixture.preparedPath);
  await expect(screen.getByRole("heading", "Det här skickas", { exact: true })).toBeVisible();
  await capture("M31", "M31-exact-message-before-approval");

  const download = await browser.waitForDownload(() =>
    screen.getByRole("button", "Öppna bilagan", { exact: true }).click(),
  );

  const pdfBytes = await readRunArtifact(download.path);
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  expect(download.suggestedFilename).toBe(`${fixture.legalNumber}.pdf`);

  await screen.getByRole("button", "Godkänn utskick", { exact: true }).press("Enter");
  await expect(screen.getByRole("button", "Skicka påminnelsen", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("heading", "Godkänt innehåll", { exact: true })).toBeVisible();
  await expect(screen.getByText("Samma utskick:")).not.toBeVisible();
  await capture("M98", "M98-approved-before-explicit-send-after-reload");
  await screen.getByRole("button", "Skicka påminnelsen", { exact: true }).click();
  await expect(screen.getByRole("heading", "Vad som hände", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(screen.getByRole("button", "Skicka igen", { exact: true })).toBeDisabled();
  await browser.reload();
  await expect(screen.getByRole("button", "Skicka igen", { exact: true })).toBeDisabled();
  await capture("M32", "M32-unknown-attempt-retained-after-reload");
  await screen.getByRole("button", "Kontrollera samma utskick", { exact: true }).click();
  await expect(screen.getByRole("button", "Skicka igen", { exact: true })).toBeDisabled();
  await expect(
    screen.getByRole("heading", "Påminnelsens utfall är fortfarande okänt", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    screen.getByRole("button", "Kontrollera samma utskick igen", { exact: true }),
  ).toBeEnabled();
  await agent.assert(
    "The original reminder outcome is still unknown. Skicka igen is disabled, and Kontrollera samma utskick igen is available.",
  );
  await capture("M104", "M104-inconclusive-same-attempt-check");
  await screen.getByRole("button", "Kontrollera samma utskick igen", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "✓ Accepterad av e-posttjänsten", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await browser.reload();
  await expect(
    screen.getByText("Leverans till inkorgen är inte styrkt. Skicka inte igen.", { exact: true }),
  ).toBeVisible();
  await capture("M102", "M102-same-attempt-acceptance-retained-without-duplicate-send");

  await screen.getByRole("button", "Spara utredning och visa kvittens", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "E-posttjänsten har accepterat påminnelsen", { exact: true }),
  ).toBeVisible();
  await capture("M99", "M99-original-acceptance-without-duplicate-send");

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
  expect(delivery.submissions[0]?.attachments[0]?.sha256).toBe(pdfSha256);
  expect(delivery.submissions[0]?.attachments[0]?.byteLength).toBe(pdfBytes.byteLength);

  await app.open(fixture.rejectedPreparedPath);
  await expect(screen.getByRole("button", "Godkänn utskick", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Godkänn utskick", { exact: true }).click();
  await screen.getByRole("button", "Skicka påminnelsen", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "E-posttjänsten bekräftar att utskicket inte accepterades", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 45000 });
  await browser.reload();
  await expect(
    screen.getByRole("heading", "E-posttjänsten bekräftar att utskicket inte accepterades", {
      exact: true,
    }),
  ).toBeVisible();
  await capture("M103", "M103-definitive-non-acceptance");
  await screen.getByRole("button", "Öppna för ny granskning", { exact: true }).click();
  await screen.getByRole("link", "Öppna den nya påminnelsen", { exact: true }).click();
  await expect(screen.getByRole("button", "Godkänn utskick", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Godkänn utskick", { exact: true }).click();
  await expect(screen.getByRole("button", "Skicka påminnelsen", { exact: true })).toBeVisible();

  const replacementUrl = await browser.evaluate<string>("() => window.location.href");

  await app.open(fixture.partyPath);
  await screen.getByText("Redigera uppgifter", { exact: true }).click();
  await screen
    .getByRole("textbox", "E-postadress", { exact: true })
    .fill("ny-ekonomi@bjorkdalen.example.test");
  await screen
    .getByRole("textbox", "Granskningsorsak", { exact: true })
    .fill("Synthetic reviewed recipient changed after reminder approval");
  await screen
    .getByRole("checkbox", "Jag har granskat mottagaren mot kundens underlag", { exact: true })
    .check();
  await screen.getByRole("button", "Spara mottagarrevision", { exact: true }).click();
  await expect(screen.getByRole("textbox", "E-postadress", { exact: true })).toHaveValue(
    "ny-ekonomi@bjorkdalen.example.test",
  );
  await app.open(replacementUrl);
  await expect(
    screen.getByRole("heading", "Påminnelsens godkännande gäller inte längre", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await browser.reload();
  await expect(screen.getByRole("button", "Skicka påminnelsen", { exact: true })).toBeDisabled();
  await capture("M100", "M100-recipient-revision-invalidates-replacement-approval");

  const finalDelivery = JSON.parse(
    await readFile(
      join(process.env.OPENERP_E2E_OUTPUT ?? "", "runtime/reminder-delivery.json"),
      "utf8",
    ),
  );

  expect(finalDelivery.submissions).toHaveLength(2);
  expect(finalDelivery.reads).toHaveLength(2);

  for (const verdict of parity) expect(verdict.diffRatio).toBeLessThanOrEqual(verdict.maxDiffRatio);
});
