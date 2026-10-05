import { readFile } from "node:fs/promises";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("Cash discovery exposes absent sources and retains accessible recovery after reload", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  await app.open(`${workspace}/reports?view=cash_forecast`);
  await expect(screen.getByRole("heading", "Kassaflöde")).toBeVisible({ timeout: 90_000 });
  await expect(screen.getByText("Inga sparade prognoser", { exact: true })).toBeVisible();
  await agent.act("Open Underlag för prognosen to inspect the native forecast source basis.");
  await expect(screen.getByRole("heading", "Underlag för prognosen")).toBeVisible();
  await expect(screen.getByText("Inga sparade underlag", { exact: true })).toBeVisible();
  await expect(screen.getByText("Kontoutdrag saknas", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Bank")).toBeVisible();
  await expect(screen.getByRole("button", "Spara underlag")).toBeDisabled();
  await app.screenshot("cash-missing-sources");
  await browser.reload();
  await expect(screen.getByRole("heading", "Kassaflöde")).toBeVisible();
  await screen.getByRole("button", "Underlag för prognosen").click();
  await expect(screen.getByText("Kontoutdrag saknas", { exact: true })).toBeVisible();
  await browser.setViewport({ width: 390, height: 844 });
  await expect(screen.getByRole("link", "Bank")).toBeVisible();
  expect(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await app.screenshot("cash-missing-sources-narrow");

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const origin = new URL(workspace).origin;

  const base = workspace.replace(origin, `${origin}/api/v1`);

  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    expect(response.status).toBe(200);

    return response.json();
  };

  const setup = Schema.decodeUnknownSync(Schema.Struct({ today: Schema.String }))(
    await call("/setup"),
  );

  const review = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await call("/evidence", {
      title: "Synthetic browser forecast source declaration",
      content: "Model product fixture. Sources deliberately unknown. No actual company assertion.",
      mediaType: "text/plain",
      origin: "cash-browser-synthetic",
    }),
  );

  const inventory = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await call("/periods/period_synthetic_2026/closing-source-inventories", {
      evidenceId: review.id,
      bankAccountIds: ["account_bank"],
    }),
  );

  await call("/bank-source-coverage", {
    inventoryId: inventory.id,
    startsOn: `${setup.today.slice(0, 4)}-01-01`,
    endsOn: `${setup.today.slice(0, 4)}-12-31`,
  });
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.reload();
  await screen.getByRole("button", "Underlag för prognosen").click();
  await agent.act(
    "Select the saved statement coverage by its dates, then select account 1930. Keep account eligibility and balance type at Okänt. Enter Granskningsgrund as Syntetiskt okänt underlag. Save with Spara underlag.",
  );
  await expect(screen.getByRole("heading", "Jämförelse")).toBeVisible();
  await screen.getByRole("textbox", "Din gräns, SEK").fill("100,00");
  await screen.getByRole("button", "Spara bild").click();
  await expect(
    screen.getByText("Öppningssaldo saknas. Saldo, minimum och marginal kan inte beräknas.", {
      exact: true,
    }),
  ).toBeVisible();
  await browser.reload();
  await expect(
    screen.getByText("Öppningssaldo saknas. Saldo, minimum och marginal kan inte beräknas.", {
      exact: true,
    }),
  ).toBeVisible();

  const history = Schema.decodeUnknownSync(
    Schema.Struct({
      total: Schema.Int,
      items: Schema.Array(
        Schema.Struct({ id: Schema.String, closingMinor: Schema.NullOr(Schema.String) }),
      ),
    }),
  )(await call("/cash-forecasts"));

  expect(history.total).toBe(1);
  expect(history.items[0]?.closingMinor).toBeNull();

  const view = Schema.decodeUnknownSync(
    Schema.Struct({ artifact: Schema.Struct({ content: Schema.String }) }),
  )(await call(`/cash-forecasts/${history.items[0]!.id}`));

  const downloaded = await browser.waitForDownload(() =>
    screen.getByRole("button", "Ladda ner originalet").click(),
  );

  expect(await readFile(downloaded.path, "utf8")).toBe(view.artifact.content);
  await app.screenshot("cash-unknown-opening-retained-original");
  await call("/periods/period_synthetic_2026/closing-source-inventories", {
    evidenceId: review.id,
    bankAccountIds: [],
  });
  await screen.getByRole("button", "Läs in igen").click();
  await expect(
    screen.getByText("Inaktuell. Bilden är oförändrad och räknas inte om automatiskt.", {
      exact: true,
    }),
  ).toBeVisible();

  const after = Schema.decodeUnknownSync(
    Schema.Struct({ artifact: Schema.Struct({ content: Schema.String }) }),
  )(await call(`/cash-forecasts/${history.items[0]!.id}`));

  expect(after.artifact.content).toBe(view.artifact.content);
  await app.screenshot("cash-source-change-retains-original-result");
});
