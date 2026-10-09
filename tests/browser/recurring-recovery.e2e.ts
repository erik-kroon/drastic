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
  await app.open(`${workspace}/sales?view=recurring`);
  await expect(screen.getByText("Automatiska utkast aktiva", { exact: true })).toBeVisible();
  await expect(screen.getByText(before.nextCycleDate, { exact: true })).toBeVisible();
  await screen.getByRole("link", fixture.title, { exact: true }).press("Enter");
  await expect(screen.getByRole("heading", "Fakturacykler", { exact: true })).toBeVisible();
  await expect(screen.getByText("Inga skapade fakturacykler", { exact: true })).toBeVisible();
  await app.screenshot("recurring-directory-and-empty-occurrences");
  await browser.setViewport({ width: 320, height: 900 });
  await app.open(`${workspace}/work?kind=recurring&status=open`);
  await screen.getByRole("link", fixture.title, { exact: true }).press("Enter");
  await expect(screen.getByRole("heading", fixture.title, { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Cykelhistorik", { exact: true })).toBeVisible();
  await agent.act(
    "Fill the textbox named Orsak with 'Granskat aktuellt avtalsunderlag'. Verify that the textbox retains that text.",
  );
  await expect(screen.getByRole("textbox", "Orsak", { exact: true })).toHaveValue(
    "Granskat aktuellt avtalsunderlag",
  );
  await screen.getByRole("textbox", "Orsak", { exact: true }).press("Tab");
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

  await app.open(`${workspace}/sales?view=recurring&record=${fixture.agreementId}&cycle=1`);
  await expect(screen.getByRole("heading", "Fakturacykler", { exact: true })).toBeVisible();
  await expect(screen.getByText("Förberedd: Nej", { exact: true })).toBeVisible();
  await expect(screen.getByText("Godkänd: Nej", { exact: true })).toBeVisible();
  await expect(screen.getByText("Utfärdad: Nej", { exact: true })).toBeVisible();
  await expect(
    screen.getByText("Ingen fakturerad täckning för denna cykel.", { exact: true }),
  ).toBeVisible();
  await app.screenshot("recurring-occurrence-review-320");
  await screen
    .getByLabel("Orsak till schemaläggning", { exact: true })
    .fill("Pausa automatiken efter granskning");
  await screen.getByRole("checkbox", "Bekräfta schemaläggningsbeslut", { exact: true }).check();
  await screen.getByRole("button", "Pausa automatiska utkast", { exact: true }).press("Enter");
  await expect.poll(async () => (await scheduling()).enabled).toBe(false);
  await browser.reload();
  await expect(screen.getByText(/Automatiska utkast: Pausade/)).toBeVisible();
  await screen
    .getByLabel("Orsak till schemaläggning", { exact: true })
    .fill("Återuppta utan att utfärda fakturor");
  await screen.getByRole("checkbox", "Bekräfta schemaläggningsbeslut", { exact: true }).check();
  await screen.getByRole("button", "Återuppta automatiska utkast", { exact: true }).press("Enter");
  await expect.poll(async () => (await scheduling()).enabled).toBe(true);

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

  const revisionResponse = await fetch(`${base}/commerce/invoice-drafts/${draftId}/revisions`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "idempotency-key": `historical_preview_${draftId}`,
    },
    body: JSON.stringify({
      expectedRevision: draft.record.revision,
      expectedDigest: draft.record.digest,
      reason: "Synthetic historical preview regression",
      ...("commercialInput" in draft.record
        ? { commercial: { ...draft.record.commercialInput, note: "Revised saved preview" } }
        : { content: { ...draft.record.content, note: "Revised saved preview" } }),
    }),
  });

  expect(revisionResponse.status).toBe(200);

  const revised = Schema.decodeUnknownSync(Drafts.InvoiceDraftRevision)(
    await revisionResponse.json(),
  );

  expect(revised.revision).toBe("2");
  await browser.reload();
  await screen.getByText("Versionshistorik", { exact: true }).click();
  await screen.getByRole("button", /^Version 1,/).click();
  await expect(
    screen.getByText(
      "Du visar en tidigare sparad version. Öppna senaste versionen före ett nytt utfärdandebeslut.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Granska faktura", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Redigera utkast", { exact: true })).toBeDisabled();
  await app.screenshot("recurring-historical-preview-refuses-issuance");
  await screen.getByRole("button", "Visa senaste", { exact: true }).click();
  await expect(screen.getByRole("button", "Granska faktura", { exact: true })).toBeVisible();

  const occurrencesResponse = await fetch(`${path}/occurrences`, { headers: { cookie, origin } });
  expect(occurrencesResponse.status).toBe(200);

  const occurrences = Schema.decodeUnknownSync(Recurring.RecurringOccurrenceList)(
    await occurrencesResponse.json(),
  );

  expect(occurrences.items).toHaveLength(1);
  expect(occurrences.items[0]?.draftId).toBe(draftId);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open(`${workspace}/sales?view=recurring`);
  await screen.getByText("Skapa återkommande avtal", { exact: true }).click();
  await agent.act(
    `Create a recurring agreement for the saved customer '${draft.record.counterparty.displayName}'. Set Avtalsnamn to 'Synthetic future agreement', Startdatum to 2026-12-01, Tidszon to Europe/Stockholm, Intervalltyp to Månader, Antal månader eller dagar to 1, Månadsregel to Startdag limited to month end, Första cykelnummer to 1 and Orsak to 'Synthetic future billing review'. Click Spara avtal. Do not issue invoices.`,
  );
  await expect(screen.getByRole("link", "Öppna sparat avtal", { exact: true })).toBeVisible();
  await screen.getByRole("link", "Öppna sparat avtal", { exact: true }).click();

  const createdId = new URL(await browser.url()).searchParams.get("record");

  if (!createdId) throw new Error("Saved agreement identity must remain in the route");
  await expect(
    screen.getByText("Automatiska utkast är inte schemalagda för avtalet.", { exact: true }),
  ).toBeVisible();
  await screen.getByText("Ändra framtida fakturering", { exact: true }).click();
  await screen.getByText("Ändra intervall och startdatum", { exact: true }).click();
  await agent.act(
    "Change the future schedule: Gäller från cykel is 2, Startdatum 2027-01-01, Första cykelnummer 2, interval 1 month, Europe/Stockholm. Use Orsak 'Reviewed future cadence' in this schedule form, then Spara framtida schema. Do not change template or issue invoices.",
  );
  await expect(screen.getByText("Schema 2, från cykel 2: Månader", { exact: true })).toBeVisible();
  await screen.getByText("Ändra intervall och startdatum", { exact: true }).click();
  await screen.getByText("Ny framtida mallrevision", { exact: true }).click();

  const templateResponse = browser.waitForResponse(
    `**/commerce/recurring-invoices/${createdId}/template-revisions`,
  );

  await agent.act(
    `Select the saved recurring invoice draft for '${draft.record.counterparty.displayName}' in Sparat fakturautkast. In the future template form set Gäller från cykel to 1, Debiteringskomponenter to 'service_base', Utfärdande days to 0, Leveransdatum days to 0, Förfallodatum days to 30 and Orsak to 'Reviewed saved template'. Save with Spara framtida mallrevision. Do not issue invoices or start automation.`,
  );

  const template = Schema.decodeUnknownSync(Recurring.RecurringTemplateRevision)(
    await (await templateResponse).json(),
  );

  expect(template).toMatchObject({
    effectiveFromCycle: "1",
    chargeComponentKeys: ["service_base"],
    template: { dateOffsets: { issueDays: "0", supplyDays: "0", dueDays: "30" } },
  });
  expect(template.template.lines).toEqual(
    revised.purpose === "commercial" ? revised.commercialInput.lines : revised.content.lines,
  );
  await expect(
    screen.getByText("Mall 1, från cykel 1: service_base", { exact: true }),
  ).toBeVisible();
  await browser.reload();
  await screen.getByText("Ändra framtida fakturering", { exact: true }).click();
  await expect(screen.getByText("Schema 2, från cykel 2: Månader", { exact: true })).toBeVisible();
  await expect(
    screen.getByText("Mall 1, från cykel 1: service_base", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Inga skapade fakturacykler", { exact: true })).toBeVisible();
  await screen.getByLabel("Första automatiska cykel", { exact: true }).fill("1");
  await screen
    .getByLabel("Orsak till schemaläggning", { exact: true })
    .fill("Reviewed future draft scheduling");
  await screen.getByRole("checkbox", "Bekräfta första automatiska cykel", { exact: true }).check();
  await screen.getByRole("button", "Aktivera automatiska utkast", { exact: true }).click();

  await expect(screen.getByText(/Automatiska utkast: Aktiva/)).toBeVisible();

  const schedulingResponse = await fetch(
    `${base}/commerce/recurring-invoices/${createdId}/scheduling`,
    { headers: { cookie, origin } },
  );

  expect(schedulingResponse.status).toBe(200);

  const createdScheduling = Schema.decodeUnknownSync(Recurring.RecurringScheduling)(
    await schedulingResponse.json(),
  );

  expect(createdScheduling).toMatchObject({
    agreementId: createdId,
    enabled: true,
    firstAutomaticCycle: "1",
    nextCycleDate: "2027-01-01",
    history: [],
  });
  await browser.reload();
  await expect(screen.getByText(/Automatiska utkast: Aktiva/)).toBeVisible();
  await app.screenshot("recurring-create-schedule-template-retained");

  await writeFile(
    join(output, "recurring-recovery-results.json"),
    JSON.stringify(
      {
        fixture,
        before,
        recovered,
        draft,
        revised,
        occurrences,
        template,
        createdScheduling,
        sameCommandKey: keys[0] === keys[1],
      },
      null,
      2,
    ),
  );
});
