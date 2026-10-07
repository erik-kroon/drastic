import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Recurring from "../../packages/contracts/src/recurring-invoices";
import * as Drafts from "../../packages/contracts/src/invoice-drafts";
import { signInSyntheticOperator } from "./synthetic-session";

const Fixture = Schema.Struct({
  agreementId: Accounting.Identifier,
  jobId: Accounting.Identifier,
  title: Schema.String,
  cycleOrdinal: Schema.Literal("1"),
});

test("a recurring failure recovers the same draft after a lost response with keyboard review at 320px", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Run PAPER_RECURRING=1 bun run test:browser");

  const fixture = Schema.decodeSync(Schema.fromJsonString(Fixture))(
    await readFile(join(output, "runtime", "recurring-fixture.json"), "utf8"),
  );

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const path = `${base}/commerce/recurring-invoices/${fixture.agreementId}`;

  async function scheduling() {
    const response = await fetch(`${path}/scheduling`, { headers: { cookie, origin } });
    expect(response.status).toBe(200);

    return Schema.decodeUnknownSync(Recurring.RecurringScheduling)(await response.json());
  }

  const before = await scheduling();
  expect(before.history).toHaveLength(1);
  expect(before.history[0]).toMatchObject({
    id: fixture.jobId,
    cycleOrdinal: "1",
    state: "failed",
    reason: "StaleDependency",
    draftId: null,
  });
  await browser.setViewport({ width: 320, height: 900 });
  await app.open(`${workspace}/work?kind=recurring&status=open`);
  await screen.getByRole("link", fixture.title, { exact: true }).press("Enter");
  await expect(screen.getByRole("heading", fixture.title, { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Cykelhistorik", { exact: true })).toBeVisible();
  await agent.act(
    "Read the selected recurring failure. Fill Orsak with 'Granskat aktuellt avtalsunderlag'. Leave Bekräfta vald cykel unchecked and do not submit.",
  );
  await expect(screen.getByLabel("Orsak", { exact: true })).toHaveValue(
    "Granskat aktuellt avtalsunderlag",
  );
  await screen.getByLabel("Orsak", { exact: true }).press("Tab");
  const confirmation = screen.getByRole("checkbox", "Bekräfta vald cykel", { exact: true });
  await expect(confirmation).toBeFocused();
  await confirmation.press("Space");
  await confirmation.press("Tab");
  const queue = screen.getByRole("button", "Köa vald cykel för granskning", { exact: true });
  await expect(queue).toBeFocused();

  const catchUpPath = `${path}/scheduling/catch-up`;
  const keys: string[] = [];
  let lost = false;
  await browser.route(catchUpPath, async (route) => {
    keys.push(route.request.headers["idempotency-key"] ?? "");

    if (lost) {
      await route.continue();

      return;
    }

    const response = await fetch(route.request.url, {
      method: route.request.method,
      headers: { ...route.request.headers, cookie, origin },
      body: route.request.postData ?? undefined,
    });

    expect(response.status).toBe(200);
    lost = true;
    await route.abort();
  });
  await queue.press("Enter");
  const retry = screen.getByRole("button", "Försök igen med exakt begäran", { exact: true });
  await expect(retry).toBeVisible();
  await app.screenshot("recurring-response-lost-320");
  await browser.reload();
  await expect(retry).toBeVisible();
  await retry.press("Enter");
  await expect(retry).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe("");
  expect(keys[1]).toBe(keys[0]);

  await expect
    .poll(
      async () => (await scheduling()).history.filter((job) => job.state === "drafted").length,
      { timeout: 30000 },
    )
    .toBe(1);
  const recovered = await scheduling();
  const completed = recovered.history.filter((job) => job.state === "drafted");
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ cycleOrdinal: "1", generation: "2" });
  const draftId = completed[0]?.draftId;

  if (!draftId) throw new Error("The recovered cycle must link its actual draft");

  await browser.reload();
  await screen.getByRole("link", /Cykel 1, .*Utkast skapat/).press("Enter");
  const review = screen.getByRole("link", "Granska utkast", { exact: true });
  await expect(review).toHaveAttribute(
    "href",
    `${new URL(workspace).pathname}/sales?view=drafts&record=${encodeURIComponent(draftId)}`,
  );
  await app.screenshot("recurring-recovered-history-320");
  await review.press("Enter");
  await expect(screen.getByRole("button", "Redigera utkast", { exact: true })).toBeVisible();
  await expect(
    screen.getByText("Inte utfärdad. Granska fakturan innan utfärdande.", { exact: true }),
  ).toBeVisible();
  expect(await browser.url()).toContain(`record=${draftId}`);
  await app.screenshot("recurring-review-draft-320");
  await agent.assert(
    "The recovered recurring invoice is a reviewable draft. The page says it has not been issued and requires review before issuance.",
  );

  const draftResponse = await fetch(`${base}/commerce/invoice-drafts/${draftId}`, {
    headers: { cookie, origin },
  });

  expect(draftResponse.status).toBe(200);
  const draft = Schema.decodeUnknownSync(Drafts.InvoiceDraftView)(await draftResponse.json());
  expect(draft.record).toMatchObject({
    id: draftId,
    status: "draft",
    issued: false,
    recognized: false,
    delivered: false,
    occurrence: { agreementId: fixture.agreementId, cycleOrdinal: "1" },
    totals: { baseMinor: "3003", netMinor: "3005", taxMinor: null, grossMinor: null },
  });
  const occurrencesResponse = await fetch(`${path}/occurrences`, { headers: { cookie, origin } });
  expect(occurrencesResponse.status).toBe(200);

  const occurrences = Schema.decodeUnknownSync(Recurring.RecurringOccurrenceList)(
    await occurrencesResponse.json(),
  );

  expect(occurrences.items).toHaveLength(1);
  expect(occurrences.items[0]?.draftId).toBe(draftId);
  await writeFile(
    join(output, "recurring-recovery-results.json"),
    JSON.stringify(
      { fixture, before, recovered, draft, occurrences, sameCommandKey: keys[0] === keys[1] },
      null,
      2,
    ),
  );
});
