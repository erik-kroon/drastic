import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as A from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Examples from "@open-erp/contracts/decision-examples";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Memory from "@open-erp/domain/firm-memory";
import * as Consequence from "@open-erp/domain/treatment-consequence";
import {
  acceptDraft,
  createDraft,
  purchaseEvidence,
  supplierFixture,
} from "./support/supplier-review";
import { createSession, decoded, environment, post, request, run } from "./support/fixtures";

test("same-book firm memory serves immutable ranked precedents, corrections and a sealed temporal baseline", async () => {
  const f = await supplierFixture([
    { id: "account_expense", code: "6550", name: "Original expense" },
    { id: "account_replacement", code: "4010", name: "Replacement expense" },
  ]);

  f.book.token = (await createSession(f.book)).token;

  const freshDraft = async (ordinal: number) => {
    const source = await purchaseEvidence(f.book, ordinal);

    return createDraft(f.book, {
      ...f.content,
      sourceEvidenceId: source.id,
      supplierDocumentNumber: `MEMORY-${ordinal}`,
      lines: f.content.lines.map((line) => ({ ...line, taxEvidenceId: source.id })),
    });
  };

  const hints = async (draft: typeof Drafts.SupplierInvoiceDraftRevision.Type) =>
    decoded(
      await request(
        f.book,
        `/commerce/supplier-account-suggestions/${f.supplier.id}?draftId=${draft.id}&draftRevision=${draft.revision}`,
      ),
      Drafts.SupplierAccountSuggestions,
    );

  const firstDraft = await freshDraft(1);
  const empty = await hints(firstDraft);

  expect(empty.precedents).toEqual([]);
  expect(empty.items).toEqual([]);
  expect(empty.eligibleCount).toBe(0);
  const first = await acceptDraft(f.book, firstDraft, "account_expense");
  const second = await acceptDraft(f.book, await freshDraft(2), "account_expense");
  const probe = await freshDraft(3);
  const served = await hints(probe);
  const repeated = await hints(probe);

  expect(served.algorithmVersion).toBe("firm_memory_v1");
  expect(served.precedents).toHaveLength(2);
  expect(repeated.precedents).toEqual(served.precedents);
  expect(repeated.historyDigest).toBe(served.historyDigest);
  expect(repeated.suggestionRecordId).not.toBe(served.suggestionRecordId);
  expect(
    served.precedents
      .flatMap((item) => item.sourceDecisionIds)
      .sort((left, right) => (left < right ? -1 : Number(left > right))),
  ).toEqual(
    [first.approvalId, second.approvalId].sort((left, right) =>
      left < right ? -1 : Number(left > right),
    ),
  );
  expect(served.precedents.every((item) => item.provenance.classification === "independent")).toBe(
    true,
  );
  expect(
    served.precedents.every((item) =>
      item.consequences.every((result) => result.status === "unknown"),
    ),
  ).toBe(true);

  const foreign = await supplierFixture();
  foreign.book.token = (await createSession(foreign.book)).token;

  const foreignAccepted = await acceptDraft(
    foreign.book,
    await createDraft(foreign.book, foreign.content),
  );

  const afterForeign = await hints(probe);

  expect(afterForeign.historyDigest).toBe(served.historyDigest);
  expect(JSON.stringify(afterForeign)).not.toContain(foreignAccepted.approvalId);

  const exported = await post(
    f.book,
    "/automation/decision-examples",
    { purpose: "evaluation", selectedDecisionIds: [] },
    Examples.DecisionExampleExport,
  );

  const baselineDirectory = join(environment().artifacts, "firm-memory-baseline");
  await mkdir(baselineDirectory);
  await run(
    "bun",
    [
      "verification/firm-memory/report.ts",
      f.book.entityId,
      f.book.bookId,
      exported.id,
      baselineDirectory,
    ],
    {
      cwd: join(import.meta.dirname, "../../.."),
      env: {
        ...process.env,
        OPENERP_API_URL: environment().baseUrl,
        OPENERP_OPERATOR_TOKEN: f.book.token,
      },
    },
  );
  const baseline = JSON.parse(await readFile(join(baselineDirectory, "report.json"), "utf8"));

  expect(baseline.counts).toMatchObject({
    eligibleTargets: 2,
    suggestedTargets: 1,
    knownComparableTargets: 0,
    correctConsequences: 0,
    unknownConsequences: 2,
  });
  expect(baseline.metrics).toEqual({
    coverage: { numerator: 1, denominator: 2, value: 0.5 },
    consequenceAccuracy: { numerator: 0, denominator: 0, value: null },
  });
  expect(
    baseline.targets.find((item: { id: string }) => item.id === second.approvalId)
      .suggestedSourceDecisionIds,
  ).toEqual([first.approvalId]);

  const voucher = await decoded(
    await request(f.book, `/vouchers/${first.postingReceipt.voucherId}`),
    A.Voucher,
  );

  const intent = {
    datePolicy: "explicit_open_period" as const,
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-23",
    rationale: "Synthetic memory correction",
    replacement: {
      description: "Replacement",
      lines: voucher.action.lines.map((line) => ({
        accountId: line.accountId === "account_expense" ? "account_replacement" : line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
        originalDimensions: line.originalDimensions ?? [],
      })),
    },
  };

  const impact = await post(
    f.book,
    `/vouchers/${first.postingReceipt.voucherId}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  const bundle = await post(
    f.book,
    `/vouchers/${first.postingReceipt.voucherId}/correction-bundles`,
    { ...intent, impactReview: { id: impact.id, digest: impact.digest } },
    Corrections.CorrectionBundle,
  );

  const approval = await post(
    f.book,
    `/correction-bundles/${bundle.id}/approvals`,
    { version: 1, bundleDigest: bundle.bundleDigest },
    Corrections.CorrectionBundleApproval,
  );

  const receipt = await post(
    f.book,
    `/correction-bundles/${bundle.id}/execute`,
    { version: 1, bundleDigest: bundle.bundleDigest, approvalId: approval.id },
    Corrections.CorrectionBundleReceipt,
  );

  const corrected = await hints(probe);

  const correctedPrecedent = corrected.precedents.find((item) =>
    item.sourceDecisionIds.includes(first.approvalId),
  );

  expect(corrected.items).toEqual([]);
  expect(corrected.precedents[0]?.accountHints).toEqual([]);
  expect(corrected.historyDigest).not.toBe(served.historyDigest);
  expect(correctedPrecedent?.lineage).toHaveLength(1);
  expect(correctedPrecedent?.chosenTreatment).toMatchObject({
    vatReasoning: "replacement_journal_only",
  });
  expect(JSON.stringify(correctedPrecedent?.chosenTreatment)).toContain("account_replacement");
  expect(JSON.stringify(correctedPrecedent?.chosenTreatment)).not.toContain("account_expense");
  expect(correctedPrecedent?.accountHints).toEqual([]);
  expect(corrected.items.some((item) => item.sourceInvoiceId === first.registerInvoiceId)).toBe(
    false,
  );

  const afterCorrection = await post(
    f.book,
    "/automation/decision-examples",
    { purpose: "evaluation", selectedDecisionIds: [] },
    Examples.DecisionExampleExport,
  );

  const projected = afterCorrection.examples.flatMap((example) =>
    example.precedent ? [example.precedent] : [],
  );

  const temporal = Memory.baseline(projected);

  expect(
    temporal.targets.find((item) => item.id === second.approvalId)?.suggestedSourceDecisionIds,
  ).toEqual([]);
  expect(temporal.targets.find((item) => item.id === second.approvalId)?.exclusions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: first.approvalId, reason: "later_label" }),
    ]),
  );
  await writeFile(
    join(environment().artifacts, "firm-memory-serving.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        empty,
        served,
        repeated,
        afterForeign,
        exported,
        baseline,
        corrected,
        receipt,
        afterCorrection,
        temporal,
      },
      null,
      2,
    ),
  );
});

function authoredPrecedent(id: string, sequence: string): Memory.Precedent {
  return {
    id,
    bookId: "book_memory",
    counterpartyId: "supplier_memory",
    documentKind: "supplier_invoice",
    currency: "SEK",
    currencyScale: 2,
    description: "  SYNTHETIC   Service ",
    amountMinor: "10000",
    originalCommitCutoff: String(BigInt(sequence) - 1n),
    receiptSequence: sequence,
    labelSequence: sequence,
    relatedIds: [`document:${id}`, `voucher:${id}`, `invoice:invoice_${id}`],
    sourceDecisionIds: [id],
    sourceInvoiceId: `invoice_${id}`,
    chosenTreatment: {},
    provenance: { classification: "independent", digest: `sha256:${"0".repeat(64)}` },
    lineage: [],
    consequences: [{ status: "unknown", reasons: ["mapping_not_captured"] }],
    accountHints: [],
    digest: `sha256:${"1".repeat(64)}`,
  };
}

test("independent firm memory vectors prove hard filters, stable ties and correction-group temporal holdout denominators", async () => {
  const target: Memory.Target = {
    bookId: "book_memory",
    counterpartyId: "supplier_memory",
    documentKind: "supplier_invoice",
    currency: "SEK",
    currencyScale: 2,
    description: "synthetic service",
    amountMinor: "10000",
    cutoff: "10",
    excludeRelatedIds: [],
  };

  const a = authoredPrecedent("decision_a", "1");
  const b = authoredPrecedent("decision_b", "1");

  const cases = [
    { name: "empty", records: [], expected: [] },
    { name: "foreign_book", records: [{ ...a, bookId: "book_foreign" }], expected: [] },
    { name: "counterparty", records: [{ ...a, counterpartyId: "supplier_other" }], expected: [] },
    { name: "kind", records: [{ ...a, documentKind: "credit_note" }], expected: [] },
    { name: "currency", records: [{ ...a, currency: "EUR" }], expected: [] },
    { name: "missing_description", records: [{ ...a, description: null }], expected: [] },
    { name: "missing_amount", records: [{ ...a, amountMinor: null }], expected: [] },
    {
      name: "later_fact",
      records: [{ ...a, receiptSequence: "11", labelSequence: "11" }],
      expected: [],
    },
    { name: "later_correction", records: [{ ...a, labelSequence: "11" }], expected: [] },
    {
      name: "grouped_holdout",
      records: [a],
      target: { ...target, excludeRelatedIds: a.relatedIds },
      expected: [],
    },
    { name: "stable_ties", records: [b, a], expected: [a.id, b.id] },
  ];

  const observed = cases.map((vector) => ({
    name: vector.name,
    expected: vector.expected,
    result: Memory.rank(vector.target ?? target, vector.records),
  }));

  for (const vector of observed)
    expect(vector.result.precedents.map((item) => item.id)).toEqual(vector.expected);

  expect(Memory.rank(target, [a, b]).precedents).toEqual(Memory.rank(target, [b, a]).precedents);
  expect(observed.find((item) => item.name === "missing_description")?.result.exclusions).toEqual([
    { id: a.id, reason: "missing_description" },
  ]);
  expect(observed.find((item) => item.name === "missing_amount")?.result.exclusions).toEqual([
    { id: a.id, reason: "missing_amount" },
  ]);
  expect(Memory.baseline([{ ...a, description: "   " }]).counts.eligibleTargets).toBe(0);
  const noTargets = Memory.baseline([]);

  expect(noTargets.metrics).toEqual({
    coverage: { numerator: 0, denominator: 0, value: null },
    consequenceAccuracy: { numerator: 0, denominator: 0, value: null },
  });
  const heldout = authoredPrecedent("decision_target", "2");

  const related = {
    ...a,
    id: "decision_related",
    sourceInvoiceId: heldout.sourceInvoiceId,
    relatedIds: [...heldout.relatedIds, "voucher:correction"],
  };

  const later = authoredPrecedent("decision_later", "3");

  const influenced = {
    ...authoredPrecedent("decision_influenced", "4"),
    provenance: { ...a.provenance, classification: "unknown_exposure" as const },
  };

  const report = Memory.baseline([a, heldout, related, later, influenced]);
  const targetReport = report.targets.find((item) => item.id === heldout.id);

  expect(targetReport?.suggestedSourceDecisionIds).toEqual([a.id]);
  expect(targetReport?.exclusions).toEqual(
    expect.arrayContaining([
      { id: related.id, reason: "related_holdout" },
      { id: later.id, reason: "later_receipt" },
    ]),
  );
  expect(report.counts.knownComparableTargets).toBe(0);
  expect(report.counts.correctConsequences).toBe(0);
  expect(report.metrics.consequenceAccuracy.value).toBeNull();
  expect(report.excludedTargets).toEqual([{ id: influenced.id, reason: "influenced_label" }]);

  const capture: Consequence.CapturedTreatment = {
    accountId: "account_expense",
    originalCommitCutoff: "0",
    postingOn: "2026-09-22",
    mapping: {
      checksum: `sha256:${"2".repeat(64)}`,
      applicableAtCutoff: "0",
      accounts: [
        {
          accountId: "account_expense",
          classification: "expense",
          placement: "income_statement",
          statementLeaf: "synthetic_expense",
        },
      ],
    },
    vat: {
      category: "synthetic_category",
      profileIdentity: `sha256:${"3".repeat(64)}`,
      resolvedRate: { numerator: "1", denominator: "4" },
      deduction: { numerator: "1", denominator: "1" },
    },
    period: { id: "period_memory", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    dimensions: { requirements: [], assignments: [] },
  };

  const consequence = Consequence.classify(capture);

  expect(consequence.status).toBe("known");

  const known = Memory.baseline([
    { ...a, consequences: [consequence] },
    { ...heldout, consequences: [consequence] },
  ]);

  expect(known.counts).toMatchObject({
    eligibleTargets: 2,
    suggestedTargets: 1,
    knownComparableTargets: 1,
    correctConsequences: 1,
    unknownConsequences: 0,
  });
  expect(known.metrics.consequenceAccuracy).toEqual({ numerator: 1, denominator: 1, value: 1 });
  await writeFile(
    join(environment().artifacts, "firm-memory-vectors.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        observed,
        noTargets,
        report,
        known,
        syntheticKnownClassNotProductionK2: true,
      },
      null,
      2,
    ),
  );
});
