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
  missingOrStaleReviewCount: Schema.Int,
  coverageEstablished: Schema.Literal(false),
  productionProfileApproved: Schema.Literal(false),
  vatReturnReady: Schema.Literal(false),
  postingEnabled: Schema.Literal(false),
});
export const OwnerTaxStatus = Schema.Struct({
  owners: OwnerPeriodStatus,
  expenseTax: ExpenseTaxDependencies,
});
