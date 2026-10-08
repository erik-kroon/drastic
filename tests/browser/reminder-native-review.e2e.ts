import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("review exact reminder at native 200 percent and approve with keyboard", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  test.skip(
    process.env.OPENERP_REMINDER_NATIVE_ZOOM !== "1",
    "Run the dedicated native-zoom recipe with OPENERP_REMINDER_NATIVE_ZOOM=1",
  );

  await signInSyntheticOperator(browser, app.baseUrl);

  const output = process.env.OPENERP_E2E_OUTPUT ?? "";

  const fixture = Schema.decodeUnknownSync(Schema.Struct({ preparedPath: Schema.String }))(
    JSON.parse(await readFile(join(output, "runtime/reminder-fixture.json"), "utf8")),
  );

  const baseline = await browser.evaluate<{ dpr: number; width: number }>(
    "() => ({ dpr: window.devicePixelRatio, width: window.innerWidth })",
  );

  await app.open(fixture.preparedPath);
  await expect(screen.getByRole("heading", "Det här skickas", { exact: true })).toBeVisible();

  const observed = await browser.evaluate<{ dpr: number; width: number }>(
    "() => ({ dpr: window.devicePixelRatio, width: window.innerWidth })",
  );

  const qualified =
    Math.abs(observed.dpr / baseline.dpr - 2) < 0.02 &&
    Math.abs(baseline.width / observed.width - 2) < 0.04;

  const screenshot = await app.screenshot("native-200-percent-reminder-review");

  await writeFile(
    join(output, "native-reminder-review.json"),
    JSON.stringify({ baseline, observed, qualified, screenshot }, null, 2),
  );
  expect(qualified).toBe(true);
  await expect(screen.getByText("ekonomi@bjorkdalen.example.test", { exact: true })).toBeVisible();
  await browser.keyboard.press("PageDown");
  await agent.assert(
    "The exact reminder preview retains the reviewed recipient, 13 750,00 amount, original invoice attachment and message. No approval or dispatch has happened yet.",
  );
  await app.screenshot("native-200-percent-reminder-message");

  let approvalFocused = false;

  for (let step = 0; step < 35; step++) {
    await browser.keyboard.press("Tab");

    approvalFocused = await browser.evaluate<boolean>(
      "() => document.activeElement?.textContent?.trim() === 'Godkänn utskick'",
    );

    if (approvalFocused) break;
  }

  expect(approvalFocused).toBe(true);
  await browser.keyboard.press("Enter");
  await expect(screen.getByRole("button", "Skicka påminnelsen", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("heading", "Godkänt innehåll", { exact: true })).toBeVisible();
  await app.screenshot("native-200-percent-keyboard-approval-without-dispatch");

  const delivery = Schema.decodeUnknownSync(
    Schema.Struct({
      submissions: Schema.Array(Schema.Unknown),
      reads: Schema.Array(Schema.String),
    }),
  )(JSON.parse(await readFile(join(output, "runtime/reminder-delivery.json"), "utf8")));

  expect(delivery.submissions).toHaveLength(0);
  expect(delivery.reads).toHaveLength(0);
  await writeFile(
    join(output, "native-reminder-review.json"),
    JSON.stringify(
      {
        baseline,
        observed,
        qualified,
        screenshot,
        approval: "tab_then_enter",
        dispatch: "not_requested",
        fixtureSubmissions: delivery.submissions.length,
        fixtureReads: delivery.reads.length,
      },
      null,
      2,
    ),
  );
});
