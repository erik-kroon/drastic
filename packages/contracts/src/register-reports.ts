import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import { accountingErrors } from "./accounting-errors";

export const CreateRegisterReport = Schema.Struct({ asOfDate: Accounting.AccountingDate });
export const AgeBucket = Schema.Literals([
  "not_due",
  "days_1_30",
  "days_31_60",
  "days_61_90",
  "over_90",
]);
export const Ageing = Schema.Struct({
  not_due: Accounting.AggregateMinorUnits,
  days_1_30: Accounting.AggregateMinorUnits,
  days_31_60: Accounting.AggregateMinorUnits,
  days_61_90: Accounting.AggregateMinorUnits,
  over_90: Accounting.AggregateMinorUnits,
});
export const RegisterInvoice = Schema.Struct({
  id: Accounting.Identifier,
  direction: Commerce.Direction,
  counterpartyId: Accounting.Identifier,
  counterpartyRevision: Commerce.Version,
  counterpartyName: Schema.String,
  documentNumber: Schema.String,
  issuedOn: Accounting.AccountingDate,
  amountMinor: Accounting.MinorUnits,
  cancelledMinor: Schema.optional(Accounting.MinorUnits),
  effectiveAmountMinor: Schema.optional(Accounting.MinorUnits),
  cancellation: Schema.optional(Schema.NullOr(Commerce.InvoiceCancellationSummary)),
  controlAccountId: Accounting.Identifier,
  evidence: Commerce.EvidenceReference,
  recognition: Commerce.Recognition,
  revision: Commerce.InvoiceRevision,
  allocatedMinor: Accounting.AggregateMinorUnits,
  outstandingMinor: Accounting.AggregateMinorUnits,
  daysOverdue: Schema.Int,
  ageBucket: AgeBucket,
});
export const RegisterAllocation = Schema.Struct({
  receiptId: Accounting.Identifier,
  ordinal: Schema.Int,
  invoiceId: Accounting.Identifier,
  paymentVoucherId: Accounting.Identifier,
  paymentLineId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  amountMinor: Accounting.MinorUnits,
  planId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  committedAt: Schema.String,
});
export const RegisterLedgerLine = Schema.Struct({
  accountId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  sequence: Accounting.MinorUnits,
  ordinal: Schema.Int,
  postingDate: Accounting.AccountingDate,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
  invoiceId: Schema.NullOr(Accounting.Identifier),
  cancellationId: Schema.optional(Schema.NullOr(Accounting.Identifier)),
  registerContributionKind: Schema.optional(
    Schema.Literals(["recognition", "cancellation", "allocation", "unexplained"]),
  ),
  allocatedMinor: Accounting.AggregateMinorUnits,
  registerEffectMinor: Accounting.SignedMinorUnits,
  unexplainedMinor: Accounting.SignedMinorUnits,
});
export const RegisterControl = Schema.Struct({
  accountId: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  version: Commerce.Version,
  active: Schema.Boolean,
  direction: Commerce.Direction,
  recognizedMinor: Accounting.AggregateMinorUnits,
  cancelledMinor: Schema.optional(Accounting.AggregateMinorUnits),
  allocatedMinor: Accounting.AggregateMinorUnits,
  outstandingMinor: Accounting.AggregateMinorUnits,
  ledgerMinor: Accounting.SignedMinorUnits,
  differenceMinor: Accounting.SignedMinorUnits,
  unexplainedLineCount: Schema.Int,
  ageing: Ageing,
});
export const RegisterReportSummary = Schema.Struct({
  id: Accounting.Identifier,
  ordinal: Accounting.MinorUnits,
  kind: Schema.Literal("synthetic_register_snapshot_v1"),
  scope: Accounting.Scope,
  asOfDate: Accounting.AccountingDate,
  sequence: Accounting.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  profileVersion: Commerce.Version,
  knowledgeBasis: Schema.Literal("current_known_facts_at_capture"),
  coverage: Schema.Literal("not_established"),
  status: Schema.Literals(["no_declared_accounts", "balanced", "differences"]),
  invoiceCount: Schema.Int,
  allocationCount: Schema.Int,
  ledgerLineCount: Schema.Int,
  accountCount: Schema.Int,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});
export const RegisterReport = Schema.Struct({
  ...RegisterReportSummary.fields,
  controls: Schema.Array(RegisterControl),
  invoices: Schema.Array(RegisterInvoice),
  allocations: Schema.Array(RegisterAllocation),
  ledgerLines: Schema.Array(RegisterLedgerLine),
});
export const RegisterInventoryCursor = Schema.String.check(
  Schema.isPattern(/^rr1_(?:[a-f0-9]{2})+$/),
  Schema.isMaxLength(2048),
);
export const RegisterReportPage = Schema.Struct({
  scope: Accounting.Scope,
  cutoff: Accounting.MinorUnits,
  total: Accounting.AggregateMinorUnits,
  first: RegisterInventoryCursor,
  items: Schema.Array(RegisterReportSummary).check(Schema.isMaxLength(20)),
  next: Schema.NullOr(RegisterInventoryCursor),
});
export const RegisterReportQuery = Schema.Struct({
  after: Schema.optional(RegisterInventoryCursor),
});
const path = "/v1/entities/:entityId/books/:bookId/commerce/register-snapshots";
export const RegisterReportsApi = HttpApiGroup.make("registerReports").add(
  HttpApiEndpoint.post("createRegisterReport", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateRegisterReport.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RegisterReport,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getRegisterReport", `${path}/:id`, {
    params: Accounting.ChangePath,
    success: RegisterReport,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listRegisterReports", path, {
    params: Accounting.Scope,
    query: RegisterReportQuery,
    success: RegisterReportPage,
    error: accountingErrors,
  }),
);
export const RegisterReportCapabilities = {
  commerce_create_register_report: {
    description:
      "Save a bounded immutable synthetic invoice ageing and declared-control-account snapshot. Uses current known facts with an economic as-of date; never certifies source completeness or posts accounting.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: CreateRegisterReport,
    }),
    output: RegisterReport,
    readOnly: false,
  },
  commerce_get_register_report: {
    description:
      "Read the complete immutable invoice register snapshot, including exact ledger contributions and allocation identities.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: RegisterReport,
    readOnly: true,
  },
  commerce_list_register_reports: {
    description:
      "Page one scope-bound saved-report inventory at a fixed ordinal cutoff. Follow next or first unchanged; omit after to capture a new inventory. This is not a company invoice inventory.",
    input: Schema.Struct({ scope: Accounting.Scope, ...RegisterReportQuery.fields }),
    output: RegisterReportPage,
    readOnly: true,
  },
};
