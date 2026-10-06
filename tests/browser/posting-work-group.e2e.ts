import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Drafts from "../../packages/contracts/src/supplier-invoice-drafts";
import * as Acceptance from "../../packages/contracts/src/supplier-acceptance";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";
import { seedWorkGroup } from "../../verification/paper/seed-work-group.mjs";

test("reviewed native group posts independent receipts and reloads retained results", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const workspace = await signInSyntheticOperator(browser, app.baseUrl);

  const origin = new URL(workspace).origin;

  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies())
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");

  const setupResponse = await fetch(`${base}/setup`, { headers: { cookie, origin } });

  const setup = Schema.decodeUnknownSync(Accounting.BookSetup)(await setupResponse.json());

  const period = setup.periods.find(
    (entry) => entry.startsOn <= "2026-10-03" && entry.endsOn >= "2026-10-03",
  );

  if (!period) throw new Error("Synthetic fixture needs the October accounting period");

  for (const [id, code] of [
    ["group_expense", "6110"],
    ["group_payable", "2440"],
    ["group_vat", "2641"],
  ] as const) {
    const matching = setup.accounts.filter((account) => account.code === code && account.active);

    if (matching.length !== 1 || matching[0]?.id !== id)
      throw new Error(
        "Work group requires the disposable PAPER_WORK_GROUP=1 fixture with unique active BAS 6110, 2440 and 2641 accounts",
      );
  }

  const fixture = await seedWorkGroup({ base, cookie, periodId: period.id });

  const views = fixture.candidates.map((value: unknown) =>
    Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceReview)(value),
  );

  const changed = Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceReview)(fixture.changed);

  const unfamiliar = Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceReview)(
    fixture.unfamiliar,
  );

  const beforeResponse = await fetch(`${base}/ledger`, { headers: { cookie, origin } });

  const before = Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await beforeResponse.json());

  const [first, second] = views;

  if (!first || !second) throw new Error("Group fixture requires two candidates");

  const lostKeys = new Map<string, string>();

  let originalExecutionReceipt: typeof Acceptance.SupplierAcceptanceReceipt.Type | null = null;

  const lostApprovalPath = `${base}/commerce/supplier-acceptance-reviews/${first.id}/approvals`;

  const lostExecutionPath = `${base}/commerce/supplier-acceptance-reviews/${second.id}/execute`;

  for (const path of [lostApprovalPath, lostExecutionPath]) {
    await browser.route(path, async (route) => {
      try {
        const response = await fetch(route.request.url, {
          method: route.request.method,
          headers: { ...route.request.headers, cookie, origin },
          body: route.request.postData ?? undefined,
        });

        expect(response.status).toBe(200);

        if (path === lostExecutionPath)
          originalExecutionReceipt = Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceReceipt)(
            await response.json(),
          );
      } finally {
        await route.abort();
        lostKeys.set(path, route.request.headers["idempotency-key"] ?? "");
      }
    });
  }

  await app.open(`${workspace}/`);

  await expect(screen.getByRole("heading", "Att göra", { exact: true })).toBeVisible({
    timeout: 90_000,
  });

  await screen.getByRole("button", "Granska i grupp", { exact: true }).click();

  for (const number of ["001", "002", "003"])
    await screen.getByRole("checkbox", `Tallvik grupp G-${number}`, { exact: true }).check();

  await agent.assert(
    "The group review shows three selected familiar supplier proposals with posting lines for Kontorsmaterial, Ingående moms and Leverantörsskulder. G-NEW requires individual review and its selection is disabled. Return only the configured JSON judgment.",
  );

  await expect(screen.getByRole("checkbox", "Tallvik grupp G-NEW", { exact: true })).toBeDisabled();

  const revisedResponse = await fetch(
    `${base}/commerce/supplier-invoice-drafts/${changed.draftSnapshot.id}/revisions`,
    {
      method: "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        expectedRevision: changed.draftSnapshot.revision,
        expectedDigest: changed.draftSnapshot.digest,
        reason: "Synthetic changed member qualification",
        content: { ...changed.draftSnapshot.content, title: "Tallvik ändrad G-003" },
      }),
    },
  );

  expect(revisedResponse.status).toBe(200);
  Schema.decodeUnknownSync(Drafts.SupplierInvoiceDraftRevision)(await revisedResponse.json());

  await expect(screen.getByRole("checkbox", "Tallvik grupp G-003", { exact: true })).toBeDisabled();

  await expect(
    screen.getByRole("checkbox", "Tallvik grupp G-003", { exact: true }),
  ).not.toBeChecked();

  await screen.getByRole("checkbox", "Tallvik grupp G-002", { exact: true }).click();
  await expect(screen.getByText("1 verifikation", { exact: true })).toBeVisible();
  await app.screenshot("native-work-group-selected-paper-fixture");
  await screen.getByRole("checkbox", "Tallvik grupp G-002", { exact: true }).click();

  await screen.getByRole("button", "Bokför 2 verifikationer", { exact: true }).click();

  await expect.poll(() => lostKeys.size).toBe(2);

  for (const path of [lostApprovalPath, lostExecutionPath]) await browser.unroute(path);

  await browser.route(lostApprovalPath, async (route) => {
    expect(route.request.headers["idempotency-key"]).toBe(lostKeys.get(lostApprovalPath));

    await route.continue();
  });

  await app.screenshot("native-work-group-interrupted-results");

  await browser.reload();

  await screen.getByRole("button", "Granska i grupp", { exact: true }).click();
  await expect(screen.getByText("Bokfört", { exact: true })).toHaveCount(1);
  await screen.getByRole("button", "Bokför 1 verifikation", { exact: true }).click();

  await expect(screen.getByText("Bokförd", { exact: true })).toHaveCount(2);

  await browser.unroute(lostApprovalPath);

  await app.screenshot("native-work-group-independent-results");

  await expect(
    screen.getByRole("heading", "2 verifikationer bokförda", { exact: true }),
  ).toBeVisible();

  await app.screenshot("native-work-group-l18-completed");

  const resultLayout = await browser.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');

    return Array.from(dialog?.querySelectorAll("div, span, a, button, h2") ?? [])
      .filter((element) => element.children.length === 0 && element.textContent?.trim())
      .map((element) => {
        const rect = element.getBoundingClientRect();

        const style = getComputedStyle(element);

        return {
          text: element.textContent?.trim(),
          tag: element.tagName,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          font: style.font,
          lineHeight: style.lineHeight,
          fontVariantNumeric: style.fontVariantNumeric,
          fontOpticalSizing: style.fontOpticalSizing,
        };
      });
  })`);

  await browser.reload();

  await screen.getByRole("button", "Granska i grupp", { exact: true }).click();

  await expect(screen.getByText("Bokförd", { exact: true })).toHaveCount(2);

  const receipts = [];

  for (const review of views) {
    const response = await fetch(`${base}/commerce/supplier-acceptance-reviews/${review.id}`, {
      headers: { cookie, origin },
    });

    const view = Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceView)(await response.json());
    expect(view.priorReviewedAcceptanceReceiptId).toBe(fixture.priorReceiptId);
    expect(view.acceptance?.postingReceipt.voucherId.length).toBeGreaterThan(0);
    expect(view.acceptance?.reviewDigest).toBe(review.digest);
    expect(view.approval?.ordinal).toBe(1);

    if (review.id === second.id) {
      if (!originalExecutionReceipt)
        throw new Error("Lost response was not committed by the native owner");

      expect(view.acceptance).toEqual(originalExecutionReceipt);
    }

    receipts.push(view.acceptance);
  }

  for (const review of [changed, unfamiliar]) {
    const response = await fetch(`${base}/commerce/supplier-acceptance-reviews/${review.id}`, {
      headers: { cookie, origin },
    });

    const view = Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceView)(await response.json());
    expect(view.approval).toBeNull();
    expect(view.acceptance).toBeNull();

    if (review.id === unfamiliar.id) expect(view.priorReviewedAcceptanceReceiptId).toBeNull();
  }

  const afterResponse = await fetch(`${base}/ledger`, { headers: { cookie, origin } });

  const after = Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await afterResponse.json());

  for (const [accountId, side, expected] of [
    ["group_expense", "debitMinor", "20000"],
    ["group_vat", "debitMinor", "5000"],
    ["group_payable", "creditMinor", "25000"],
  ] as const) {
    const previous = before.accounts.find((account) => account.accountId === accountId);

    const current = after.accounts.find((account) => account.accountId === accountId);

    if (!previous || !current) throw new Error("Required fixture ledger account missing");

    expect((BigInt(current[side]) - BigInt(previous[side])).toString()).toBe(expected);
  }

  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable browser launcher");

  await writeFile(
    join(output, "work-group-results.json"),
    JSON.stringify(
      {
        expectedNetMinor: "20000",
        expectedTaxMinor: "5000",
        expectedGrossMinor: "25000",
        resultLayout,
        receipts,
      },
      null,
      2,
    ),
  );

  await app.screenshot("native-work-group-reloaded-results");

  const savedGroup = await browser.evaluate(() => {
    const identity = Object.keys(sessionStorage).find((key) =>
      key.includes("reviewed-supplier-group-v1"),
    );

    if (!identity) throw new Error("The actual group owner retained no request");

    const original = sessionStorage.getItem(identity);

    if (!original) throw new Error("Retained group request disappeared");

    return { identity, original };
  });

  let boundaryPosts = 0;

  const boundaryPath = `${base}/**`;

  await browser.route(boundaryPath, async (route) => {
    if (route.request.method === "POST") boundaryPosts += 1;

    await route.continue();
  });

  const witness = {
    reviewId: unfamiliar.id,
    digest: unfamiliar.digest,
    approvalKey: crypto.randomUUID(),
    executionKey: crypto.randomUUID(),
  };

  try {
    for (const scenario of [
      {
        name: "unique_maximum",
        size: Acceptance.workGroupSelectionLimit,
        duplicate: false,
        admitted: true,
      },
      {
        name: "unique_excess",
        size: Acceptance.workGroupSelectionLimit + 1,
        duplicate: false,
        admitted: false,
      },
      { name: "duplicate_review", size: 2, duplicate: true, admitted: false },
    ]) {
      const prefix = `group_bound_${crypto.randomUUID().replaceAll("-", "")}`;

      await browser.evaluate(
        (payload) => {
          const { identity, count, entry } = payload;

          sessionStorage.setItem(
            identity,
            JSON.stringify({
              key: crypto.randomUUID(),
              input: {
                entries: Array.from({ length: count }, (_, index) => ({
                  ...entry,
                  reviewId: payload.duplicate ? entry.reviewId : `${payload.prefix}_${index}`,
                  approvalKey: crypto.randomUUID(),
                  executionKey: crypto.randomUUID(),
                })),
              },
            }),
          );

          return null;
        },
        {
          identity: savedGroup.identity,
          count: scenario.size,
          entry: witness,
          prefix,
          duplicate: scenario.duplicate,
        },
      );

      const nativeRefusal = scenario.admitted
        ? browser.waitForResponse(`${base}/commerce/supplier-acceptance-reviews/${prefix}_0`, {
            timeout: 90_000,
          })
        : null;

      await browser.reload();
      await screen.getByRole("button", "Granska i grupp", { exact: true }).click();

      await expect(
        screen.getByText(scenario.admitted ? "Gruppbokning" : "Vald grupp", { exact: true }),
      ).toBeVisible();

      if (nativeRefusal) expect((await nativeRefusal).status).toBe(404);
      else
        await expect(
          screen.getByText("Kunde inte läsa in poster. Försök igen.", { exact: true }),
        ).toBeVisible();

      await expect(
        screen.getByRole("button", "Bokför 0 verifikationer", { exact: true }),
      ).toBeDisabled();

      expect(boundaryPosts).toBe(0);

      const response = await fetch(`${base}/ledger`, { headers: { cookie, origin } });

      expect(Schema.decodeUnknownSync(Accounting.LedgerSnapshot)(await response.json())).toEqual(
        after,
      );

      await app.screenshot(`native-work-group-retained-${scenario.name}`);
    }

    await writeFile(
      join(output, "work-group-retained-bound.json"),
      JSON.stringify(
        {
          maximum: Acceptance.workGroupSelectionLimit,
          admittedUniqueReviewIdCount: Acceptance.workGroupSelectionLimit,
          refusedUniqueReviewIdCount: Acceptance.workGroupSelectionLimit + 1,
          digestWitnessReviewId: unfamiliar.id,
          qualification: "unique_syntactic_identifiers_only_not_real_reviews_or_posted_vouchers",
          maximumWitnessNativeStatus: 404,
          duplicateReviewEntriesRefused: 2,
          financialPosts: boundaryPosts,
          ledgerUnchanged: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.unroute(boundaryPath);
    await browser.evaluate(({ identity, original }) => {
      sessionStorage.setItem(identity, original);

      return null;
    }, savedGroup);
  }
});
