import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Inbox from "../../packages/contracts/src/supplier-inbox";
import * as Workspace from "../../packages/contracts/src/workspace";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Commerce from "../../packages/contracts/src/commerce";
import * as Acceptance from "../../packages/contracts/src/supplier-acceptance";
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

    if (response.status !== 200) {
      throw new Error(`Synthetic ${path} returned ${response.status}: ${await response.text()}`);
    }

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  const before = await call("/ledger", Accounting.LedgerSnapshot);
  const originals: Array<typeof Source.SourceOccurrence.Type> = [];

  for (const filename of [
    ...Array.from({ length: 50 }, (_, index) => `home-page-first-${index}.pdf`),
    "home-original-first.pdf",
    "home-original-selected.pdf",
  ]) {
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

  const original = originals.at(-1);

  if (!original) throw new Error("The selected original is required");

  const attention = await call("/attention?status=open&sort=oldest", Workspace.AttentionPage);

  expect(attention.items).toHaveLength(50);
  expect(attention.next).not.toBeNull();
  const continuation = attention.next;

  if (!continuation) throw new Error("The retained originals require a second page");

  const secondPage = await call(
    `/attention?status=open&sort=oldest&after=${continuation}`,
    Workspace.AttentionPage,
  );

  const task = secondPage.items.find((item) => item.id === original.id)?.questionRoot;

  if (!task) throw new Error("The application must expose the retained task root");

  await app.open(`${workspace}/`);
  await expect(screen.getByRole("button", /home-original-selected\.pdf/)).toHaveCount(0);
  await screen.getByRole("link", "Nästa sida", { exact: true }).click();
  await expect
    .poll(async () => new URL(await browser.url()).pathname)
    .toBe(new URL(workspace).pathname);
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("after"))
    .toBe(continuation);

  const row = screen.getByRole("button", /home-original-selected\.pdf/);

  await expect(row).toBeVisible();
  await row.focus();
  await row.press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("task"))
    .toBe(task.key);
  await browser.reload();
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("after"))
    .toBe(continuation);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeFocused();

  const selectedHomeUrl = await browser.url();

  const reviewAll = screen.getByRole("link", "Granska alla", { exact: true });

  const reviewAllSearch = new URLSearchParams({
    status: "open",
    kind: "all",
    sort: "oldest",
    after: continuation,
  });

  await expect(reviewAll).toHaveAttribute(
    "href",
    `${new URL(workspace).pathname}/work?${reviewAllSearch}`,
  );

  const headerAction = await browser.evaluate(() => {
    const link = document.querySelector("main header a");
    const style = link ? getComputedStyle(link) : null;

    return {
      tag: link?.tagName ?? null,
      text: link?.textContent ?? null,
      height: style?.height ?? null,
      borderWidth: style?.borderTopWidth ?? null,
    };
  });

  expect(headerAction).toEqual({
    tag: "A",
    text: "Granska alla",
    height: "28px",
    borderWidth: "1px",
  });
  await reviewAll.focus();
  await expect(reviewAll).toBeFocused();
  await reviewAll.press("Enter");
  await expect
    .poll(async () => {
      const current = new URL(await browser.url());

      return { path: current.pathname, search: Object.fromEntries(current.searchParams) };
    })
    .toEqual({
      path: `${new URL(workspace).pathname}/work`,
      search: { status: "open", kind: "all", sort: "oldest", after: continuation },
    });
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
  await app.open(selectedHomeUrl);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeFocused();

  const previewHeader = () =>
    browser.evaluate(() => {
      const header = document.querySelector("main aside[aria-label='Nästa steg'] header");
      const figure = header?.querySelector("p");
      const title = header?.querySelector("h2");

      return {
        figure: figure?.textContent ?? null,
        title: title?.textContent ?? null,
        figureSize: figure ? getComputedStyle(figure).fontSize : null,
        figureWhiteSpace: figure ? getComputedStyle(figure).whiteSpace : null,
      };
    });

  await expect.poll(previewHeader).toEqual({
    figure: "Okänt",
    title: "home-original-selected.pdf",
    figureSize: "32px",
    figureWhiteSpace: "nowrap",
  });

  const selectedHeader = await previewHeader();

  const selectedConditions = await browser.evaluate(async () => {
    await document.fonts.ready;

    return {
      browser: navigator.userAgent,
      deviceScaleFactor: window.devicePixelRatio,
      fonts: {
        family: getComputedStyle(document.body).fontFamily,
        faces: Array.from(document.fonts).map((face) => ({
          family: face.family,
          weight: face.weight,
          status: face.status,
        })),
      },
      locale: navigator.language,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      time: new Date().toISOString(),
      clockPinned: false,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      resolvedRoute: `${window.location.pathname}${window.location.search}`,
    };
  });

  const selectedScreenshot = await app.screenshot("home-selected-original-after-reload");

  await browser.setViewport({ width: 375, height: 812 });

  const narrowGeometry = () =>
    browser.evaluate(() => {
      const row = document.querySelector("main ul button[aria-pressed='true']");
      const panel = document.querySelector("main aside[aria-label='Nästa steg']");

      if (!row || !panel) throw new Error("The selected work row and preview must be present");

      const rowBox = row.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const width = window.innerWidth;

      return {
        width,
        overflow: document.documentElement.scrollWidth > width,
        rowFits: rowBox.width > 0 && rowBox.left >= 0 && rowBox.right <= width + 1,
        panelFits: panelBox.width > 0 && panelBox.left >= 0 && panelBox.right <= width + 1,
        panelBelowRow: panelBox.top >= rowBox.bottom - 1,
      };
    });

  await expect.poll(narrowGeometry).toEqual({
    width: 375,
    overflow: false,
    rowFits: true,
    panelFits: true,
    panelBelowRow: true,
  });
  const narrow = await narrowGeometry();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  const narrowScreenshot = await app.screenshot("home-selected-original-narrow");
  await browser.setViewport({ width: 1440, height: 900 });

  await screen.getByRole("link", "Granska original", { exact: true }).click();
  await expect(screen.getByRole("img", `${original.filename}, sida 1`)).toBeVisible();

  const ownerReturn = new URL(await browser.url()).searchParams.get("returnTo");

  expect(ownerReturn).toBeTruthy();
  await screen.getByRole("link", "Tillbaka till arbetet", { exact: true }).focus();
  await screen.getByRole("link", "Tillbaka till arbetet", { exact: true }).press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).pathname)
    .toBe(new URL(workspace).pathname);
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("after"))
    .toBe(continuation);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeFocused();
  await expect(screen.getByRole("img", `${original.filename}, sida 1`)).toBeVisible();
  await agent.assert(
    "The home work list has the selected original home-original-selected.pdf highlighted, with its retained original page available in the detail. Return the configured JSON judgment.",
    { timeout: 30000, vision: true },
  );

  const returnedScreenshot = await app.screenshot("home-returned-selected-original-focused");

  const evidence = await call("/evidence", Accounting.Evidence, {
    title: "Synthetic home handoff original",
    origin: "Local canonical home qualification",
    mediaType: "application/json",
    content: JSON.stringify({
      kind: "supplier_invoice_source_v1",
      source: { occurrenceId: original.id, sha256: original.sha256, filename: original.filename },
    }),
  });

  const party = await call("/commerce/counterparties", Commerce.CounterpartyRevision, {
    kind: "synthetic_counterparty_v1",
    externalKey: `home_${randomUUID()}`,
    role: "supplier",
    displayName: "Synthetic home supplier",
    evidenceId: evidence.id,
    reason: "Synthetic handoff fixture",
  });

  const identity = {
    legalName: "Synthetic home identity",
    registrationId: "5560000000",
    taxId: null,
    address: "Synthetic street 1",
    countryCode: "SE",
    evidenceId: evidence.id,
  };

  const handoff = await call(
    `/commerce/supplier-inbox/${original.id}/review`,
    Inbox.SupplierInboxReview,
    {
      draft: {
        draftKey: `home_${randomUUID()}`,
        content: {
          title: "Synthetic selected home draft",
          counterpartyId: party.id,
          counterpartyRevision: party.revision,
          supplier: identity,
          buyer: identity,
          sourceEvidenceId: evidence.id,
          supplierDocumentNumber: "HOME-001",
          currency: "SEK",
          currencyScale: 2,
          documentDate: "2026-10-03",
          supplyDate: "2026-10-03",
          dueDate: "2026-10-14",
          paymentTerms: "Synthetic terms",
          sourceTotalMinor: "10000",
          lines: [
            {
              id: "synthetic_service",
              description: "Synthetic service",
              quantity: "1",
              unitPriceMinor: "10000",
              baseMinor: "10000",
              discountMinor: "0",
              chargeMinor: "0",
              taxMinor: "0",
              taxDescription: "Synthetic zero tax",
              taxEvidenceId: evidence.id,
              sourceGrossMinor: "10000",
            },
          ],
        },
      },
      reviewReason: "Synthetic public API handoff, not approval or posting",
      reviewAttemptId: null,
    },
  );

  const handedOffAttention = await call(
    `/attention?status=open&sort=oldest&after=${continuation}`,
    Workspace.AttentionPage,
  );

  const stage = handedOffAttention.items.find((item) => item.id === handoff.draft.id);

  expect(stage?.questionRoot).toEqual(task);
  expect(
    handedOffAttention.items.filter((item) => item.questionRoot?.key === task.key),
  ).toHaveLength(1);
  expect(handedOffAttention.total).toBe(attention.total);
  await app.open(
    `${workspace}/?status=open&after=${continuation}&task=${encodeURIComponent(task.key)}`,
  );

  const draftRow = screen.getByRole("button", /Synthetic selected home draft/);

  await expect(draftRow).toHaveAttribute("aria-pressed", "true");
  await expect(draftRow).toBeFocused();
  await expect(row).toHaveCount(0);
  await browser.reload();
  await expect(draftRow).toHaveAttribute("aria-pressed", "true");
  await expect(draftRow).toBeFocused();

  await expect.poll(previewHeader).toEqual({
    figure: "100,00",
    title: "Synthetic selected home draft",
    figureSize: "32px",
    figureWhiteSpace: "nowrap",
  });

  const handoffHeader = await previewHeader();

  const handoffScreenshot = await app.screenshot("home-same-root-new-supplier-stage");
  const missingTask = `document:${randomUUID()}`;

  await app.open(
    `${workspace}/?status=open&after=${continuation}&task=${encodeURIComponent(missingTask)}`,
  );
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toHaveAttribute("aria-pressed", "false");
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

  const plan = await call(
    "/commerce/supplier-acceptance-reviews",
    Acceptance.SupplierAcceptanceReview,
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: handoff.draft.id,
      expectedRevision: handoff.draft.revision,
      expectedDigest: handoff.draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_bank",
      accountingPeriodId: "period_synthetic_2026",
      series: "A",
      reason: "Synthetic completed-history qualification",
      acknowledgeSyntheticOnly: true,
    },
  );

  const approval = await call(
    `/commerce/supplier-acceptance-reviews/${plan.id}/approvals`,
    Acceptance.SupplierAcceptanceApproval,
    { version: plan.version, digest: plan.digest, acknowledgeSyntheticOnly: true },
  );

  const receipt = await call(
    `/commerce/supplier-acceptance-reviews/${plan.id}/execute`,
    Acceptance.SupplierAcceptanceReceipt,
    {
      version: plan.version,
      digest: plan.digest,
      approvalId: approval.id,
      acknowledgeSyntheticOnly: true,
    },
  );

  const completedAttention = await call(
    "/attention?status=completed&sort=oldest",
    Workspace.AttentionPage,
  );

  const completedStage = completedAttention.items.find((item) => item.id === handoff.draft.id);

  if (!completedStage) throw new Error("The registered supplier stage must remain readable");

  expect(completedStage.questionRoot).toEqual(task);
  expect(
    completedAttention.items.filter((item) => item.questionRoot?.key === task.key).length,
  ).toBeGreaterThan(1);
  await app.open(`${workspace}/?status=completed&task=${encodeURIComponent(task.key)}`);

  const completedRow = screen
    .getByRole("button", /Synthetic selected home draft/)
    .filter({ hasText: "Leverantörsfaktura registrerad" });

  await expect(completedRow).toBeVisible();
  await completedRow.focus();
  await completedRow.press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("stage"))
    .toBe(completedStage.key);
  await expect(completedRow).toHaveAttribute("aria-pressed", "true");
  await browser.reload();
  await expect(completedRow).toHaveAttribute("aria-pressed", "true");
  await expect(completedRow).toBeFocused();

  const completedScreenshot = await app.screenshot("home-exact-completed-supplier-stage-focused");

  const postedStage = completedAttention.items.find((item) => item.id === plan.postingPlan.id);

  if (!postedStage) throw new Error("The posted native journal stage must remain readable");

  expect(postedStage.questionRoot).toEqual(task);

  const postedRow = screen
    .getByRole("button", /Synthetic selected home draft/)
    .filter({ hasText: "Bokfört" });

  await postedRow.focus();
  await postedRow.press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("stage"))
    .toBe(postedStage.key);
  await expect(postedRow).toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("link", "Bokfört", { exact: true }).click();
  await expect(screen.getByRole("status").filter({ hasText: "Bokförd" })).toBeVisible();
  await screen.getByRole("link", "Att göra /", { exact: true }).focus();
  await screen.getByRole("link", "Att göra /", { exact: true }).press("Enter");
  await expect
    .poll(async () => new URL(await browser.url()).searchParams.get("stage"))
    .toBe(postedStage.key);
  await expect(postedRow).toHaveAttribute("aria-pressed", "true");
  await expect(postedRow).toBeFocused();

  const postedReturnScreenshot = await app.screenshot("home-returned-exact-posted-stage-focused");

  await app.open(
    `${workspace}/?status=completed&task=${encodeURIComponent(task.key)}&stage=document_unavailable_stage`,
  );
  await expect(completedRow).toHaveAttribute("aria-pressed", "false");
  await expect(postedRow).toHaveAttribute("aria-pressed", "false");
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await expect(screen.getByRole("heading", "Att göra", { exact: true })).toBeFocused();

  const missingStageScreenshot = await app.screenshot(
    "home-unavailable-completed-stage-heading-focused",
  );

  const otherRoot = attention.items.find((item) => item.id === originals[0]?.id)?.questionRoot;

  if (!otherRoot) throw new Error("The independent original root is required");

  await app.open(
    `${workspace}/?status=completed&task=${encodeURIComponent(otherRoot.key)}&stage=${encodeURIComponent(postedStage.key)}`,
  );
  await expect(completedRow).toHaveAttribute("aria-pressed", "false");
  await expect(postedRow).toHaveAttribute("aria-pressed", "false");
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await expect(screen.getByRole("heading", "Att göra", { exact: true })).toBeFocused();

  const mismatchedStageScreenshot = await app.screenshot("home-other-root-stage-refused");

  const afterCompletion = await call("/ledger", Accounting.LedgerSnapshot);

  expect(BigInt(afterCompletion.sequence) - BigInt(before.sequence)).toBe(1n);
  expect(
    afterCompletion.accounts.map(({ accountId, debitMinor, creditMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
    })),
  ).toEqual([
    { accountId: "account_bank", debitMinor: "10000", creditMinor: "0" },
    { accountId: "account_clearing", debitMinor: "0", creditMinor: "10000" },
  ]);
  await writeFile(
    join(output, "work-home-return.json"),
    JSON.stringify(
      {
        scope:
          "synthetic original and completed supplier stage selection, reload and keyboard return",
        original,
        pagination: { continuation, first: attention, second: secondPage },
        task,
        ownerReturn,
        before,
        after,
        selectedHeader,
        headerAction,
        reviewAllKeyboardNavigation: true,
        handoffHeader,
        selectedConditions,
        selectedScreenshot,
        narrow,
        narrowScreenshot,
        returnedScreenshot,
        handoff,
        stage,
        handoffScreenshot,
        missingTask,
        missingScreenshot,
        plan,
        approval,
        receipt,
        completedStage,
        completedScreenshot,
        postedStage,
        postedReturnScreenshot,
        missingStageScreenshot,
        otherRoot,
        mismatchedStageScreenshot,
        afterCompletion,
      },
      null,
      2,
    ),
  );
});
