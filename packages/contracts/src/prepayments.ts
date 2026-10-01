import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { CommandReceipt } from "./reconciliation";
import { accountingErrors as errors } from "./accounting-errors";

// NEXT-31 owner contract: invoice-linked prepayments and accrued-cost true-up,
// extending the existing subledger schedule owner.
//
// The schedule already allocates a reviewed cost over future occurrences. This
// adds the two relationships it could not express: which purchase recognition
// a deferral belongs to, and which invoice finally resolved an accrued cost.
//
// Three things this owner refuses, and they are the point.
//
// The cost excludes deductible input VAT. Deferring changes when accounting
// expense is recognized; it never moves a VAT tax point, so no tax fact is
// created here and a valid tax invoice is not accepted as proof of service
// coverage. A residual is never a plug: the true-up is a computed difference
// between the actual net cost and what was already consumed, signed in the
// direction of the error. And one invoice resolves an accrual once, bound to
// the invoice's own retained identity rather than to a command key, so
// re-presenting it under a new key still collides.

const Ref = Accounting.Identifier;

const AllocationPolicy = Schema.Literals(["daily", "equal_months", "contractual_weights"]);

const ResidualPolicy = Schema.Literals(["first_installment", "last_installment"]);

export const ServiceCoveragePeriod = Schema.Struct({
  periodId: Ref,
  startsOn: Accounting.AccountingDate,
  endsOnExclusive: Accounting.AccountingDate,
});

export type ServiceCoveragePeriod = typeof ServiceCoveragePeriod.Type;

// A prepayment is a purchase cost that spans reviewed service coverage. The
// caller names the recognition, the schedule and the reviewed service window;
// the owner derives the split from that coverage and the cutoff.
export const LinkExpenseCostBasis = Schema.Struct({
  purchaseRecognitionId: Ref,
  scheduleId: Ref,
  // The cost excluding deductible input VAT, as an exact integer string. The
  // owner never computes it from a tax fact, and never infers it from the
  // invoice total.
  costMinor: Accounting.SignedMinorUnits,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  serviceStartsOn: Accounting.AccountingDate,
  serviceEndsOnExclusive: Accounting.AccountingDate,
  // Reviewed evidence that the service spans the asserted window. A tax
  // invoice alone does not establish this.
  serviceEvidenceId: Ref,
  reviewedCutoffOn: Accounting.AccountingDate,
  policy: AllocationPolicy,
  residual: ResidualPolicy,
  contractualWeights: Schema.Array(
    Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,37})$/)),
  ).check(Schema.isMaxLength(120)),
  periods: Schema.Array(ServiceCoveragePeriod).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(120),
  ),
  prepaidAccountId: Ref,
  expenseAccountId: Ref,
  rationale: Accounting.Description,
});

export type LinkExpenseCostBasis = typeof LinkExpenseCostBasis.Type;

export const PrepaymentPlanView = Schema.Struct({
  basisId: Ref,
  purchaseRecognitionId: Ref,
  scheduleId: Ref,
  costMinor: Accounting.SignedMinorUnits,
  // What the cutoff says is already consumed, and what remains future. They
  // sum to the cost exactly, because the residual is allocated, not rounded.
  recognizedNowMinor: Accounting.SignedMinorUnits,
  futureMinor: Accounting.SignedMinorUnits,
  installments: Schema.Array(
    Schema.Struct({
      periodId: Ref,
      shareMinor: Accounting.SignedMinorUnits,
      consumed: Schema.Boolean,
    }),
  ),
  // The expense cost carried no tax fact, and this records that rather than
  // leaving it implied.
  taxTreatment: Schema.Literal("no_tax_fact_defers_expense_timing_only"),
  receipt: CommandReceipt,
});

export type PrepaymentPlanView = typeof PrepaymentPlanView.Type;

export const RecordAccruedCost = Schema.Struct({
  // The review identity of the service already received. A later invoice that
  // describes a different service cannot resolve this accrual.
  serviceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  expectedCostMinor: Accounting.AggregateMinorUnits,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  expenseAccountId: Ref,
  accruedLiabilityAccountId: Ref,
  // Evidence that the service was received and that the estimate was
  // reviewed. An estimate with no evidence is refused.
  evidenceId: Ref,
  reviewedOn: Accounting.AccountingDate,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
});

export type RecordAccruedCost = typeof RecordAccruedCost.Type;

export const AccruedCostView = Schema.Struct({
  accrualId: Ref,
  serviceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  originalMinor: Accounting.AggregateMinorUnits,
  // Derived from the retained resolutions, never stated by the caller.
  resolvedMinor: Accounting.AggregateMinorUnits,
  remainingMinor: Accounting.AggregateMinorUnits,
  expenseAccountId: Ref,
  liabilityAccountId: Ref,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  resolutions: Schema.Array(
    Schema.Struct({
      resolutionId: Ref,
      invoiceIdentity: Ref,
      consumedMinor: Accounting.AggregateMinorUnits,
      actualNetMinor: Accounting.AggregateMinorUnits,
      deductibleTaxMinor: Accounting.AggregateMinorUnits,
      trueUpMinor: Accounting.SignedMinorUnits,
      changeSetId: Ref,
    }),
  ).check(Schema.isMaxLength(50)),
  receipt: CommandReceipt,
});

export type AccruedCostView = typeof AccruedCostView.Type;

export const ResolveAccruedCost = Schema.Struct({
  accrualId: Ref,
  // The invoice's own retained identity, not a command key. One invoice
  // resolves an accrual once even if it is presented under a new key.
  invoiceIdentity: Ref,
  invoiceEvidenceId: Ref,
  // The service the invoice actually covers. It must be the same service the
  // accrual was raised for; a different one refuses.
  serviceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // How much of the accrual this invoice's service consumed. It may not exceed
  // what remains.
  consumedMinor: Accounting.AggregateMinorUnits,
  actualNetMinor: Accounting.AggregateMinorUnits,
  deductibleTaxMinor: Accounting.AggregateMinorUnits,
  expenseAccountId: Ref,
  taxAccountId: Ref,
  payableAccountId: Ref,
  accruedLiabilityAccountId: Ref,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  rationale: Accounting.Description,
});

export type ResolveAccruedCost = typeof ResolveAccruedCost.Type;

export const AccrualResolutionView = Schema.Struct({
  resolutionId: Ref,
  accrualId: Ref,
  invoiceIdentity: Ref,
  consumedMinor: Accounting.AggregateMinorUnits,
  actualNetMinor: Accounting.AggregateMinorUnits,
  deductibleTaxMinor: Accounting.AggregateMinorUnits,
  // Positive on underestimate, negative on overestimate. A computed
  // difference, never a plug.
  trueUpMinor: Accounting.SignedMinorUnits,
  payableMinor: Accounting.AggregateMinorUnits,
  remainingMinor: Accounting.AggregateMinorUnits,
  changeSetId: Ref,
  journalIds: Schema.Array(Ref),
  receipt: CommandReceipt,
});

export type AccrualResolutionView = typeof AccrualResolutionView.Type;

export const ReadAccruedCost = Schema.Struct({ accrualId: Ref });

export type ReadAccruedCost = typeof ReadAccruedCost.Type;

const path = "/v1/entities/:entityId/books/:bookId/subledger/accrued-costs";

export const PrepaymentsApi = HttpApiGroup.make("prepayments")
  .add(
    HttpApiEndpoint.post("linkExpenseCostBasis", `${path}/bases`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: LinkExpenseCostBasis.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PrepaymentPlanView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordAccruedCost", path, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: RecordAccruedCost.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: AccruedCostView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("resolveAccruedCost", `${path}/resolutions`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ResolveAccruedCost.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: AccrualResolutionView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("readAccruedCost", `${path}/state`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ReadAccruedCost.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: AccruedCostView,
      error: errors,
    }),
  );

// Agent surface. Read-only. An agent may ask what an accrual was raised for,
// how much remains and how it was resolved. It may not link a recognition to a
// schedule, raise an accrual or resolve one: each of those is a reviewed
// statement about what service was received and what it cost, and the
// resolution posts a signed true-up that must not come from an agent's
// inference.
export const PrepaymentsCapabilities = {
  subledger_read_accrued_cost: {
    description:
      "Read one accrued cost: the reviewed service identity it was raised for, its original estimate, the total resolved and the remaining capacity derived from the retained resolutions, and each resolution's consumed coverage, actual net cost, deductible tax and signed true-up. A negative true-up means the estimate was an overestimate and the expense was credited.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReadAccruedCost,
    }),
    output: AccruedCostView,
    readOnly: true,
  },
};
