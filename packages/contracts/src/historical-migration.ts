import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
const Year = A.Identifier;
const Control = Schema.Struct({
  accountId: A.Identifier,
  signedMinor: A.SignedMinorUnits,
  basis: Label,
});
const Receipt = Schema.Struct({
  id: A.Identifier,
  changeSetId: A.Identifier,
  voucherId: A.Identifier,
  planDigest: A.Digest,
  sequence: Schema.String,
  voucherNumber: Schema.String,
  committedAt: Schema.String,
});
export const SelectBasis = Schema.Struct({
  fiscalYearId: Year,
  mode: Schema.Literals(["full_history", "opening_set"]),
  cutoverOn: A.AccountingDate,
  sourcePlanId: A.Identifier,
  sourceDigest: A.Digest,
  changeSetId: Schema.NullOr(A.Identifier),
  controls: Schema.Array(Control).check(Schema.isMinLength(2), Schema.isMaxLength(500)),
  rationale: Label,
});
export const Basis = Schema.Struct({
  ...SelectBasis.fields,
  actorId: A.Identifier,
  selectedAt: Schema.String,
  voucherId: Schema.optional(Schema.NullOr(A.Identifier)),
  ledgerReceipt: Schema.optional(Receipt),
});
export const RunStart = Schema.Struct({
  id: A.Identifier,
  sourceRunId: A.Identifier,
  fiscalYearId: Year,
  planDigest: A.Digest,
  nextOrdinal: Schema.Int,
  fence: Schema.String,
  status: Schema.Literals(["running", "paused", "posted"]),
  sourceYear: Schema.optional(Schema.String),
});
const Posting = Schema.Struct({
  ordinal: Schema.Int,
  sourceReference: Schema.String,
  sourceDigest: A.Digest,
  ledgerReceipt: Receipt,
});
export const Run = Schema.Struct({ ...RunStart.fields, items: Schema.Array(Posting) });
export const Chunk = Schema.Struct({
  id: A.Identifier,
  nextOrdinal: Schema.Int,
  fence: Schema.String,
  status: Schema.Literals(["running", "paused", "posted"]),
  items: Schema.Array(Posting),
});
export const Fence = Schema.Struct({
  id: A.Identifier,
  nextOrdinal: Schema.Int,
  fence: Schema.String,
  status: Schema.Literals(["running", "paused", "posted"]),
});

const Payment = Schema.Struct({
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  sourceAccount: Schema.String.check(Schema.isPattern(/^[0-9]{4}$/)),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  amountMinor: A.MinorUnits,
  sourceDate: Schema.NullOr(A.AccountingDate),
  basis: Label,
});
const HistoricalMatch = Schema.Struct({
  sourceIdentity: Payment.fields.sourceIdentity,
  itemIdentity: Payment.fields.sourceIdentity,
  paymentIdentity: Payment.fields.sourceIdentity,
  amountMinor: A.MinorUnits,
  sourceDate: Schema.NullOr(A.AccountingDate),
  basis: Label,
});
const AmountControl = Schema.Struct({
  sourceAccount: Payment.fields.sourceAccount,
  currency: Payment.fields.currency,
  independentTotalMinor: A.MinorUnits,
  basis: Label,
});
export const AdmitItems = Schema.Struct({
  planDigest: A.Digest,
  payments: Schema.Array(Payment).check(Schema.isMaxLength(500)),
  matches: Schema.Array(HistoricalMatch).check(Schema.isMaxLength(500)),
  paymentControls: Schema.Array(AmountControl).check(Schema.isMaxLength(500)),
  matchControls: Schema.Array(AmountControl).check(Schema.isMaxLength(500)),
  chronology: Schema.Literals(["dated_source", "unknown"]),
  rationale: Label,
});
export const ItemAdmission = Schema.Struct({
  id: A.Identifier,
  sourcePlanId: A.Identifier,
  openItems: Schema.Array(
    Schema.Struct({
      sourceIdentity: Payment.fields.sourceIdentity,
      sourceAccount: Payment.fields.sourceAccount,
      currency: Payment.fields.currency,
      originalMinor: A.SignedMinorUnits,
      outstandingMinor: A.SignedMinorUnits,
      asOf: A.AccountingDate,
      assertedState: Schema.Literals(["unpaid", "partly_paid", "unknown"]),
      detailAvailability: Schema.Literals(["source_asserted", "unreconstructable"]),
      basis: Label,
    }),
  ),
  openItemControls: Schema.Array(
    Schema.Struct({
      sourceAccount: Payment.fields.sourceAccount,
      currency: Payment.fields.currency,
      independentOutstandingMinor: A.SignedMinorUnits,
      basis: Label,
    }),
  ),
  ...AdmitItems.fields,
  financialEffect: Schema.Literal("none"),
  admittedBy: A.Identifier,
  admittedAt: Schema.String,
  digest: A.Digest,
});

export const PlanItemAdmission = Schema.NullOr(ItemAdmission);

const base = "/v1/entities/:entityId/books/:bookId";
const identified = { params: A.ChangePath, error: accountingErrors };
const mutation = { ...identified, headers: A.IdempotencyHeaders };
export const HistoricalMigrationApi = HttpApiGroup.make("historicalMigration")
  .add(
    HttpApiEndpoint.post("selectHistoricalBasis", `${base}/historical-bases`, {
      ...mutation,
      payload: SelectBasis,
      success: Basis,
    }),
  )
  .add(
    HttpApiEndpoint.get("getHistoricalBasis", `${base}/historical-bases/:id`, {
      ...identified,
      success: Basis,
    }),
  )
  .add(
    HttpApiEndpoint.post("postHistoricalOpening", `${base}/historical-bases/:id/post`, {
      ...mutation,
      payload: Schema.Struct({ planDigest: A.Digest, approvalId: A.Identifier }),
      success: Basis,
    }),
  )
  .add(
    HttpApiEndpoint.post("startSieFinancialRun", `${base}/sie-runs/:id/financial-runs`, {
      ...mutation,
      payload: Schema.Struct({ fiscalYearId: Year, planDigest: A.Digest }),
      success: RunStart,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSieFinancialRun", `${base}/sie-financial-runs/:id`, {
      ...identified,
      success: Run,
    }),
  )
  .add(
    HttpApiEndpoint.post("advanceSieFinancialRun", `${base}/sie-financial-runs/:id/chunks`, {
      ...mutation,
      payload: Schema.Struct({
        fence: Schema.String,
        planDigest: A.Digest,
        firstOrdinal: Schema.Int,
        items: Schema.Array(
          Schema.Struct({
            changeSetId: A.Identifier,
            planDigest: A.Digest,
            approvalId: A.Identifier,
          }),
        ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
      }),
      success: Chunk,
    }),
  )
  .add(
    HttpApiEndpoint.post("admitHistoricalItems", `${base}/sie-plans/:id/historical-items`, {
      ...mutation,
      payload: AdmitItems,
      success: ItemAdmission,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPlanHistoricalItems", `${base}/sie-plans/:id/historical-items`, {
      ...identified,
      success: PlanItemAdmission,
    }),
  )
  .add(
    HttpApiEndpoint.get("getHistoricalItems", `${base}/historical-items/:id`, {
      ...identified,
      success: ItemAdmission,
    }),
  )
  .add(
    HttpApiEndpoint.post("reclaimSieFinancialRun", `${base}/sie-financial-runs/:id/lease`, {
      ...mutation,
      payload: Schema.Struct({ action: Schema.Literals(["pause", "resume"]) }),
      success: Fence,
    }),
  );
