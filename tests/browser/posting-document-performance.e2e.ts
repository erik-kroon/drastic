import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arch, platform, release } from "node:os";
import * as Schema from "effect/Schema";
import * as Accounting from "../../packages/contracts/src/accounting";
import { Version } from "../../packages/contracts/src/commerce";
import * as Sources from "../../packages/contracts/src/source-intake";
import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";
import { withDisposableBrowserDatabase } from "../../apps/api/tests/support/browser-database";

const baselineRevision = "32b0a4e394948748c3cb02af64dcab7c462f7653";

const warmups = 5;

const samples = 30;

const filename = "p03-performance-original.pdf";

const fixtureDate = "2026-10-03";

const pageText = "Independent performance original";

const measurementKey = "openerp-document-performance";

const Summary = Schema.Struct({
  durationsMs: Schema.Array(Schema.Finite),
  p50Ms: Schema.Finite,
  p95Ms: Schema.Finite,
});

const MeasuredPage = Schema.Struct({
  firstPageMs: Schema.Finite,
  decisionMs: Schema.Finite,
});

const MeasuredRow = Schema.Struct({
  visibleAtMs: Schema.Finite,
  wallAtVisibleMs: Schema.Finite,
});

const Attention = Schema.Struct({
  scope: Accounting.Scope,
  total: Schema.String,
  counts: Schema.Struct({ open: Schema.String, completed: Schema.String }),
  items: Schema.Array(
    Schema.Struct({ id: Accounting.Identifier, kind: Schema.String, title: Schema.String }),
  ),
});

type Observation = {
  trial: number;
  samplePhase: "warmup" | "measured";
} & (
  | { owner: "journal" | "supplier"; firstPageMs: number; decisionMs: number }
  | {
      owner: "intake";
      occurrenceId: string;
      commitAtMs: number;
      visibleAtMs: number;
      durationMs: number;
    }
);

type Trial = {
  owner: "journal" | "supplier" | "intake";
  trial: number;
  samplePhase: "warmup" | "measured";
  title: string;
  occurrenceId?: string;
};

function singlePageOriginal() {
  const stream = `BT /F1 14 Tf 30 250 Td (${pageText}) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const start = Buffer.byteLength(body);

  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;

  return Buffer.from(body);
}

function summarize(durationsMs: number[]) {
  expect(durationsMs).toHaveLength(samples);
  expect(durationsMs.every((duration) => Number.isFinite(duration) && duration > 0)).toBe(true);
  const ordered = durationsMs.toSorted((left, right) => left - right);

  return { durationsMs, p50Ms: ordered[14]!, p95Ms: ordered[28]! };
}

async function installMeasurements(browser: Browser) {
  await browser.addInitScript(`(() => {
      const original = ${JSON.stringify(filename)};
      const serialized = sessionStorage.getItem(${JSON.stringify(measurementKey)});

      if (!serialized) return;
      const input = JSON.parse(serialized);

      const result = {
        firstPageMs: null,
        decisionMs: null,
        visibleAtMs: null,
        wallAtVisibleMs: null,
      };

      Object.defineProperty(globalThis, "__openerpDocumentPerformance", { value: result });

      const visible = (element) => {
        const rectangle = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return (
          rectangle.width > 0 &&
          rectangle.height > 0 &&
          rectangle.bottom > 0 &&
          rectangle.right > 0 &&
          rectangle.top < innerHeight &&
          rectangle.left < innerWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };

      let scheduled = false;
      let firstPageReady = false;
      let decisionReady = false;
      let rowReady = false;

      const observer = new MutationObserver(() => schedule());

      const inspect = () => {
        scheduled = false;

        if (input.kind === "document") {
          const row = [...document.querySelectorAll("a")].find(
            (element) =>
              element.textContent?.trim() === input.filename &&
              element.href.includes(encodeURIComponent(input.occurrenceId)) &&
              visible(element),
          );

          if (row && rowReady) {
            result.visibleAtMs = performance.timeOrigin + performance.now();
            result.wallAtVisibleMs = Date.now();
            observer.disconnect();
          } else if (row) {
            rowReady = true;
            schedule();
          }

          return;
        }

        const page = [...document.querySelectorAll("canvas[role='img']")].find(
          (element) =>
            element.getAttribute("aria-label") === (original + ", sida 1") &&
            !element.hasAttribute("hidden") &&
            visible(element),
        );

        const acknowledgment = [
          ...document.querySelectorAll("input[type='checkbox']"),
        ].find(
          (element) =>
            [...(element.labels ?? [])].some(
              (label) => label.textContent?.trim() === input.acknowledgment,
            ) &&
            !element.matches(":disabled") &&
            visible(element),
        );

        const facts = document.body?.textContent ?? "";

        const decision =
          acknowledgment &&
          facts.includes(input.title) &&
          facts.includes("1930") &&
          facts.includes("2999") &&
          facts.includes("125,00");

        if (page && result.firstPageMs === null) {
          if (firstPageReady) result.firstPageMs = performance.now();
          else {
            firstPageReady = true;
            schedule();
          }
        }

        if (decision && result.decisionMs === null) {
          if (decisionReady) result.decisionMs = performance.now();
          else {
            decisionReady = true;
            schedule();
          }
        }

        if (result.firstPageMs !== null && result.decisionMs !== null) observer.disconnect();
      };

      function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(inspect);
      }

      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      schedule();
  })();`);
}

test("P03 and P04 retain comparable painted public-owner latency", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;
  const sessionFile = process.env.OPENERP_E2E_SESSION;
  const phase = process.env.OPENERP_DOCUMENT_PERFORMANCE_PHASE;
  const revision = process.env.OPENERP_DOCUMENT_PERFORMANCE_REVISION;

  if (!output || !sessionFile || (phase !== "baseline" && phase !== "head") || !revision)
    throw new Error("Use the serial disposable performance procedure and name the source revision");

  if (phase === "baseline" && revision !== baselineRevision)
    throw new Error("The comparable baseline must be the recorded genuine review owner");

  if (process.env.OPENERP_E2E_TRACK_COMMIT_TIMESTAMPS !== "1")
    throw new Error("Exact intake latency requires opt-in disposable commit timestamps");

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

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  await withDisposableBrowserDatabase(sessionFile, origin, async (client) => {
    const configured = await client.query("SHOW track_commit_timestamp");

    expect(configured.rows[0]?.track_commit_timestamp).toBe("on");

    const effects = async () =>
      (
        await client.query(
          `select (select count(*)::text from openerp.vouchers where book_id='book_synthetic') as vouchers,
        (select count(*)::text from openerp.journal_lines where book_id='book_synthetic') as lines,
        (select count(*)::text from openerp.execution_receipts where book_id='book_synthetic') as receipts`,
        )
      ).rows[0];

    const before = {
      ledger: await call("/ledger", Accounting.LedgerSnapshot),
      effects: await effects(),
    };

    const bytes = singlePageOriginal();
    const expectedHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const observations: Observation[] = [];
    let currentTrial: Trial | null = null;
    let complete = false;

    try {
      const source = await call("/source-occurrences", Sources.SourceOccurrence, {
        sourceSystem: "document-performance",
        sourceAccountId: "book_synthetic",
        occurrenceKey: "review_original",
        sourceRevision: "1",
        filename,
        mediaType: "application/pdf",
        contentBase64: bytes.toString("base64"),
      });

      expect(source.sha256).toBe(expectedHash);

      const evidence = await call("/evidence", Accounting.Evidence, {
        title: filename,
        origin: "Disposable single-page performance fixture",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "supplier_invoice_source_v1",
          source: {
            occurrenceId: source.id,
            sha256: source.sha256,
            filename,
          },
        }),
      });

      const journalTitle = "Syntetisk prestandajournal";

      const journal = await call("/change-sets", Accounting.ChangeSet, {
        kind: "manual_journal",
        evidenceId: evidence.id,
        eventKey: "document_performance_journal",
        accountingPeriodId: "period_synthetic_2026",
        postingDate: fixtureDate,
        series: "A",
        description: journalTitle,
        rationale: "Read-only original and decision timing",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_bank",
            debitMinor: "12500",
            creditMinor: "0",
            description: "Synthetic bank debit",
          },
          {
            accountId: "account_clearing",
            debitMinor: "0",
            creditMinor: "12500",
            description: "Synthetic clearing credit",
          },
        ],
      });

      const party = await call(
        "/commerce/counterparties",
        Schema.Struct({ id: Accounting.Identifier, revision: Version }),
        {
          kind: "synthetic_counterparty_v1",
          externalKey: "document_performance_supplier",
          role: "supplier",
          displayName: "Performance supplier",
          evidenceId: evidence.id,
          reason: "Disposable performance fixture",
        },
      );

      const identity = {
        legalName: "Performance supplier",
        registrationId: "SYNTHETIC",
        taxId: null,
        address: "Synthetic address",
        countryCode: "SE",
        evidenceId: evidence.id,
      };

      const draft = await call(
        "/commerce/supplier-invoice-drafts",
        Schema.Struct({
          id: Accounting.Identifier,
          revision: Version,
          digest: Accounting.Digest,
        }),
        {
          draftKey: "document_performance_supplier",
          content: {
            title: "Performance supplier",
            counterpartyId: party.id,
            counterpartyRevision: party.revision,
            supplier: identity,
            buyer: { ...identity, legalName: "Synthetic buyer" },
            sourceEvidenceId: evidence.id,
            supplierDocumentNumber: "PERF-001",
            currency: "SEK",
            currencyScale: 2,
            documentDate: fixtureDate,
            supplyDate: fixtureDate,
            dueDate: fixtureDate,
            paymentTerms: "Synthetic terms",
            sourceTotalMinor: "12500",
            lines: [
              {
                id: "performance_line",
                description: "Synthetic cost",
                quantity: "1",
                unitPriceMinor: "12500",
                baseMinor: "12500",
                discountMinor: "0",
                chargeMinor: "0",
                taxMinor: "0",
                taxDescription: "Synthetic manual treatment",
                taxEvidenceId: evidence.id,
                sourceGrossMinor: "12500",
              },
            ],
          },
        },
      );

      const native = await call(
        "/commerce/supplier-acceptance-reviews",
        Schema.Struct({
          id: Accounting.Identifier,
          digest: Accounting.Digest,
          postingPlan: Accounting.ChangeSet,
        }),
        {
          profile: "synthetic-manual-supplier-v1",
          draftId: draft.id,
          expectedRevision: draft.revision,
          expectedDigest: draft.digest,
          controlAccountId: "account_clearing",
          debitAccountId: "account_bank",
          accountingPeriodId: "period_synthetic_2026",
          series: "A",
          reason: "Read-only native original timing",
          acknowledgeSyntheticOnly: true,
        },
      );

      await installMeasurements(browser);
      await app.open(`${workspace}/work?kind=document&status=open&sort=newest`);

      const measureOwner = async (
        kind: "journal" | "supplier",
        plan: typeof Accounting.ChangeSet.Type,
        title: string,
      ) => {
        const firstPage: number[] = [];
        const decision: number[] = [];

        const acknowledgment =
          kind === "journal"
            ? "Jag har granskat detta exakta förslag och dess underlag."
            : "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.";

        for (let trial = 0; trial < warmups + samples; trial++) {
          currentTrial = {
            owner: kind,
            trial,
            samplePhase: trial < warmups ? "warmup" : "measured",
            title,
          };

          await browser.evaluate(
            "(input) => sessionStorage.setItem('openerp-document-performance', JSON.stringify(input))",
            {
              kind,
              title,
              acknowledgment,
            },
          );
          await app.open(
            `${workspace}/reviews/${encodeURIComponent(plan.id)}/${encodeURIComponent(plan.planDigest)}?kind=journal&status=open`,
          );
          await expect(
            screen.getByRole("img", `${filename}, sida 1`, { exact: true }),
          ).toBeVisible();
          await expect(screen.getByRole("checkbox", acknowledgment, { exact: true })).toBeEnabled();
          await expect
            .poll(async () => {
              const measured = await browser.evaluate(
                "() => globalThis.__openerpDocumentPerformance",
              );

              return Schema.is(MeasuredPage)(measured);
            })
            .toBe(true);

          const measured = Schema.decodeUnknownSync(MeasuredPage)(
            await browser.evaluate("() => globalThis.__openerpDocumentPerformance"),
          );

          observations.push({
            owner: kind,
            trial,
            samplePhase: trial < warmups ? "warmup" : "measured",
            ...measured,
          });
          currentTrial = null;

          if (trial >= warmups) {
            firstPage.push(measured.firstPageMs);
            decision.push(measured.decisionMs);
          }
        }

        await screen.getByText("Sidtext", { exact: true }).click();
        await expect(screen.getByText(pageText, { exact: true })).toBeVisible();

        return { firstPage: summarize(firstPage), decision: summarize(decision) };
      };

      const ordinary = await measureOwner("journal", journal, journalTitle);

      const intakeSamples: {
        occurrenceId: string;
        commitAtMs: number;
        visibleAtMs: number;
        durationMs: number;
      }[] = [];

      for (let trial = 0; trial < warmups + samples; trial++) {
        const taskFilename = `p04-performance-${String(trial).padStart(2, "0")}.pdf`;

        currentTrial = {
          owner: "intake",
          trial,
          samplePhase: trial < warmups ? "warmup" : "measured",
          title: taskFilename,
        };

        const requestStartedAtMs = Date.now();

        const occurrence = await call("/source-occurrences", Sources.SourceOccurrence, {
          destination: "supplier_inbox",
          sourceSystem: "document-performance",
          sourceAccountId: "book_synthetic",
          occurrenceKey: `intake_${trial}`,
          sourceRevision: "1",
          filename: taskFilename,
          mediaType: "application/pdf",
          contentBase64: bytes.toString("base64"),
        });

        currentTrial.occurrenceId = occurrence.id;

        expect(occurrence.sha256).toBe(expectedHash);
        await browser.evaluate(
          "(input) => sessionStorage.setItem('openerp-document-performance', JSON.stringify(input))",
          {
            kind: "document",
            occurrenceId: occurrence.id,
            filename: taskFilename,
          },
        );
        await app.open(`${workspace}/work?kind=document&status=open&sort=newest`);
        const row = screen.getByRole("link", taskFilename, { exact: true });

        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute("href", new RegExp(`occurrence=${occurrence.id}`));
        await expect
          .poll(async () =>
            Schema.is(MeasuredRow)(
              await browser.evaluate("() => globalThis.__openerpDocumentPerformance"),
            ),
          )
          .toBe(true);

        const measured = Schema.decodeUnknownSync(MeasuredRow)(
          await browser.evaluate("() => globalThis.__openerpDocumentPerformance"),
        );

        const committed = await client.query<{ committedAtMs: string | null }>(
          `select (extract(epoch from pg_xact_commit_timestamp(xmin))*1000)::text as "committedAtMs"
          from openerp.supplier_inbox where book_id='book_synthetic' and occurrence_id=$1`,
          [occurrence.id],
        );

        expect(committed.rows).toHaveLength(1);
        const commitAtMs = Number(committed.rows[0]?.committedAtMs ?? NaN);

        expect(Number.isFinite(commitAtMs)).toBe(true);
        expect(commitAtMs).toBeGreaterThanOrEqual(requestStartedAtMs - 5);
        expect(commitAtMs).toBeLessThanOrEqual(measured.visibleAtMs);
        expect(Math.abs(measured.visibleAtMs - measured.wallAtVisibleMs)).toBeLessThanOrEqual(5);
        const attention = await call("/attention?kind=document&status=open&sort=newest", Attention);

        expect(attention.scope).toEqual(source.scope);
        expect(attention.total).toBe(String(trial + 1));
        expect(attention.counts).toEqual({ open: String(trial + 1), completed: "0" });
        expect(attention.items.filter((item) => item.id === occurrence.id)).toEqual([
          { id: occurrence.id, kind: "document", title: taskFilename },
        ]);

        observations.push({
          owner: "intake",
          trial,
          samplePhase: trial < warmups ? "warmup" : "measured",
          occurrenceId: occurrence.id,
          commitAtMs,
          visibleAtMs: measured.visibleAtMs,
          durationMs: measured.visibleAtMs - commitAtMs,
        });
        currentTrial = null;

        if (trial >= warmups)
          intakeSamples.push({
            occurrenceId: occurrence.id,
            commitAtMs,
            visibleAtMs: measured.visibleAtMs,
            durationMs: measured.visibleAtMs - commitAtMs,
          });
      }

      const intake = summarize(intakeSamples.map((sample) => sample.durationMs));

      const nativeFocused =
        phase === "head"
          ? await measureOwner("supplier", native.postingPlan, "Performance supplier")
          : null;

      const after = {
        ledger: await call("/ledger", Accounting.LedgerSnapshot),
        effects: await effects(),
      };

      expect(after).toEqual(before);
      await browser.evaluate("() => sessionStorage.removeItem('openerp-document-performance')");
      await app.open(`${workspace}/work?kind=document&status=open&sort=newest`);

      const browserEnvironment = Schema.decodeUnknownSync(
        Schema.Struct({
          userAgent: Schema.String,
          viewport: Schema.Struct({ width: Schema.Finite, height: Schema.Finite }),
          devicePixelRatio: Schema.Finite,
          timezone: Schema.String,
        }),
      )(
        await browser.evaluate(`() => ({
          userAgent: navigator.userAgent,
          viewport: { width: innerWidth, height: innerHeight },
          devicePixelRatio,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })`),
      );

      const serverVersion = (await client.query("SHOW server_version")).rows[0]?.server_version;
      const packageVersion = Schema.Struct({ version: Schema.String });

      const e2eVersion = Schema.decodeSync(Schema.fromJsonString(packageVersion))(
        await readFile(new URL("../../node_modules/e2e/package.json", import.meta.url), "utf8"),
      ).version;

      const browserEngineVersion = Schema.decodeSync(Schema.fromJsonString(packageVersion))(
        await readFile(
          new URL("../../node_modules/@e2e-dev/web/package.json", import.meta.url),
          "utf8",
        ),
      ).version;

      const environment = {
        node: process.version,
        platform: platform(),
        arch: arch(),
        release: release(),
        serverVersion,
        e2eVersion,
        browserEngineVersion,
        browser: browserEnvironment,
      };

      const sizes = (
        await client.query(
          `select
          (select count(*)::integer from openerp.intake_occurrences where book_id='book_synthetic') as "sourceOccurrences",
          (select count(*)::integer from openerp.supplier_inbox where book_id='book_synthetic') as "supplierInbox",
          (select count(*)::integer from openerp.supplier_invoice_drafts where book_id='book_synthetic') as "supplierDrafts",
          (select count(*)::integer from openerp.change_sets where book_id='book_synthetic') as "postingPlans",
          (select count(*)::integer from openerp.accounts where book_id='book_synthetic') as accounts`,
        )
      ).rows[0];

      expect(browserEnvironment.viewport).toEqual({ width: 1440, height: 900 });
      expect(sizes).toEqual({
        sourceOccurrences: 36,
        supplierInbox: 35,
        supplierDrafts: 1,
        postingPlans: 2,
        accounts: 2,
      });
      await expect(
        screen.getByRole("link", { name: "p04-performance-34.pdf", exact: true }),
      ).toBeVisible();
      await agent.assert(
        "The document work queue shows the retained p04-performance originals as unfinished tasks. No posting or payment is claimed. Return only the configured JSON judgment.",
        { timeout: 30000 },
      );
      const screenshot = await app.screenshot("document-performance-visible-intake");

      const fixture = {
        pdfHash: expectedHash,
        pdfBytes: bytes.length,
        pdfPages: 1,
        fixtureDate,
        warmups,
        samples,
        sourceOccurrences: 36,
        supplierInbox: 35,
        supplierDrafts: 1,
        postingPlans: 2,
        accounts: 2,
        viewport: { width: 1440, height: 900 },
        workerCount: 1,
        reviewQueueFilter: "kind=journal&status=open",
        cache:
          "Five warmed full navigations per owner; unchanged single-page bytes; fresh document route per committed intake",
      };

      const result = {
        phase,
        revision,
        baselineRevision,
        fixture,
        ordinary,
        nativeFocused,
        intake,
        intakeSamples,
        before,
        after,
        screenshot,
        environment,
        metricStart: {
          review: "Browser navigation time origin",
          intake: "Exact scoped supplier_inbox insertion transaction commit timestamp",
        },
        nativeComparison:
          "Added native focused operation; no equivalent committed native original-pane baseline",
      };

      await writeFile(
        join(output, `document-performance-${phase}.json`),
        JSON.stringify(result, null, 2),
      );

      if (phase === "head") {
        for (const metric of [
          ordinary.firstPage,
          ordinary.decision,
          nativeFocused?.firstPage,
          nativeFocused?.decision,
        ])
          if (metric) expect(metric.p95Ms).toBeLessThanOrEqual(2000);

        expect(intake.p95Ms).toBeLessThanOrEqual(1500);
      }

      if (phase === "head") {
        const baselineFile = process.env.OPENERP_DOCUMENT_PERFORMANCE_BASELINE;

        if (!baselineFile)
          throw new Error("Head comparison requires the retained baseline receipt");

        const baseline = Schema.decodeSync(
          Schema.fromJsonString(
            Schema.Struct({
              phase: Schema.Literal("baseline"),
              revision: Schema.Literal(baselineRevision),
              fixture: Schema.Unknown,
              environment: Schema.Unknown,
              ordinary: Schema.Struct({ firstPage: Summary, decision: Summary }),
              intake: Summary,
            }),
          ),
        )(await readFile(baselineFile, "utf8"));

        expect(baseline.fixture).toEqual(fixture);
        expect(baseline.environment).toEqual(environment);

        for (const [current, previous] of [
          [ordinary.firstPage, baseline.ordinary.firstPage],
          [ordinary.decision, baseline.ordinary.decision],
          [intake, baseline.intake],
        ])
          expect(current!.p95Ms).toBeLessThanOrEqual(
            Math.max(previous!.p95Ms * 1.2, previous!.p95Ms + 50),
          );
      }

      complete = true;
    } finally {
      const finalEffects = await effects().catch(() => null);

      const failedTrialCommitAtMs =
        currentTrial?.owner === "intake" && currentTrial.occurrenceId
          ? await client
              .query<{ committedAtMs: string | null }>(
                `select (extract(epoch from pg_xact_commit_timestamp(xmin))*1000)::text as "committedAtMs"
          from openerp.supplier_inbox where book_id='book_synthetic' and occurrence_id=$1`,
                [currentTrial.occurrenceId],
              )
              .then((result) => result.rows[0]?.committedAtMs ?? null)
              .catch(() => null)
          : null;

      await writeFile(
        join(output, `document-performance-${phase}-progress.json`),
        JSON.stringify(
          {
            synthetic: true,
            state: complete ? "complete" : "incomplete",
            phase,
            revision,
            baselineRevision,
            fixture: {
              pdfHash: expectedHash,
              pdfBytes: bytes.length,
              pdfPages: 1,
              warmups,
              samples,
            },
            observations,
            currentTrial,
            failedTrialCommitAtMs,
            before,
            finalEffects,
            finalEffectsObservation: finalEffects ? "observed" : "unavailable",
          },
          null,
          2,
        ),
      ).catch((error: unknown) => {
        if (complete) throw error;

        process.stderr.write(
          "Performance progress receipt could not be retained after the test failure.\n",
        );
      });
    }
  });
});
