import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as C from "@open-erp/domain/treatment-consequence";
import * as E from "@open-erp/contracts/decision-examples";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { supplierFixture, createDraft } from "./support/supplier-review";
import { createSession, environment, post } from "./support/fixtures";

function captured(): C.CapturedTreatment {
  return {
    accountId: "expense_alpha",
    originalCommitCutoff: "7",
    postingOn: "2026-09-22",
    mapping: {
      checksum: `sha256:${"a".repeat(64)}`,
      applicableAtCutoff: "7",
      accounts: ["expense_alpha", "expense_beta"].map((accountId) => ({
        accountId,
        classification: "expense",
        placement: "income_statement",
        statementLeaf: "synthetic_k2_external_expense",
      })),
    },
    vat: {
      category: "synthetic_standard_purchase",
      profileIdentity: `sha256:${"c".repeat(64)}`,
      resolvedRate: { numerator: "25", denominator: "100" },
      deduction: { numerator: "1", denominator: "1" },
    },
    period: { id: "period_2026", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    dimensions: {
      requirements: [
        {
          code: "project",
          revision: 1,
          requirement: "required",
          fixedValueCode: null,
          fixedValueRevision: null,
        },
      ],
      assignments: [{ code: "project", revision: 1, valueCode: "alpha", valueRevision: 1 }],
    },
  };
}

test("independent consequence vectors distinguish known classes and never equate missing captures", async () => {
  const rightAccount = { ...captured(), accountId: "expense_beta" };

  const half = {
    ...captured(),
    vat: {
      ...captured().vat,
      category: "synthetic_standard_purchase",
      deduction: { numerator: "1", denominator: "2" },
    },
  };

  const vectors: {
    name: string;
    left: C.CapturedTreatment;
    right: C.CapturedTreatment;
    expected: "equivalent" | "different" | "unknown";
  }[] = [
    {
      name: "two accounts same synthetic K2 leaf",
      left: captured(),
      right: rightAccount,
      expected: "equivalent",
    },
    { name: "different deduction", left: captured(), right: half, expected: "different" },
    {
      name: "asset versus expense",
      left: captured(),
      right: {
        ...captured(),
        mapping: {
          ...captured().mapping!,
          accounts: [
            {
              accountId: "expense_alpha",
              classification: "asset",
              placement: "balance_sheet",
              statementLeaf: "synthetic_k2_external_expense",
            },
          ],
        },
      },
      expected: "different",
    },
    {
      name: "unmapped account",
      left: captured(),
      right: { ...captured(), accountId: "account_unmapped" },
      expected: "unknown",
    },
    {
      name: "changed content checksum",
      left: captured(),
      right: {
        ...captured(),
        mapping: { ...captured().mapping!, checksum: `sha256:${"b".repeat(64)}` },
      },
      expected: "different",
    },
    {
      name: "missing explicit VAT category",
      left: captured(),
      right: { ...captured(), vat: { ...captured().vat, category: null } },
      expected: "unknown",
    },
    {
      name: "different required dimension",
      left: captured(),
      right: {
        ...captured(),
        dimensions: {
          ...captured().dimensions!,
          assignments: [{ code: "project", revision: 1, valueCode: "beta", valueRevision: 1 }],
        },
      },
      expected: "different",
    },
    {
      name: "rational normalization",
      left: half,
      right: { ...half, vat: { ...half.vat, deduction: { numerator: "2", denominator: "4" } } },
      expected: "equivalent",
    },
    {
      name: "identical unknowns",
      left: { ...captured(), mapping: null },
      right: { ...captured(), mapping: null },
      expected: "unknown",
    },
    {
      name: "wrong original cutoff applicability",
      left: captured(),
      right: { ...captured(), mapping: { ...captured().mapping!, applicableAtCutoff: "8" } },
      expected: "unknown",
    },
    {
      name: "missing period boundaries",
      left: captured(),
      right: { ...captured(), period: { ...captured().period, startsOn: null } },
      expected: "unknown",
    },
    {
      name: "zero rational denominator",
      left: captured(),
      right: {
        ...captured(),
        vat: { ...captured().vat, deduction: { numerator: "1", denominator: "0" } },
      },
      expected: "unknown",
    },
    {
      name: "deduction exceeds one",
      left: captured(),
      right: {
        ...captured(),
        vat: { ...captured().vat, deduction: { numerator: "2", denominator: "1" } },
      },
      expected: "unknown",
    },
    {
      name: "missing required dimension",
      left: captured(),
      right: { ...captured(), dimensions: { ...captured().dimensions!, assignments: [] } },
      expected: "unknown",
    },
    {
      name: "missing dimension requirements",
      left: captured(),
      right: { ...captured(), dimensions: { ...captured().dimensions!, requirements: null } },
      expected: "unknown",
    },
    {
      name: "fixed dimension mismatch",
      left: captured(),
      right: {
        ...captured(),
        dimensions: {
          ...captured().dimensions!,
          requirements: [
            {
              code: "project",
              revision: 1,
              requirement: "fixed",
              fixedValueCode: "beta",
              fixedValueRevision: 1,
            },
          ],
        },
      },
      expected: "unknown",
    },
    {
      name: "duplicate account classification",
      left: captured(),
      right: {
        ...captured(),
        mapping: {
          ...captured().mapping!,
          accounts: [...captured().mapping!.accounts, captured().mapping!.accounts[0]!],
        },
      },
      expected: "unknown",
    },
    {
      name: "invalid calendar date",
      left: captured(),
      right: { ...captured(), postingOn: "2026-02-30" },
      expected: "unknown",
    },
    {
      name: "different period",
      left: captured(),
      right: { ...captured(), period: { ...captured().period, id: "period_alternate" } },
      expected: "different",
    },
    {
      name: "representation category versus full deduction",
      left: captured(),
      right: { ...captured(), vat: { ...captured().vat, category: "synthetic_representation" } },
      expected: "different",
    },
    {
      name: "reordered mapping entries",
      left: captured(),
      right: {
        ...rightAccount,
        mapping: {
          ...rightAccount.mapping!,
          accounts: [...rightAccount.mapping!.accounts].reverse(),
        },
      },
      expected: "equivalent",
    },
  ];

  const observed = vectors.map((vector) => {
    const left = C.classify(vector.left);
    const right = C.classify(vector.right);
    const actual = C.compare(left, right);
    expect(actual).toBe(vector.expected);

    if (left.status === "unknown") expect(left).not.toHaveProperty("identity");

    if (right.status === "unknown") expect(right).not.toHaveProperty("identity");

    return { ...vector, actual, leftResult: left, rightResult: right };
  });

  await writeFile(
    join(environment().artifacts, "treatment-consequence-vectors.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        oracle: "docs/operations/automation-consequence-vectors.md",
        observed,
      },
      null,
      2,
    ),
  );
});

test("public decision export preserves captured deduction and reports missing consequence facts", async () => {
  const f = await supplierFixture([
    { id: "account_payable", code: "2440", name: "Supplier payable" },
    { id: "account_input_vat", code: "2641", name: "Input VAT" },
    { id: "account_expense", code: "6000", name: "Synthetic expense" },
  ]);

  f.book.token = (await createSession(f.book)).token;

  const draft = await createDraft(f.book, {
    ...f.content,
    sourceTotalMinor: "12500",
    lines: f.content.lines.map((line) => ({
      ...line,
      taxMinor: "2500",
      sourceGrossMinor: "12500",
    })),
  });

  const review = await post(
    f.book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "swedish-purchase-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_payable",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic AUT03 captured facts",
      acknowledgeSyntheticOnly: true,
      taxPoint: { taxPointOn: "2026-09-22", basis: "document_date" },
      lineAssignments: draft.content.lines.map((line) => ({
        lineId: line.id,
        expenseAccountId: "account_expense",
        treatment: {
          basis: "full_deduction",
          rate: { numerator: "25", denominator: "100" },
          deduction: { numerator: "1", denominator: "1" },
          invoiceTaxRounding: "half_up",
          deductionRounding: "half_up",
          acceptancePolicy: "exact_match",
          toleranceMinor: "0",
        },
      })),
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const approval = await post(
    f.book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true },
    Acceptance.SupplierAcceptanceApproval,
  );

  const exported = await post(
    f.book,
    "/automation/decision-examples",
    { purpose: "training", selectedDecisionIds: [approval.id] },
    E.DecisionExampleExport,
  );

  expect(exported.examples).toHaveLength(1);
  expect(exported.versions.schema).toBe("decision_examples_v3");
  const consequence = exported.examples[0]!.consequence!;
  expect(consequence.builderVersion).toBe("treatment_consequence_v1");
  expect(consequence.treatments).toHaveLength(1);
  expect(consequence.treatments[0]!.capture).toMatchObject({
    accountId: "account_expense",
    originalCommitCutoff: "0",
    postingOn: "2026-09-22",
    vat: {
      category: null,
      profileIdentity: null,
      resolvedRate: { numerator: "25", denominator: "100" },
      deduction: { numerator: "1", denominator: "1" },
    },
    period: { id: "period_2026", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    dimensions: { requirements: [], assignments: [] },
  });
  expect(consequence.treatments[0]!.result).toEqual({
    status: "unknown",
    reasons: ["vat_category_not_captured", "vat_profile_not_captured"],
  });
  expect(consequence.treatments[0]!.result).not.toHaveProperty("identity");
  await writeFile(
    join(environment().artifacts, "treatment-consequence-export.json"),
    JSON.stringify(exported, null, 2),
  );
});
