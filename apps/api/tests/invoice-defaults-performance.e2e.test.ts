import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Catalog from "@open-erp/contracts/catalog";
import * as Crm from "@open-erp/contracts/crm-master";
import { expect, test } from "vitest";
import {
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  post,
  request,
} from "./support/fixtures";

const DefaultsReference = Schema.Struct({
  partyId: Accounting.Identifier,
  revision: Schema.String,
  digest: Accounting.Digest,
});

const Applied = Schema.Struct({ dueDate: Schema.String, paymentTerms: Schema.String });

function p95(values: readonly number[]) {
  const ordered = values.toSorted((left, right) => left - right);

  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

function p50(values: readonly number[]) {
  const ordered = values.toSorted((left, right) => left - right);

  return ordered[Math.ceil(ordered.length * 0.5) - 1];
}

test("scoped CRM and catalog read performance retains comparable bounded fixtures", async () => {
  const book = await fixture();
  const source = await evidence(book);
  const parties: string[] = [];

  for (let index = 0; index < 12; index += 1) {
    const party = await post(
      book,
      "/commerce/counterparties",
      {
        kind: "synthetic_counterparty_v1",
        externalKey: `P06_PERF_${index}`,
        role: "customer",
        displayName: `Synthetic performance customer ${index}`,
        evidenceId: source.id,
        reason: "Portable directory baseline",
      },
      Commerce.CounterpartyRevision,
    );

    parties.push(party.id);
  }

  for (let index = 0; index < 20; index += 1) {
    await post(
      book,
      "/commerce/articles",
      {
        code: `PERF_${String(index).padStart(2, "0")}`,
        expectedRevision: 0,
        description: `Synthetic performance article ${index}`,
        unit: "hour",
        unitPriceMinor: "100000",
        taxDescription: "Retained assertion",
      },
      Catalog.Article,
    );
  }

  const directory: number[] = [];
  const articles: number[] = [];
  const apply: number[] = [];
  const timings = { directory, articles, apply };

  async function readDirectory(measured: boolean) {
    const started = performance.now();

    const page = await decoded(
      await request(book, "/commerce/directory?role=customer"),
      Crm.DirectoryPage,
    );

    expect(page.items).toHaveLength(12);
    expect(page.items.map((item) => item.party.id).toSorted()).toEqual(parties.toSorted());

    if (measured) timings.directory.push(performance.now() - started);
  }

  async function readArticles(measured: boolean) {
    const started = performance.now();
    const page = await decoded(await request(book, "/commerce/articles"), Catalog.ArticlePage);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toMatchObject({
      code: "PERF_00",
      description: "Synthetic performance article 0",
      unitPriceMinor: "100000",
    });
    expect(page.next).toBeNull();

    if (measured) timings.articles.push(performance.now() - started);
  }

  for (let sample = 0; sample < 35; sample += 1) {
    if (sample % 2 === 0) {
      await readDirectory(sample >= 5);
      await readArticles(sample >= 5);
    } else {
      await readArticles(sample >= 5);
      await readDirectory(sample >= 5);
    }
  }

  const expectation = process.env.OPENERP_P06_FEATURE_EXPECTATION ?? "available";
  expect(["absent", "available"]).toContain(expectation);
  const partyId = parties[0];

  if (!partyId) throw new Error("Performance fixture customer missing");
  const route = `/commerce/directory/${partyId}/invoice-defaults`;

  const probe = await request(book, route, {
    method: "POST",
    body: JSON.stringify({
      expectedRevision: "0",
      expectedDigest: null,
      terms: { kind: "calendar_days_v1", days: 14 },
      currency: "SEK",
      language: "en",
      recipient: null,
      reviewEvidence: { evidenceId: source.id, sha256: source.sha256 },
      reason: "Portable added operation performance",
    }),
  });

  if (expectation === "absent") {
    await failure(probe, 404, "NotFound");
  } else {
    const reference = await decoded(probe, DefaultsReference);

    for (let sample = 0; sample < 35; sample += 1) {
      const started = performance.now();

      const applied = await post(
        book,
        `${route}/apply`,
        { reference, invoiceDate: "2026-10-02" },
        Applied,
      );

      expect(applied).toMatchObject({ dueDate: "2026-10-16", paymentTerms: "14 calendar days" });

      if (sample >= 5) timings.apply.push(performance.now() - started);
    }

    expect(p95(timings.apply)).toBeLessThanOrEqual(1000);
  }

  await writeFile(
    join(environment().artifacts, "crm-catalog-performance.json"),
    JSON.stringify(
      {
        label: process.env.OPENERP_PERF_LABEL ?? "head",
        expectation,
        fixture: { customers: 12, articles: 20, warmupPairs: 5, measuredSamples: 30 },
        timings,
        p50Ms: {
          directory: p50(timings.directory),
          articles: p50(timings.articles),
          apply: expectation === "available" ? p50(timings.apply) : null,
        },
        p95Ms: {
          directory: p95(timings.directory),
          articles: p95(timings.articles),
          apply: expectation === "available" ? p95(timings.apply) : null,
        },
      },
      null,
      2,
    ),
  );
});
