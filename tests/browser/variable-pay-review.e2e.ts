import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({ assessmentId: Schema.String });

test("R42 retains three blockers and returns the input without financial effects", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const output = process.env.OPENERP_E2E_OUTPUT ?? "";

  const fixture = Schema.decodeSync(Schema.fromJsonString(Fixture))(
    await readFile(join(output, "runtime/variable-fixture.json"), "utf8"),
  );

  const base = new URL(workspace).pathname;
  const endpoint = `/api/v1${base}/payroll/variable-pay/assessments/${encodeURIComponent(fixture.assessmentId)}`;

  const retained = async () =>
    browser.evaluate(`async () => {
      const response = await fetch(${JSON.stringify(endpoint)});
      if (!response.ok) throw new Error('Retained variable-pay read failed: ' + response.status);
      const view = await response.json();
      return { status: view.current.status, blockers: view.current.blockers.map(row => row.code),
        workedAmountMinor: view.assessment.workedAmountMinor,
        holidayDeltaMinor: view.assessment.holidayDeltaMinor,
        sickAmountMinor: view.assessment.sickAmountMinor,
        recognized: view.recognition !== null, approved: view.financialApproval !== null,
        dispositions: view.dispositions.map(row => ({ kind: row.kind, submitterActorId: row.submitterActorId })),
        submitterActorId: view.assessment.submitter.actorId };
    }`);

  await app.open(`${base}/tax?view=variable`);
  await expect(screen.getByText("Maja Holm, september", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await screen.getByText("Maja Holm, september", { exact: true }).click();
  await expect(
    screen.getByRole("heading", "Rörlig lön för september, Maja Holm", { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(screen.getByText("Kan inte godkännas", { exact: true })).toBeVisible();
  await expect(screen.getByText("Okänd", { exact: true })).toHaveCount(2);
  await expect(screen.getByRole("button", "Godkänn", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("link", "Visa raden", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Visa konto", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Visa körningen", { exact: true })).toBeVisible();
  const before = await retained();
  expect(before).toMatchObject({
    status: "blocked",
    workedAmountMinor: "750000",
    holidayDeltaMinor: null,
    sickAmountMinor: null,
    recognized: false,
    approved: false,
    dispositions: [],
  });
  expect(before).toHaveProperty("blockers", [
    "unsupported_work",
    "holiday_control",
    "duplicate_source",
  ]);
  await app.screenshot("R42-three-retained-blockers");
  await screen.getByRole("link", "Visa raden", { exact: true }).click();
  await expect(
    screen.getByRole("link", "Tillbaka till granskningen", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText(/synthetic-variable-timesheet-v1/)).toBeVisible();
  await app.screenshot("R42-retained-timesheet-original");
  await screen.getByRole("link", "Tillbaka till granskningen", { exact: true }).click();
  await browser.reload();
  await expect(screen.getByRole("button", "Godkänn", { exact: true })).toBeDisabled();
  await agent.act(
    "Click Skicka tillbaka till Sara Lind once and wait for Skickat tillbaka to appear.",
  );
  await expect(screen.getByText("Skickat tillbaka", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByText("Skickat tillbaka", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("button", "Skicka tillbaka till Sara Lind", { exact: true }),
  ).toBeDisabled();
  const after = await retained();
  expect(after).toMatchObject({
    status: "returned",
    workedAmountMinor: "750000",
    holidayDeltaMinor: null,
    sickAmountMinor: null,
    recognized: false,
    approved: false,
  });
  expect(after).toHaveProperty("dispositions", [
    {
      kind: "returned",
      submitterActorId: (before as { submitterActorId: string }).submitterActorId,
    },
  ]);
  await writeFile(
    join(output, "R42-retained-return.json"),
    JSON.stringify({ before, after }, null, 2),
  );
  await app.screenshot("R42-return-retained-after-reload");
});
