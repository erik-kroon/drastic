import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Firms from "../../packages/contracts/src/firms";
import * as Accounting from "../../packages/contracts/src/accounting";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("grouped portfolio keeps pending access metadata separate through edit, revoke and firm changes", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const scopePath = new URL(workspace).pathname;
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

  const before = await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot);
  const firm = await call("/firms", Firms.CommandResult, { name: "Synthetic grouped bureau" });
  const other = await call("/firms", Firms.CommandResult, { name: "Synthetic other bureau" });
  const portfolioUrl = `/firms?firm=${firm.firmId}&tab=clients`;

  await browser.setViewport({ width: 1440, height: 900 });
  await app.open(portfolioUrl);
  await screen.getByRole("button", "Begär åtkomst", { exact: true }).click();

  const dialog = screen.getByRole("dialog");

  await dialog
    .getByRole("textbox", "Klientens namn", { exact: true })
    .fill("Synthetic pending client");
  await dialog
    .getByRole("textbox", "Organisationsnummer (valfritt)", { exact: true })
    .fill("5599999999");
  await dialog.getByRole("button", "Begär åtkomst", { exact: true }).click();
  await expect(dialog).toBeHidden();

  const row = screen.getByRole("button", "Synthetic pending client", { exact: true });
  const details = screen.getByRole("region", "Klientdetaljer", { exact: true });

  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByRole("heading", /^Åtkomst att följa upp/)).toBeVisible();
  await expect(details).toContainText("Åtkomst begärd");
  await expect(details.getByText("5599999999", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", /^Öppna /)).toHaveCount(0);
  await expect(details.getByText("Bankavstämning", { exact: true })).toHaveCount(0);
  await expect(details.getByText("Inga tekniska hinder", { exact: true })).toHaveCount(0);

  const created = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);

  expect(created.clients).toEqual([]);
  expect(created.workspace.clients).toEqual([]);
  expect(created.workspace.accessRequests).toHaveLength(1);
  expect(created.workspace.accessRequests[0]).toMatchObject({
    clientName: "Synthetic pending client",
    organizationNumber: "5599999999",
    state: "requested",
  });

  const desktopDetail = await details.boundingBox();
  const desktopRow = await row.boundingBox();

  if (!desktopDetail || !desktopRow) throw new Error("The real portfolio geometry is missing");

  expect(desktopDetail.x).toBe(1020);
  expect(desktopDetail.y).toBe(48);
  expect(desktopDetail.width).toBe(420);
  expect(desktopRow.height).toBe(52);
  expect(desktopRow.y).toBe(128);

  const desktop = await app.screenshot("portfolio-pending-access-desktop");

  await details.getByRole("button", "Ändra förfrågan", { exact: true }).click();
  await dialog
    .getByRole("textbox", "Klientens namn", { exact: true })
    .fill("Synthetic revised client");
  await dialog.getByRole("button", "Spara förfrågan", { exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeHidden();

  const revisedRow = screen.getByRole("button", "Synthetic revised client", { exact: true });

  await revisedRow.click();
  await browser.reload();
  await expect(revisedRow).toBeVisible();
  await revisedRow.click();
  await expect(details).toContainText("Synthetic revised client");

  await screen
    .getByRole("searchbox", "Sök klienter", { exact: true })
    .fill("No matching synthetic client");
  await expect(revisedRow).toBeHidden();
  await expect(details.getByText("Synthetic revised client", { exact: true })).toHaveCount(0);
  await screen.getByRole("searchbox", "Sök klienter", { exact: true }).fill("");
  await revisedRow.click();

  await browser.setViewport({ width: 400, height: 900 });
  await expect(revisedRow).toBeVisible();
  expect(await browser.evaluate("() => document.documentElement.scrollWidth <= innerWidth")).toBe(
    true,
  );
  const narrow = await app.screenshot("portfolio-pending-access-narrow");

  await revisedRow.focus();
  await revisedRow.press("Enter");
  await expect(revisedRow).toHaveAttribute("aria-pressed", "true");

  const edit = details.getByRole("button", "Ändra förfrågan", { exact: true });

  await edit.focus();
  await edit.press("Enter");
  await expect(dialog).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await agent.assert(
    "The pending client's detail is readable at this narrow width and offers edit and revoke actions. It describes a local access request, without claiming granted book access, accounting facts or closing readiness.",
  );

  await app.open(`/firms?firm=${other.firmId}&tab=clients`);
  await expect(revisedRow).toBeHidden();
  await expect(details.getByText("Synthetic revised client", { exact: true })).toHaveCount(0);
  await app.open(portfolioUrl);
  await revisedRow.click();
  await details.getByRole("button", "Återkalla förfrågan", { exact: true }).click();
  await dialog.getByRole("button", "Återkalla förfrågan", { exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(revisedRow).toBeHidden();

  const final = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);
  const unchanged = await call(`/firms/${other.firmId}/portfolio`, Firms.Portfolio);

  expect(final.workspace.accessRequests).toHaveLength(1);
  expect(final.workspace.accessRequests[0]).toMatchObject({
    clientName: "Synthetic revised client",
    state: "revoked",
  });
  expect(final.workspace.accessRequests[0]?.revision).toBeGreaterThan(
    created.workspace.accessRequests[0]?.revision ?? 0,
  );
  expect(final.clients).toEqual([]);
  expect(final.workspace.clients).toEqual([]);
  expect(unchanged.workspace.accessRequests).toEqual([]);
  expect(await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot)).toEqual(before);

  await writeFile(
    join(output, "firm-portfolio-layout.json"),
    JSON.stringify(
      {
        scope: "Real grouped portfolio request UI with synthetic retained metadata",
        limits:
          "No external invitation, access grant, company acceptance or whole-screen pixel-parity qualification.",
        created,
        final,
        unchanged,
        before,
        desktop,
        desktopDetail,
        desktopRow,
        narrow,
      },
      null,
      2,
    ),
  );
});
