import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Source from "@open-erp/contracts/source-intake";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import { decoded, environment, fixture, key } from "./support/fixtures";
import { withWorkspaceBrowser } from "./support/workspace-browser";

test("explicit supplier originals open beyond page one and retain scoped read failures", async () => {
  const book = await fixture();

  await withWorkspaceBrowser(book, "supplier-inbox-selection", async (page, workspace) => {
    const api = `${new URL(workspace).origin}${book.path}`;
    const retained: Array<typeof Source.SourceOccurrence.Type> = [];

    for (let ordinal = 0; ordinal < 22; ordinal += 1) {
      retained.push(
        await decoded(
          await fetch(`${api}/source-occurrences`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${book.token}`,
              "content-type": "application/json",
              "idempotency-key": key(),
            },
            body: JSON.stringify({
              destination: "supplier_inbox",
              sourceSystem: "inbox_selection_fixture",
              sourceAccountId: "supplier_originals",
              occurrenceKey: key(),
              sourceRevision: "1",
              filename: `selection-original-${String(ordinal).padStart(2, "0")}.txt`,
              mediaType: "text/plain",
              contentBase64: Buffer.from(`Synthetic supplier selection ${ordinal}`).toString(
                "base64",
              ),
            }),
          }),
          Source.SourceOccurrence,
        ),
      );
    }

    const first = await decoded(
      await fetch(`${api}/commerce/supplier-inbox`, {
        headers: { authorization: `Bearer ${book.token}` },
      }),
      Inbox.SupplierInboxPage,
    );

    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));
    const selected = retained.toSorted((a, b) => (a.id < b.id ? -1 : 1)).at(-1)!;

    expect(first.items.some((item) => item.occurrence.occurrence.id === selected.id)).toBe(false);
    const selectedUrl = `${workspace}/purchases?view=supplier-drafts&occurrence=${selected.id}`;
    const detailUrl = `${api}/commerce/supplier-inbox/${selected.id}`;

    await page.goto(selectedUrl);
    await page
      .getByText(`${selected.filename} · upload · Awaiting review`, { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Close original", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("occurrence")).toBe(null);

    await page.getByRole("button", { name: "Upload original", exact: true }).click();
    await page.getByLabel("Document", { exact: true }).setInputFiles({
      name: "uploaded-selection.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic original uploaded through the supplier inbox"),
    });

    const uploadedResponse = page.waitForResponse(
      (response) =>
        response.url() === `${api}/source-occurrences` && response.request().method() === "POST",
    );

    await page.getByRole("button", { name: "Save original", exact: true }).click();
    const uploaded = await uploadedResponse;

    expect(uploaded.status()).toBe(200);
    const uploadedId = (await uploaded.json()).id;

    await expect.poll(() => new URL(page.url()).searchParams.get("occurrence")).toBe(uploadedId);
    await page
      .getByText("uploaded-selection.txt · upload · Awaiting review", { exact: true })
      .last()
      .waitFor();
    await page.getByRole("button", { name: "Close original", exact: true }).click();

    let registrationWrites = 0;
    page.on("request", (request) => {
      if (request.url() === `${api}/commerce/supplier-inbox` && request.method() === "POST")
        registrationWrites += 1;
    });
    const missingId = "source_missing_inbox_selection";

    const missingResponse = page.waitForResponse(
      (response) => response.url() === `${api}/commerce/supplier-inbox/${missingId}`,
    );

    await page.goto(`${workspace}/purchases?view=supplier-drafts&occurrence=${missingId}`);
    const missing = await missingResponse;

    expect(missing.status()).toBe(404);
    expect((await missing.json()).code).toBe("NotFound");
    await page.getByText("NotFound", { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get("occurrence")).toBe(missingId);
    await page.getByRole("button", { name: "Close original", exact: true }).click();

    await page.route(detailUrl, (route) => route.abort("failed"));
    await page.goto(selectedUrl);
    await page.getByText("Could not load records. Try again.", { exact: true }).waitFor();
    expect(await page.getByText("NotFound", { exact: true }).count()).toBe(0);
    expect(new URL(page.url()).searchParams.get("occurrence")).toBe(selected.id);
    await page.getByRole("button", { name: "Close original", exact: true }).click();
    await page.unroute(detailUrl);

    await page.route(detailUrl, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify(
          new Accounting.AccountingError({
            code: "Forbidden",
            message: "Synthetic inbox selection denied",
            recovery: Accounting.failureRecovery("Forbidden"),
          }),
        ),
      }),
    );
    await page.goto(selectedUrl);
    await page.getByText("Forbidden", { exact: true }).waitFor();
    await page.getByText("Synthetic inbox selection denied", { exact: true }).waitFor();
    expect(await page.getByText("NotFound", { exact: true }).count()).toBe(0);
    expect(new URL(page.url()).searchParams.get("occurrence")).toBe(selected.id);
    await page.getByRole("button", { name: "Close original", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("occurrence")).toBe(null);
    expect(registrationWrites).toBe(0);

    await writeFile(
      join(environment().artifacts, "supplier-inbox-selection.json"),
      JSON.stringify(
        {
          scope: { entityId: book.entityId, bookId: book.bookId },
          retainedCount: 22,
          firstPageCount: 20,
          selectedOutsideFirstPage: selected.id,
          uploadedOccurrence: uploadedId,
          missing: { id: missingId, status: 404, code: "NotFound", closeAvailable: true },
          networkError: { retained: true, closeAvailable: true },
          forbidden: { status: 403, code: "Forbidden", retained: true, closeAvailable: true },
          automaticRegistrationWrites: 0,
          finalUrl: page.url(),
        },
        null,
        2,
      ),
    );
  });
}, 120000);
