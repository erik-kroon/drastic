import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Commerce from "../../packages/contracts/src/commerce";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Inbox from "../../packages/contracts/src/supplier-inbox";
import * as Drafts from "../../packages/contracts/src/supplier-invoice-drafts";
import * as Workspace from "../../packages/contracts/src/workspace";
import * as Acceptance from "../../packages/contracts/src/supplier-acceptance";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";
import { twoPageOriginal } from "./original-fixture";

for (const changed of [false, true]) {
  test(`a selected supplier review ${changed ? "keeps its original after a newer draft" : "posts against its uploaded original"}`, async ({
    app,
    browser,
    screen,
    agent,
  }) => {
    const output = process.env.OPENERP_E2E_OUTPUT;

    if (!output) throw new Error("Use the disposable browser launcher");

    const workspace = await signInSyntheticOperator(browser, app.baseUrl);
    const origin = new URL(workspace).origin;
    const base = workspace.replace(origin, `${origin}/api/v1`);

    const cookie = (await browser.cookies())
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");

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

      return Schema.decodeSync(Schema.fromJsonString(schema))(await response.text());
    };

    const filename = changed
      ? `Vinter & Co AB faktura 883-${randomUUID()}.pdf`
      : "Vinter & Co AB faktura 882.pdf";

    const bytes = twoPageOriginal([
      `Vinter & Co AB, invoice ${changed ? "883" : "882"}`,
      "Total SEK 12500.00",
    ]);

    const expectedHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const file = join(output, filename);

    await writeFile(file, bytes);
    await app.open(`${workspace}/purchases?view=supplier-drafts`);
    await expect(screen.getByRole("button", "Ladda upp original")).toBeVisible({ timeout: 90000 });
    await screen.getByRole("button", "Ladda upp original", { exact: true }).click();
    await expect(screen.getByLabel("Dokument", { exact: true })).toBeVisible();
    await screen.getByLabel("Dokument", { exact: true }).setInputFiles(file);

    const upload = browser.waitForResponse("**/source-occurrences");

    await screen.getByRole("button", "Spara original", { exact: true }).click();

    const uploaded = await upload;

    expect(uploaded.status).toBe(200);

    const occurrence = Schema.decodeUnknownSync(Source.SourceOccurrence)(await uploaded.json());

    expect(occurrence.sha256).toBe(expectedHash);

    const entry = await call("/evidence", Accounting.Evidence, {
      title: filename,
      origin: "Local synthetic frozen review qualification",
      mediaType: "application/json",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: occurrence.id, sha256: expectedHash, filename },
      }),
    });

    const party = await call("/commerce/counterparties", Commerce.CounterpartyRevision, {
      kind: "synthetic_counterparty_v1",
      externalKey: `frozen_${randomUUID()}`,
      role: "supplier",
      displayName: "Vinter & Co AB",
      evidenceId: entry.id,
      reason: "Local synthetic qualification",
    });

    const identity = {
      legalName: "Synthetic identity",
      registrationId: "SYNTHETIC",
      taxId: null,
      address: "Synthetic address",
      countryCode: "SE",
      evidenceId: entry.id,
    };

    const content = {
      title: filename,
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      supplier: identity,
      buyer: identity,
      sourceEvidenceId: entry.id,
      supplierDocumentNumber: changed ? "883" : "882",
      currency: "SEK",
      currencyScale: 2,
      documentDate: "2026-10-03",
      supplyDate: "2026-10-03",
      dueDate: "2026-10-14",
      paymentTerms: "Synthetic terms",
      sourceTotalMinor: "1250000",
      lines: [
        {
          id: "line_frozen_source",
          description: "Synthetic gross cost",
          quantity: "1",
          unitPriceMinor: "1250000",
          baseMinor: "1250000",
          discountMinor: "0",
          chargeMinor: "0",
          taxMinor: "0",
          taxDescription: "Synthetic no tax treatment",
          taxEvidenceId: entry.id,
          sourceGrossMinor: "1250000",
        },
      ],
    } satisfies typeof Drafts.SupplierDraftContent.Type;

    const handoff = await call(
      `/commerce/supplier-inbox/${occurrence.id}/review`,
      Inbox.SupplierInboxReview,
      {
        draft: { draftKey: `frozen_${randomUUID()}`, content },
        reviewReason: "Independently inspected original",
        reviewAttemptId: null,
      },
    );

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
        reason: "Local synthetic reviewed original",
        acknowledgeSyntheticOnly: true,
      },
    );

    const reviewPath = `/commerce/supplier-acceptance-reviews/${plan.id}`;
    const before = await call("/ledger", Accounting.LedgerSnapshot);
    let replacement: typeof Drafts.SupplierInvoiceDraftRevision.Type | null = null;

    if (changed) {
      const newer = await call("/source-occurrences", Source.SourceOccurrence, {
        sourceSystem: "synthetic-review",
        sourceAccountId: "supplier",
        occurrenceKey: randomUUID(),
        sourceRevision: "2",
        filename: "newer-original.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from("Newer original must not replace the sealed review").toString(
          "base64",
        ),
      });

      const newerEvidence = await call("/evidence", Accounting.Evidence, {
        title: "Newer supplier original",
        origin: "Synthetic changed revision",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "supplier_invoice_source_v1",
          source: { occurrenceId: newer.id, sha256: newer.sha256, filename: newer.filename },
        }),
      });

      replacement = await call(
        `/commerce/supplier-invoice-drafts/${handoff.draft.id}/revisions`,
        Drafts.SupplierInvoiceDraftRevision,
        {
          expectedRevision: handoff.draft.revision,
          expectedDigest: handoff.draft.digest,
          reason: "Synthetic new original",
          content: {
            ...content,
            sourceEvidenceId: newerEvidence.id,
            supplierDocumentNumber: "NEWER-REVISION",
          },
        },
      );
    }

    const purchasesQuery = {
      view: "supplier-drafts",
      record: handoff.draft.id,
      review: plan.id,
      q: filename,
      filename,
      currency: "SEK",
    };

    const purchasesUrl = `${workspace}/purchases?${new URLSearchParams(purchasesQuery).toString()}`;

    await app.open(purchasesUrl);
    await expect(screen.getByRole("link", "Granska", { exact: true })).toBeVisible();
    await screen.getByRole("link", "Granska", { exact: true }).focus();
    await screen.getByRole("link", "Granska", { exact: true }).press("Enter");
    await expect(screen.getByRole("heading", /^Granska: [0-9]+ kvar$/)).toBeVisible();

    const focusedUrl = new URL(await browser.url());
    const ownerReturn = focusedUrl.searchParams.get("returnTo");

    expect(ownerReturn?.startsWith("owner:")).toBe(true);
    expect(JSON.parse(decodeURIComponent(ownerReturn?.slice(6) ?? ""))).toEqual({
      owner: "purchases",
      search: purchasesQuery,
    });

    await browser.reload();
    await expect(screen.getByRole("link", "Inköp /", { exact: true })).toBeVisible();
    await screen.getByRole("link", "Inköp /", { exact: true }).focus();
    await screen.getByRole("link", "Inköp /", { exact: true }).press("Enter");
    await expect
      .poll(async () => {
        const returned = new URL(await browser.url());

        return {
          path: returned.pathname,
          search: Object.fromEntries(returned.searchParams),
        };
      })
      .toEqual({ path: new URL(purchasesUrl).pathname, search: purchasesQuery });
    await expect(screen.getByRole("link", "Granska", { exact: true })).toBeVisible();

    const workQuery = { q: filename, kind: "journal", status: "open", sort: "newest" };
    const workUrl = `${workspace}/work?${new URLSearchParams(workQuery).toString()}`;

    await app.open(workUrl);

    const workQueue = await call(
      `/attention?${new URLSearchParams(workQuery).toString()}`,
      Workspace.AttentionPage,
    );

    if (changed) {
      expect(workQueue.items.some((item) => item.id === plan.postingPlan.id)).toBe(false);
      expect(workQueue.counts.open).toBe("0");
      await expect(screen.getByRole("link", filename, { exact: true })).toHaveCount(0);
      await expect(
        screen.getByRole("heading", "Inget i den här vyn", { exact: true }),
      ).toBeVisible();
    } else {
      await expect(screen.getByRole("link", filename, { exact: true })).toBeVisible();
      await screen.getByRole("link", filename, { exact: true }).focus();
      await screen.getByRole("link", filename, { exact: true }).press("Enter");
      await expect(screen.getByRole("heading", "Granska: 1 kvar", { exact: true })).toBeVisible();
      await browser.reload();
      await expect(screen.getByRole("link", "Att göra /", { exact: true })).toBeVisible();
      await screen.getByRole("link", "Att göra /", { exact: true }).focus();
      await screen.getByRole("link", "Att göra /", { exact: true }).press("Enter");
      await expect
        .poll(async () => {
          const returned = new URL(await browser.url());

          return {
            path: returned.pathname,
            search: Object.fromEntries(returned.searchParams),
          };
        })
        .toEqual({ path: new URL(workUrl).pathname, search: workQuery });
      await expect(screen.getByRole("link", filename, { exact: true })).toBeVisible();
    }

    expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);

    await app.open(purchasesUrl);
    await expect(screen.getByRole("link", "Granska", { exact: true })).toBeVisible();
    await screen.getByRole("link", "Granska", { exact: true }).focus();
    await screen.getByRole("link", "Granska", { exact: true }).press("Enter");
    await expect(screen.getByRole("heading", /^Granska: [0-9]+ kvar$/)).toBeVisible();
    expect(plan.draftSnapshot.totals.grossMinor).toBe("1250000");
    await expect(
      screen.getByRole("heading", "12\u00a0500,00 att betala", { exact: true }),
    ).toBeVisible();
    expect(
      await browser.evaluate(() =>
        Array.from(document.querySelectorAll("main section[aria-label='Beslut'] h2"))
          .filter((heading) => heading.textContent === "12\u00a0500,00 att betala")
          .map((heading) => heading.tagName),
      ),
    ).toEqual(["H2"]);
    await expect(screen.getByRole("region", "Beslut", { exact: true })).toContainText(
      `Vinter & Co AB, faktura ${content.supplierDocumentNumber}`,
    );
    const originalRecovery: Array<{ fault: string; code: string; screenshot: string }> = [];

    if (!changed) {
      const session = process.env.OPENERP_E2E_SESSION;

      if (!session || !basename(dirname(session)).startsWith("openerp-paper-"))
        throw new Error("Original recovery requires the disposable native launcher");

      const object = join(
        dirname(session),
        "objects",
        "v1",
        occurrence.scope.bookId,
        expectedHash.slice(7),
      );

      const backup = `${object}.dra194-backup`;

      expect(await readFile(object)).toEqual(bytes);

      for (const fault of ["missing", "corrupt"]) {
        await rename(object, backup);

        try {
          if (fault === "corrupt")
            await writeFile(object, Buffer.alloc(bytes.length, 120), { flag: "wx" });

          const missing = await fetch(`${base}/source-occurrences/${occurrence.id}`, {
            headers: { cookie, origin },
            signal: AbortSignal.timeout(20000),
          });

          expect(missing.status).toBe(422);

          const refusal = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(
            await missing.text(),
          );

          expect(refusal.code).toBe("MissingEvidence");
          await browser.reload();
          await expect(
            screen.getByRole("button", "Försök läsa originalet igen", { exact: true }),
          ).toBeVisible();
          await expect(screen.getByRole("img", `${filename}, sida 1`)).toHaveCount(0);

          const failed = await call(reviewPath, Acceptance.SupplierAcceptanceView);

          expect(failed.plan).toEqual(plan);
          expect(failed.approval).toBeNull();
          expect(failed.acceptance).toBeNull();
          expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);

          const failureScreenshot = await app.screenshot(`original-${fault}-read`);

          originalRecovery.push({ fault, code: refusal.code, screenshot: failureScreenshot });
        } finally {
          await rm(object, { force: true });
          await rename(backup, object);
        }

        await screen.getByRole("button", "Försök läsa originalet igen", { exact: true }).focus();
        await screen
          .getByRole("button", "Försök läsa originalet igen", { exact: true })
          .press("Enter");
        await expect(screen.getByRole("img", `${filename}, sida 1`)).toBeVisible({
          timeout: 30000,
        });

        const restored = await call(
          `/source-occurrences/${occurrence.id}`,
          Source.SourceOccurrenceView,
        );

        expect(restored.occurrence.sha256).toBe(expectedHash);
        expect(Buffer.from(restored.contentBase64, "base64")).toEqual(bytes);
        expect(await readFile(object)).toEqual(bytes);
        expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
      }
    }

    await expect(screen.getByRole("img", `${filename}, sida 1`)).toBeVisible({ timeout: 30000 });

    const originalConditions = await browser.evaluate(async () => {
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

    const originalScreenshot = await app.screenshot(
      changed ? "invoice-original-stale" : "invoice-original-ready",
    );

    await expect(screen.getByRole("combobox", "Sida", { exact: true })).toHaveCount(1);
    await screen.getByRole("combobox", "Sida", { exact: true }).click();
    await screen.getByRole("option", "2 av 2", { exact: true }).click();
    await expect(screen.getByRole("img", `${filename}, sida 2`)).toBeVisible();
    await screen.getByText("Sidtext", { exact: true }).click();
    await expect(screen.getByText("Total SEK 12500.00", { exact: true })).toBeVisible();
    await agent.assert(
      "The selected review has one original document pane showing page two beside the proposed accounting decision. Return only the configured JSON judgment. Do not infer any posting.",
      { timeout: 30000 },
    );

    if (!changed)
      await expect(
        screen.getByRole(
          "checkbox",
          "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
          { exact: true },
        ),
      ).not.toBeChecked();

    const screenshot = await app.screenshot(
      changed ? "frozen-original-stale-review" : "frozen-original-ready-review",
    );

    const nativeL2Screenshot = changed ? null : await app.screenshot("native-focused-l2-ready");

    if (changed) {
      await expect(screen.getByRole("button", "Attestera bokföring", { exact: true })).toHaveCount(
        0,
      );
      await expect(screen.getByRole("img", "newer-original.txt, sida 1")).toHaveCount(0);
      expect((await call(reviewPath, Acceptance.SupplierAcceptanceView)).dependenciesCurrent).toBe(
        false,
      );
      expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);
    } else {
      await screen
        .getByRole(
          "checkbox",
          "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
          { exact: true },
        )
        .check();
      await screen.getByRole("button", "Attestera bokföring", { exact: true }).focus();
      await screen.getByRole("button", "Attestera bokföring", { exact: true }).press("Enter");
      await expect(
        screen.getByRole("button", "Bokför och registrera", { exact: true }),
      ).toBeEnabled();
      await screen
        .getByRole("form")
        .filter({ has: screen.getByRole("button", "Bokför och registrera", { exact: true }) })
        .getByRole("checkbox")
        .check();
      await screen.getByRole("button", "Bokför och registrera", { exact: true }).focus();
      await screen.getByRole("button", "Bokför och registrera", { exact: true }).press("Enter");
      await expect
        .poll(
          async () =>
            (await call(reviewPath, Acceptance.SupplierAcceptanceView)).acceptance !== null,
        )
        .toBe(true);
    }

    const view = await call(reviewPath, Acceptance.SupplierAcceptanceView);
    const after = await call("/ledger", Accounting.LedgerSnapshot);

    expect(view.plan.draftSnapshot.sourceEvidence.evidenceId).toBe(entry.id);
    expect(view.plan.draftSnapshot.revision).toBe(handoff.draft.revision);

    if (view.acceptance) {
      expect(view.acceptance.draftDigest).toBe(handoff.draft.digest);
      expect(view.acceptance.postingReceipt.changeSetId).toBe(plan.postingPlan.id);
      expect(BigInt(after.sequence) - BigInt(before.sequence)).toBe(1n);
    }

    let postedCapture: { screenshot: string; conditions: typeof originalConditions } | null = null;

    if (view.acceptance) {
      const voucher = await call(
        `/vouchers/${view.acceptance.postingReceipt.voucherId}`,
        Accounting.Voucher,
      );

      expect(
        voucher.action.evidenceRefs.some((reference) => reference.evidenceId === entry.id),
      ).toBe(true);
      expect(voucher.action.lines.map((line) => [line.debitMinor, line.creditMinor])).toEqual([
        ["1250000", "0"],
        ["0", "1250000"],
      ]);
      await app.open(
        `${workspace}/books?${new URLSearchParams({ view: "vouchers", q: voucher.action.description })}`,
      );
      await expect(
        screen.getByRole("heading", voucher.action.description, { exact: true }),
      ).toBeVisible();
      await screen.getByRole("button", "Granska sparat underlag", { exact: true }).focus();
      await screen.getByRole("button", "Granska sparat underlag", { exact: true }).press("Enter");
      await expect(screen.getByRole("img", `${filename}, sida 1`)).toBeVisible({ timeout: 30000 });

      const conditions = {
        ...originalConditions,
        ...(await browser.evaluate(async () => {
          await document.fonts.ready;

          return {
            time: new Date().toISOString(),
            resolvedRoute: `${window.location.pathname}${window.location.search}`,
          };
        })),
      };

      const postedScreenshot = await app.screenshot("posted-voucher-original");

      postedCapture = { screenshot: postedScreenshot, conditions };
      await browser.reload();
      await expect(
        screen.getByRole("heading", voucher.action.description, { exact: true }),
      ).toBeVisible();
      await screen.getByRole("button", "Granska sparat underlag", { exact: true }).click();
      await expect(screen.getByRole("img", `${filename}, sida 1`)).toBeVisible({ timeout: 30000 });
      expect(await call(`/vouchers/${voucher.id}`, Accounting.Voucher)).toEqual(voucher);
      expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(after);
    }

    await writeFile(
      join(
        output,
        changed ? "supplier-frozen-original-stale.json" : "supplier-frozen-original-posted.json",
      ),
      JSON.stringify(
        {
          synthetic: true,
          fixtureProfile: plan.profile,
          occurrence,
          expectedHash,
          draft: handoff.draft.id,
          selectedReviewId: plan.id,
          replacementRevision: replacement?.revision ?? null,
          view,
          before,
          after,
          screenshot,
          originalRecovery,
          postedCapture,
          originalConditions,
          originalScreenshot,
          nativeL2Screenshot,
          returnContext: { purchasesQuery, workQuery },
          supersededReviewExcluded: changed
            ? !workQueue.items.some((item) => item.id === plan.postingPlan.id)
            : null,
        },
        null,
        2,
      ),
    );
  });
}
