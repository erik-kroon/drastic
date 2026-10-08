import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Inbox from "../../packages/contracts/src/supplier-inbox";
import * as Workspace from "../../packages/contracts/src/workspace";
import * as Accounting from "../../packages/contracts/src/accounting";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";
import { twoPageOriginal } from "./original-fixture";

test("home retains the selected original and scoped keyboard return after reload", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${base}${path}`, {
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

    expect(response.status).toBe(200);

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  const before = await call("/ledger", Accounting.LedgerSnapshot);
  const originals = [];

  for (const filename of ["home-original-first.pdf", "home-original-selected.pdf"]) {
    const occurrence = await call("/source-occurrences", Source.SourceOccurrence, {
      sourceSystem: "synthetic-home-return",
      sourceAccountId: "synthetic_originals",
      occurrenceKey: randomUUID(),
      sourceRevision: "1",
      filename,
      mediaType: "application/pdf",
      contentBase64: twoPageOriginal().toString("base64"),
    });

    await call("/commerce/supplier-inbox", Inbox.SupplierInboxView, {
      occurrenceId: occurrence.id,
      channel: "upload",
      messageIdentity: null,
    });
    originals.push(occurrence);
  }

  const original = originals[1];

  if (!original) throw new Error("The selected original is required");

  const attention = await call("/attention?status=open&sort=oldest", Workspace.AttentionPage);
  const task = attention.items.find((item) => item.id === original.id)?.questionRoot;

  if (!task) throw new Error("The application must expose the retained task root");

  await app.open(`${workspace}/`);

  const row = screen.getByRole("button", /home-original-selected\.pdf/);

  await expect(row).toBeVisible();
  await row.focus();
  await row.press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("task"))
    .toBe(task.key);
  await browser.reload();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeFocused();

  const selectedScreenshot = await app.screenshot("home-selected-original-after-reload");

  await screen.getByRole("link", "Granska original", { exact: true }).click();
  await expect(screen.getByRole("img", `${original.filename}, sida 1`)).toBeVisible();

  const ownerReturn = new URL(await browser.url()).searchParams.get("returnTo");

  expect(ownerReturn).toBeTruthy();
  await screen.getByRole("link", "Tillbaka till arbetet", { exact: true }).focus();
  await screen.getByRole("link", "Tillbaka till arbetet", { exact: true }).press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).pathname)
    .toBe(new URL(workspace).pathname);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeFocused();
  await expect(screen.getByRole("img", `${original.filename}, sida 1`)).toBeVisible();
  await agent.assert(
    "The home work list has the selected original home-original-selected.pdf highlighted, with its retained original page available in the detail. Return the configured JSON judgment.",
    { timeout: 30000 },
  );

  const returnedScreenshot = await app.screenshot("home-returned-selected-original-focused");
  const missingTask = `document:${randomUUID()}`;

  await app.open(`${workspace}/?status=open&task=${encodeURIComponent(missingTask)}`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await expect(screen.getByRole("button", /home-original-first\.pdf/)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(screen.getByRole("heading", "Att göra", { exact: true })).toBeFocused();
  await expect(screen.getByRole("link", "Granska original", { exact: true })).toHaveCount(0);
  expect(new URL(await browser.url()).searchParams.get("task")).toBe(missingTask);

  const missingScreenshot = await app.screenshot("home-missing-root-heading-focused");

  const after = await call("/ledger", Accounting.LedgerSnapshot);

  expect(after).toEqual(before);
  await writeFile(
    join(output, "work-home-return.json"),
    JSON.stringify(
      {
        scope: "synthetic original home selection, reload and keyboard return only",
        original,
        task,
        ownerReturn,
        before,
        after,
        selectedScreenshot,
        returnedScreenshot,
        missingTask,
        missingScreenshot,
      },
      null,
      2,
    ),
  );
});
