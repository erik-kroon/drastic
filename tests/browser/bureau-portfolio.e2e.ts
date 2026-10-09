import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Firms from "../../packages/contracts/src/firms";
import * as Company from "../../packages/contracts/src/company-setup";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Workspace from "../../packages/contracts/src/workspace";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("native bureau portfolio retains fifty clients and scoped assignment filters", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${origin}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (response.status !== 200)
      throw new Error(`Synthetic ${path} returned ${response.status}: ${await response.text()}`);

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  const scopePath = new URL(workspace).pathname;
  const before = await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot);
  const actor = await call(`${scopePath}/workspace`, Workspace.Coordination);
  const firm = await call("/firms", Firms.CommandResult, { name: "Synthetic bureau scale" });
  const clients: Array<typeof Company.CompanySetup.Type> = [];

  for (let index = 1; index <= 50; index++) {
    const company = await call("/companies", Company.CompanySetup, {
      name: `Synthetic bureau ${String(index).padStart(3, "0")}`,
    });

    await call(`/firms/${firm.firmId}/clients`, Firms.CommandResult, {
      scope: company.scope,
      leadId: index % 2 === 1 ? actor.actorId : null,
      nextReviewOn: "2026-10-01",
      note: "Synthetic portfolio qualification only",
      expectedRevision: 0,
    });
    clients.push(company);
  }

  const initial = await call(`/firms/${firm.firmId}`, Firms.Workspace);

  expect(initial.clients).toHaveLength(50);
  expect(initial.clients.filter((client) => client.leadId === actor.actorId)).toHaveLength(25);

  const facts = await call(`/firms/${firm.firmId}/portfolio`, Schema.JsonObject);

  expect(facts.workspace).toEqual(initial);
  expect(facts.clients).toEqual(
    initial.clients.map((client) => ({
      scope: { entityId: client.book.entityId, bookId: client.book.id },
      company: clients.find((company) => company.scope.bookId === client.book.id),
      period: null,
      openTasks: null,
      deadlines: [],
      bank: null,
      bankObservations: [],
      bankInventorySignoffs: [],
      closing: null,
    })),
  );

  expect(typeof facts.observedFrom).toBe("string");
  expect(typeof facts.observedUntil).toBe("string");

  const portfolio = `${origin}/firms?firm=${firm.firmId}&tab=clients`;

  await app.open(portfolio);
  await expect(screen.getByRole("searchbox", "Sök klienter", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  const names = screen.getByRole("button", /^Synthetic bureau \d{3}$/);
  const observed: string[] = [];

  for (let page = 0; page < 4; page++) {
    await expect(names).toHaveCount(Math.min(15, 50 - page * 15));
    await expect(names.nth(0)).toHaveAttribute(
      "aria-label",
      `Synthetic bureau ${String(page * 15 + 1).padStart(3, "0")}`,
    );

    for (let index = 0; index < Math.min(15, 50 - page * 15); index++)
      observed.push((await names.nth(index).getAttribute("aria-label")) ?? "");

    if (page < 3) await screen.getByRole("button", "Nästa", { exact: true }).click();
  }

  expect(observed).toEqual(
    Array.from(
      { length: 50 },
      (_, index) => `Synthetic bureau ${String(index + 1).padStart(3, "0")}`,
    ),
  );
  await expect(screen.getByRole("button", "Nästa", { exact: true })).toBeDisabled();

  await expect(screen.getByText("15 per sida", { exact: true })).toBeVisible();
  await expect(screen.getByText("Sida 4 av 4", { exact: true })).toBeVisible();
  await expect(screen.getByText("46–50 av 50 klienter", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Föregående", { exact: true }).click();
  await expect(names).toHaveCount(15);
  await expect(names.nth(0)).toHaveAttribute("aria-label", "Synthetic bureau 031");
  await screen.getByRole("button", "Nästa", { exact: true }).click();
  await expect(names).toHaveCount(5);

  const lastPageScreenshot = await app.screenshot("bureau-fifty-clients-last-page");

  await screen.getByRole("searchbox", "Sök klienter", { exact: true }).fill("Synthetic bureau 00");
  await screen.getByRole("button", "Jag är ansvarig", { exact: true }).click();
  await expect(names).toHaveCount(5);
  await expect.poll(async () => new URL(await browser.url()).searchParams.get("view")).toBe("mine");
  await browser.reload();
  await expect(names).toHaveCount(5);
  await expect(screen.getByRole("searchbox", "Sök klienter", { exact: true })).toHaveValue(
    "Synthetic bureau 00",
  );

  const selected = screen.getByRole("button", "Synthetic bureau 001", { exact: true });
  const details = screen.getByRole("region", "Klientdetaljer", { exact: true });

  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(details).toContainText("Ingen period");
  await expect(details).toContainText("2026-10-01");
  await details.getByRole("button", "Byt ansvarig", { exact: true }).click();
  await screen.getByRole("combobox", "Klientansvarig", { exact: true }).click();
  await screen.getByRole("option", "Ingen ansvarig", { exact: true }).click();
  await screen.getByRole("button", "Spara klient", { exact: true }).click();
  await expect(names).toHaveCount(4);
  expect(
    await Promise.all([0, 1, 2, 3].map((index) => names.nth(index).getAttribute("aria-label"))),
  ).toEqual([
    "Synthetic bureau 003",
    "Synthetic bureau 005",
    "Synthetic bureau 007",
    "Synthetic bureau 009",
  ]);
  await expect(screen.getByRole("button", "Synthetic bureau 001", { exact: true })).toBeHidden();
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("q"))
    .toBe("Synthetic bureau 00");
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("firm"))
    .toBe(firm.firmId);
  const final = await call(`/firms/${firm.firmId}`, Firms.Workspace);
  const after = await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot);
  const first = clients[0];

  if (!first) throw new Error("The first independent client is required");

  expect(final.clients).toHaveLength(50);
  expect(final.clients.filter((client) => client.leadId === actor.actorId)).toHaveLength(24);
  const initialTarget = initial.clients.find((client) => client.book.id === first.scope.bookId);
  const finalTarget = final.clients.find((client) => client.book.id === first.scope.bookId);

  if (!initialTarget || !finalTarget) throw new Error("Both target revisions must be retained");

  expect(finalTarget.revision).toBeGreaterThan(initialTarget.revision);
  expect(finalTarget).toEqual({
    ...initialTarget,
    leadId: null,
    leadAvailable: false,
    revision: finalTarget.revision,
  });
  expect(final.clients.filter((client) => client.book.id !== first.scope.bookId)).toEqual(
    initial.clients.filter((client) => client.book.id !== first.scope.bookId),
  );
  expect(final.clients.map((client) => client.book)).toEqual(
    initial.clients.map((client) => client.book),
  );
  expect(after).toEqual(before);
  expect(final.clients.every((client) => client.book.sequence === "0")).toBe(true);

  await agent.assert(
    "Check the current visible portfolio only: the search contains Synthetic bureau 00, Jag är ansvarig is selected, and the four visible clients are Synthetic bureau 003, 005, 007 and 009. Synthetic bureau 001 is absent. Do not infer how the current state was reached; assignment persistence is checked separately through retained owner revisions. Return the configured JSON judgment.",
    { timeout: 30000, vision: true },
  );

  const assignedScreenshot = await app.screenshot("bureau-scoped-assignment-filter-retained");

  await writeFile(
    join(output, "bureau-portfolio.json"),
    JSON.stringify(
      {
        scope: "Native existing portfolio owner with fifty synthetic setup clients",
        limits:
          "Fifteen-row paging only, not full V1 composition/parity, statutory deadlines, access-request projection, permission revocation, stale-revision recovery or 200-client qualification. Company creation/linking are public-API fixture setup; browser pagination, filtering, reload and assignment are exercised.",
        firm: firm.firmId,
        observed,
        initial,
        facts,
        final,
        before,
        after,
        lastPageScreenshot,
        assignedScreenshot,
      },
      null,
      2,
    ),
  );
});
