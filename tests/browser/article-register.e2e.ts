import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Catalog from "../../packages/contracts/src/catalog";
import * as Commerce from "../../packages/contracts/src/commerce";
import * as Drafts from "../../packages/contracts/src/invoice-drafts";
import * as Workspace from "../../packages/contracts/src/workspace";
import { signInSyntheticOperator } from "./synthetic-session";

test("article edit and archive retain immutable defaults, honest unknowns and aligned register lanes", async ({
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

  const commercePath = `${scopePath}/commerce`;
  const articlesPath = `${commercePath}/articles`;
  const metadata = await call(`${scopePath}/work`, Workspace.WorkPage);
  const books = await call("/books", Schema.Array(Accounting.Book));

  const book = books.find(
    (item) => item.entityId === metadata.scope.entityId && item.id === metadata.scope.bookId,
  );

  expect(book).toMatchObject({ currency: "SEK", role: "operator" });
  expect(metadata.currencyScale).toBe(2);
  const beforeLedger = await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot);
  const beforeInvoices = await call(`${commercePath}/invoices`, Commerce.InvoicePage);
  const beforeDrafts = await call(`${commercePath}/invoice-drafts`, Drafts.InvoiceDraftList);

  const beforeSourceRecords = await Promise.all(
    beforeDrafts.items.map(
      async (draft) =>
        (await call(`${commercePath}/invoice-drafts/${draft.id}`, Drafts.InvoiceDraftView)).record,
    ),
  );

  const inputA: typeof Catalog.SaveArticle.Type = {
    code: "SYNTHETIC-ARTICLE-REVIEW",
    expectedRevision: 0,
    description: "Synthetic article for review",
    unit: "st",
    unitPriceMinor: "12345",
    taxDescription: null,
    treatment: { kind: "unresolved" },
    status: "active",
  };

  const inputB: typeof Catalog.SaveArticle.Type = {
    code: "SYNTHETIC-ARTICLE-INDEPENDENT",
    expectedRevision: 0,
    description: "Synthetic independent article",
    unit: "tim",
    unitPriceMinor: "6789",
    taxDescription: null,
    treatment: { kind: "unresolved" },
    status: "active",
  };

  const articleA = await call(
    articlesPath,
    Catalog.Article,
    Schema.encodeSync(Catalog.SaveArticle)(inputA),
  );

  const articleB = await call(
    articlesPath,
    Catalog.Article,
    Schema.encodeSync(Catalog.SaveArticle)(inputB),
  );

  const revision = (code: string, value: number) =>
    call(`${articlesPath}/${encodeURIComponent(code)}/revisions/${value}`, Catalog.Article);

  const current = async (code: string) => {
    const page = await call(`${articlesPath}?status=all`, Catalog.ArticlePage);
    const article = page.items.find((item) => item.code === code);

    if (!article) throw new Error(`The saved synthetic article ${code} is missing`);

    return article;
  };

  expect(articleA).toMatchObject({
    code: "SYNTHETIC-ARTICLE-REVIEW",
    revision: 1,
    description: "Synthetic article for review",
    unit: "st",
    unitPriceMinor: "12345",
    taxDescription: null,
    treatment: { kind: "unresolved" },
    status: "active",
  });
  expect(articleB).toMatchObject({
    revision: 1,
    unitPriceMinor: "6789",
    treatment: { kind: "unresolved" },
    status: "active",
  });
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open(`${workspace}/sales?view=articles`);
  const table = screen.getByRole("table", "Aktuella artikelrevisioner", { exact: true });

  const opener = table.getByRole(
    "button",
    "Synthetic article for review, SYNTHETIC-ARTICLE-REVIEW",
    {
      exact: true,
    },
  );

  const row = table.getByRole("row", /SYNTHETIC-ARTICLE-REVIEW/);

  await expect(opener).toBeVisible();
  await expect(
    table.getByRole("button", "Synthetic independent article, SYNTHETIC-ARTICLE-INDEPENDENT", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(row.getByRole("cell", "st", { exact: true })).toBeVisible();
  await expect(row.getByRole("cell", "123,45", { exact: true })).toBeVisible();
  const missingTax = row.getByRole("cell", "Okänd", { exact: true });
  const missingAccount = row.getByRole("cell", "Saknas", { exact: true });

  await expect(missingTax).toBeVisible();
  await expect(missingAccount).toBeVisible();

  const lanes = [
    { name: "Enhet", cell: row.getByRole("cell", "st", { exact: true }), width: 90 },
    { name: "Moms", cell: missingTax, width: 80 },
    { name: "Pris", cell: row.getByRole("cell", "123,45", { exact: true }), width: 120 },
    { name: "Intäktskonto", cell: missingAccount, width: 110 },
  ];

  const geometry = [];

  for (const lane of lanes) {
    const header = await table.getByRole("columnheader", lane.name, { exact: true }).boundingBox();
    const cell = await lane.cell.boundingBox();

    if (!header || !cell) throw new Error(`The actual article ${lane.name} lane is not measurable`);

    expect(header.width).toBe(lane.width);
    expect(cell.width).toBe(lane.width);
    expect(header.x).toBe(cell.x);
    geometry.push({ name: lane.name, header, cell });
  }

  const before = await app.screenshot("article-register-stored-values-desktop");
  const dialog = screen.getByRole("dialog", "Uppdatera artikel", { exact: true });

  await opener.press("Enter");
  await screen.getByRole("button", "Redigera artikel", { exact: true }).press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", "Kod", { exact: true })).toHaveValue(
    "SYNTHETIC-ARTICLE-REVIEW",
  );
  await expect(dialog.getByRole("textbox", "Kod", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("textbox", "Beskrivning", { exact: true })).toHaveValue(
    "Synthetic article for review",
  );
  await expect(dialog.getByRole("textbox", "Enhet", { exact: true })).toHaveValue("st");
  await expect(dialog.getByRole("textbox", "Enhetspris (SEK)", { exact: true })).toHaveValue(
    "123.45",
  );
  await expect(
    dialog.getByRole("textbox", "Momsbehandling (valfritt)", { exact: true }),
  ).toHaveValue("");
  await expect(dialog.getByRole("combobox", "Granskad momsprofil", { exact: true })).toContainText(
    "Ej fastställd",
  );
  await dialog
    .getByRole("textbox", "Beskrivning", { exact: true })
    .fill("Abandoned synthetic description");
  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await current(articleA.code)).toEqual(articleA);
  expect(await revision(articleA.code, 1)).toEqual(articleA);
  await browser.reload();
  await opener.press("Enter");
  await screen.getByRole("button", "Redigera artikel", { exact: true }).press("Enter");
  await expect(dialog.getByRole("textbox", "Beskrivning", { exact: true })).toHaveValue(
    "Synthetic article for review",
  );
  await dialog
    .getByRole("textbox", "Beskrivning", { exact: true })
    .fill("Synthetic reviewed article");
  await dialog.getByRole("textbox", "Enhet", { exact: true }).fill("tim");
  await dialog.getByRole("textbox", "Enhetspris (SEK)", { exact: true }).fill("234,56");
  await dialog.getByRole("button", "Spara ändring", { exact: true }).press("Enter");
  await expect(dialog.getByText("Artikelrevisionen har sparats.", { exact: true })).toBeVisible();
  const updated = await current(articleA.code);

  expect(updated).toMatchObject({
    revision: 2,
    description: "Synthetic reviewed article",
    unit: "tim",
    unitPriceMinor: "23456",
    taxDescription: null,
    treatment: { kind: "unresolved" },
    status: "active",
  });
  expect(await revision(articleA.code, 1)).toEqual(articleA);
  expect(await current(articleB.code)).toEqual(articleB);
  await browser.reload();

  const updatedOpener = table.getByRole(
    "button",
    "Synthetic reviewed article, SYNTHETIC-ARTICLE-REVIEW",
    {
      exact: true,
    },
  );

  await expect(updatedOpener).toBeVisible();
  await expect(row.getByRole("cell", "234,56", { exact: true })).toBeVisible();
  await expect(missingTax).toBeVisible();
  await expect(missingAccount).toBeVisible();
  const afterEdit = await app.screenshot("article-register-updated-values-desktop");

  await updatedOpener.press("Enter");
  await screen.getByRole("button", "Redigera artikel", { exact: true }).press("Enter");
  await expect(dialog.getByRole("textbox", "Enhetspris (SEK)", { exact: true })).toHaveValue(
    "234.56",
  );
  await expect(dialog.getByRole("combobox", "Granskad momsprofil", { exact: true })).toContainText(
    "Ej fastställd",
  );
  await dialog.getByRole("combobox", "Artikelstatus", { exact: true }).click();
  await screen.getByRole("option", "Arkiverad", { exact: true }).click();
  await dialog.getByRole("button", "Spara ändring", { exact: true }).click();
  await expect(dialog.getByText("Artikelrevisionen har sparats.", { exact: true })).toBeVisible();
  const archived = await current(articleA.code);

  expect(archived).toMatchObject({
    revision: 3,
    description: "Synthetic reviewed article",
    unit: "tim",
    unitPriceMinor: "23456",
    taxDescription: null,
    treatment: { kind: "unresolved" },
    status: "archived",
  });
  expect(await revision(articleA.code, 1)).toEqual(articleA);
  expect(await revision(articleA.code, 2)).toEqual(updated);
  const active = await call(articlesPath, Catalog.ArticlePage);

  expect(active.items.some((article) => article.code === articleA.code)).toBe(false);
  expect(active.items.find((article) => article.code === articleB.code)).toEqual(articleB);
  await browser.reload();
  await expect(updatedOpener).toContainText("Arkiverad");
  await expect(row.getByRole("cell", "234,56", { exact: true })).toBeVisible();
  await expect(missingTax).toBeVisible();
  await expect(missingAccount).toBeVisible();
  await browser.setViewport({ width: 400, height: 900 });
  expect(await browser.evaluate("() => document.documentElement.scrollWidth <= innerWidth")).toBe(
    true,
  );
  await updatedOpener.press("Enter");
  await screen.getByRole("button", "Redigera artikel", { exact: true }).press("Enter");
  await expect(dialog.getByRole("textbox", "Enhetspris (SEK)", { exact: true })).toHaveValue(
    "234.56",
  );
  await expect(dialog.getByRole("combobox", "Artikelstatus", { exact: true })).toContainText(
    "Arkiverad",
  );
  await agent.assert(
    "The article edit dialog is readable at this narrow width. The price is 234.56 SEK, the article is archived and its reviewed tax profile explicitly remains Ej fastställd. The UI does not claim a reviewed tax decision.",
  );
  await expect(dialog.getByRole("combobox", "Granskad momsprofil", { exact: true })).toContainText(
    "Ej fastställd",
  );
  const narrow = await app.screenshot("article-register-archived-review-400");

  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(updatedOpener).toBeFocused();
  expect(await current(articleA.code)).toEqual(archived);
  expect(await current(articleB.code)).toEqual(articleB);
  expect(await revision(articleB.code, 1)).toEqual(articleB);
  expect(await call(`${scopePath}/ledger`, Accounting.LedgerSnapshot)).toEqual(beforeLedger);
  expect(await call(`${commercePath}/invoices`, Commerce.InvoicePage)).toEqual(beforeInvoices);
  const afterDrafts = await call(`${commercePath}/invoice-drafts`, Drafts.InvoiceDraftList);

  expect(afterDrafts.items).toEqual(beforeDrafts.items);
  expect(afterDrafts.count).toBe(beforeDrafts.count);
  expect(afterDrafts.complete).toBe(beforeDrafts.complete);
  expect(afterDrafts.continuation).toBe(beforeDrafts.continuation);

  const afterSourceRecords = await Promise.all(
    beforeDrafts.items.map(
      async (draft) =>
        (await call(`${commercePath}/invoice-drafts/${draft.id}`, Drafts.InvoiceDraftView)).record,
    ),
  );

  expect(afterSourceRecords).toEqual(beforeSourceRecords);
  await writeFile(
    join(output, "article-register.json"),
    JSON.stringify(
      {
        qualification:
          "Actual public article edit/archive, immutable revisions, keyboard focus, current DOM geometry and Luna unknown-tax review",
        limits:
          "No dedicated article frame exists on current Paper page 00. No current pixel diff, reviewed tax decision, article revenue default or production qualification is claimed.",
        geometry,
        revenueColumn: { configuredLane: 110, trailingInset: 20, physicalWidth: 130 },
        articleA,
        articleB,
        updated,
        archived,
        beforeLedger,
        beforeInvoices,
        beforeDrafts,
        beforeSourceRecords,
        before,
        afterEdit,
        narrow,
      },
      null,
      2,
    ),
  );
});
