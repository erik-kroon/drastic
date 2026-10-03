import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arch, platform, totalmem } from "node:os";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { legalFixture } from "./support/legal-commerce";
import { decoded, environment, key, post, request } from "./support/fixtures";

const Template = Schema.Struct({
  id: Schema.String,
  revision: Schema.String,
  digest: Schema.String,
});

function distribution(trials: readonly number[]) {
  const ordered = [...trials].sort((left, right) => left - right);

  return { trials, p50: ordered[14], p95: ordered[28] };
}

test("P07 comparable draft reads and independent template application latency", async () => {
  const context = await legalFixture();
  const source = context.original.draftSnapshot;
  const reads: number[] = [];

  for (let sample = 0; sample < 35; sample += 1) {
    const start = performance.now();

    const view = await decoded(
      await request(context.author, `/commerce/invoice-drafts/${source.id}`),
      Drafts.InvoiceDraftView,
    );

    expect(view.record.id).toBe(source.id);
    expect(view.record.digest).toBe(source.digest);

    if (sample >= 5) reads.push(performance.now() - start);
  }

  const base = "/commerce/invoice-templates";
  const applications: number[] = [];
  const absent = process.env.OPENERP_P07_FEATURE_EXPECTATION === "absent";

  if (absent) {
    expect((await request(context.author, base)).status).toBe(404);
  } else {
    const template = await post(
      context.author,
      base,
      {
        name: "Synthetic performance template",
        currency: "SEK",
        currencyScale: 2,
        content: {
          title: "Measured template",
          paymentTerms: null,
          note: "Retained performance note",
          lines: [
            {
              id: "line_1",
              description: "Synthetic hours",
              quantity: "2",
              unitPriceMinor: "100000",
              discountMinor: "0",
              chargeMinor: "0",
              treatment: {
                kind: "legal_sales_policy",
                id: context.original.policyId,
                digest: context.original.policyDigest,
              },
            },
          ],
        },
        reason: "Isolated operation measurement",
      },
      Template,
    );

    for (let sample = 0; sample < 35; sample += 1) {
      const start = performance.now();

      const result = await post(
        context.author,
        `${base}/${template.id}/applications`,
        {
          revision: template.revision,
          digest: template.digest,
          target: {
            kind: "new",
            draftKey: `performance_${key()}`,
            context: {
              counterpartyId: source.content.counterpartyId,
              counterpartyRevision: source.content.counterpartyRevision,
              seller: source.content.seller,
              customer: source.content.customer,
              plannedIssueDate: context.today,
              supplyDate: context.today,
              dueDate: context.today,
            },
          },
          reason: "Measure an independently created draft",
        },
        Drafts.InvoiceDraftRevision,
      );

      expect(result.totals).toMatchObject({
        netMinor: "200000",
        taxMinor: "50000",
        grossMinor: "250000",
      });

      if (sample >= 5) applications.push(performance.now() - start);
    }
  }

  const applicationDistribution = absent ? null : distribution(applications);
  const readDistribution = distribution(reads);
  const baseline = process.env.OPENERP_P07_READ_BASELINE_P95_MS;
  const baselineP95 = baseline === undefined ? null : Number(baseline);

  if (baselineP95 !== null) expect(Number.isFinite(baselineP95) && baselineP95 > 0).toBe(true);

  const readBudget = baselineP95 === null ? null : Math.max(baselineP95 * 1.2, baselineP95 + 50);

  await writeFile(
    join(environment().artifacts, "invoice-template-performance.json"),
    JSON.stringify(
      {
        warmups: 5,
        measured: 30,
        label: process.env.OPENERP_PERF_LABEL ?? "unlabelled",
        machine: {
          platform: platform(),
          arch: arch(),
          memoryBytes: totalmem(),
          node: process.version,
        },
        reads: readDistribution,
        applications: applicationDistribution,
        baselineP95,
        readBudget,
        applicationBudget: 1000,
      },
      null,
      2,
    ),
  );

  if (readBudget !== null) expect(readDistribution.p95).toBeLessThanOrEqual(readBudget);

  if (applicationDistribution !== null)
    expect(applicationDistribution.p95).toBeLessThanOrEqual(1000);
});
