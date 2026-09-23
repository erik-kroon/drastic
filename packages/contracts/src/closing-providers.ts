import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";

// Exact private provider contracts consumed under the closing/review book barrier.
export const OwnerPeriodStatus = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  coverage: Schema.Literal("not_established"),
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  registeredRecordCount: Schema.Int,
  unresolvedReviewCount: Schema.Int,
  unlinkedRecordCount: Schema.Int,
  sourceDigest: Accounting.Digest,
  blockers: Schema.Array(Schema.String),
});
export const ExpenseTaxDependencies = Schema.Struct({
  basisDigest: Accounting.Digest,
  sourceCount: Schema.Int,
  // Absent on historical dependencies captured before expense-source withdrawal.
  withdrawnSourceCount: Schema.optional(Schema.Int),
  missingOrStaleReviewCount: Schema.Int,
  coverageEstablished: Schema.Literal(false),
  productionProfileApproved: Schema.Literal(false),
  vatReturnReady: Schema.Literal(false),
  postingEnabled: Schema.Literal(false),
});
export const VatReturnDependencies = Schema.Struct({
  basisDigest: Accounting.Digest,
  sourceCount: Schema.Int,
  draftCount: Schema.Int,
  // Absent only on historical snapshots captured before tax-account integration.
  taxAccounts: Schema.optional(
    Schema.Struct({
      statementCount: Schema.Int,
      controlCount: Schema.Int,
      statementInventoryDigest: Accounting.Digest,
      controlInventoryDigest: Accounting.Digest,
      // Absent on snapshots captured before exact tax-account matching.
      matching: Schema.optional(
        Schema.Struct({
          matchCount: Schema.Int,
          unmatchCount: Schema.Int,
          matchInventoryDigest: Accounting.Digest,
          unmatchInventoryDigest: Accounting.Digest,
          activeStateDigest: Accounting.Digest,
        }),
      ),
    }),
  ),
  coverageEstablished: Schema.Literal(false),
  ledgerReconciled: Schema.Literal(false),
  legalProfileActive: Schema.Literal(false),
  filingReady: Schema.Literal(false),
});
export const OwnerTaxStatus = Schema.Struct({
  owners: OwnerPeriodStatus,
  expenseTax: ExpenseTaxDependencies,
  // Absent only on historical snapshots captured before the VAT dependency provider.
  vatReturns: Schema.optional(VatReturnDependencies),
});

export const ClosingFamily = Schema.Literals([
  "bank_sources",
  "invoices",
  "tax",
  "payroll",
  "assets_deferrals",
  "foreign_currency",
  "owner_balances",
  "other_balances",
  "external_schedules",
  "disclosures",
]);
export const ClosingFamilyStatus = Schema.Literals([
  "required",
  "not_applicable",
  "unsupported",
  "unknown",
]);
export const ClosingFamilyDeclaration = Schema.Struct({
  family: ClosingFamily,
  status: ClosingFamilyStatus,
  reviewedOn: Accounting.AccountingDate,
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
});
export const RetainedClosingFamily = Schema.Struct({
  ...ClosingFamilyDeclaration.fields,
  evidenceSha256: Schema.String,
});
export const ClosingFamilyCheck = Schema.Struct({
  code: Schema.String,
  status: Schema.Literals(["passed", "failed", "unavailable"]),
  detail: Schema.String,
});
export const ClosingFamilyReadiness = Schema.Struct({
  family: ClosingFamily,
  declaration: Schema.NullOr(RetainedClosingFamily),
  providerVersion: Schema.String,
  representedCount: Schema.NullOr(Schema.Int),
  checks: Schema.Array(ClosingFamilyCheck),
  passed: Schema.Boolean,
  coverage: Schema.Literal("not_established"),
});
