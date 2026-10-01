import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { CommandReceipt } from "./reconciliation";
import { accountingErrors as errors } from "./accounting-errors";
import * as Commerce from "./commerce";
import * as Profiles from "./company-profiles";
import { SupplierLineAssignment } from "./supplier-acceptance";
import * as Cash from "@open-erp/domain/cash-method";
import * as Credits from "./cash-credits";

export * from "./cash-credits";

// Cash-method writes compose the native invoice, allocation and year-end owners.
// The supported purchase profile is synthetic; no company eligibility is inferred.
//
// A qualified cash-method book would recognize a document when it is paid,
// and once-only at year end recognize the unpaid remainder. The commercial balance and the
// accounting recognition stay separate throughout: paying an invoice reduces
// its commercial debt; recognizing an unpaid portion does not pay that debt.
//
// Eligibility is never inferred. A caller-supplied witness alone does not
// establish a reviewed accounting-method profile or undo an accrual posting.
// Nothing in this contract infers the method from a company size, a document
// label or a relabelled accrual effect.
//
// Every recognition names the trigger that caused it. A payment recognition
// cites the payment's own identity; a year-end recognition cites a real cutover
// run. There is no recognition without one, so no amount can be recognized
// because a date arrived.

const Ref = Accounting.Identifier;

const Direction = Schema.Literals(["purchase", "sale"]);

// Commercial-only admission. Amounts, evidence and document identity come from
// the retained draft, never from this command. This bounded profile is synthetic.
export const AdmitCashInvoice = Schema.Struct({
  profile: Schema.Literal("synthetic-cash-method-domestic-v1"),
  draftId: Ref,
  expectedRevision: Commerce.Version,
  expectedDigest: Accounting.Digest,
  controlAccountId: Ref,
  inputVatAccountId: Ref,
  lineAssignments: Schema.Array(SupplierLineAssignment).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  reason: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const CashInvoiceBasis = Schema.Struct({
  profile: AdmitCashInvoice.fields.profile,
  direction: Schema.Literal("purchase"),
  draftId: Ref,
  draftRevision: Commerce.Version,
  draftDigest: Accounting.Digest,
  methodFactRevisionId: Ref,
  postingWitness: Profiles.ProfileWitness,
  vatWitness: Profiles.ProfileWitness,
  vatMethod: Schema.Literal("cash"),
  controlAccountId: Ref,
  inputVatAccountId: Ref,
  componentPolicy: Schema.Literal("tax_first_cumulative_v1"),
  rounding: Schema.Literal("half_up"),
  lines: Schema.Array(
    Schema.Struct({
      sourceLineId: Ref,
      expenseAccountId: Ref,
      netMinor: Accounting.MinorUnits,
      taxMinor: Accounting.MinorUnits,
      grossMinor: Accounting.MinorUnits,
      deductibleMinor: Accounting.MinorUnits,
      treatment: SupplierLineAssignment.fields.treatment,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export const CashPaymentSource = Schema.Struct({
  eventId: Ref,
  fiscalYearId: Ref,
  voucherId: Ref,
  lineId: Ref,
  bankLineId: Ref,
  bankAccountId: Ref,
  controlAccountId: Ref,
  principalMinor: Accounting.MinorUnits,
  postingDate: Accounting.AccountingDate,
  accountingPeriodId: Ref,
  changeSetId: Ref,
  series: Schema.String,
  statementId: Ref,
  rowOrdinal: Schema.Int,
  evidenceId: Ref,
  sha256: Schema.String,
});

export const CashAllocationSelection = Schema.Struct({
  source: CashPaymentSource,
  accounts: Schema.Array(Schema.Struct({ id: Ref, version: Schema.String })),
  invoices: Schema.Array(
    Schema.Struct({
      invoiceId: Ref,
      invoiceEvidence: Commerce.EvidenceReference,
      ordinal: Schema.Int,
      paidGrossMinor: Accounting.MinorUnits,
      basis: CashInvoiceBasis,
      methodFactRevisionId: Ref,
      postingWitness: Profiles.ProfileWitness,
      vatWitness: Profiles.ProfileWitness,
      lines: Schema.Array(
        Schema.Struct({
          lineId: Ref,
          before: Cash.CashMethodLine,
          after: Cash.CashMethodLine,
          paidGrossMinor: Accounting.MinorUnits,
          newGrossMinor: Accounting.MinorUnits,
          netMinor: Accounting.MinorUnits,
          taxMinor: Accounting.MinorUnits,
          deductibleMinor: Accounting.MinorUnits,
          taxJournalIndex: Schema.NullOr(Schema.Int),
        }),
      ),
    }),
  ),
  journal: Cash.CashJournalLines,
});

export const CashAllocationPrepared = Schema.Struct({
  selection: CashAllocationSelection,
  postingPlan: Schema.NullOr(Accounting.ChangeSet),
});

export const PrepareCashYearEnd = Schema.Struct({
  fiscalYearId: Ref,
  cutoffOn: Accounting.AccountingDate,
  evidenceId: Ref,
  rationale: Accounting.Description,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
});

const YearEndMember = Schema.Struct({
  invoiceId: Ref,
  issuedOn: Accounting.AccountingDate,
  revision: Commerce.Version,
  allocationVersion: Accounting.MinorUnits,
  invoiceEvidence: Commerce.EvidenceReference,
  basis: CashInvoiceBasis,
  methodFactRevisionId: Ref,
  postingWitness: Profiles.ProfileWitness,
  vatWitness: Profiles.ProfileWitness,
  lines: CashAllocationSelection.fields.invoices.value.fields.lines,
});

export const CashYearEndSelection = Schema.Struct({
  input: PrepareCashYearEnd,
  eventId: Ref,
  reviewEvidence: Commerce.EvidenceReference,
  fiscalYear: Schema.Struct({
    id: Ref,
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
  }),
  period: Schema.Struct({ id: Ref, version: Schema.String }),
  profileVersion: Schema.String,
  writerEpoch: Schema.String,
  membershipEpoch: Schema.String,
  methodFactRevisionId: Ref,
  postingWitness: Profiles.ProfileWitness,
  vatWitness: Profiles.ProfileWitness,
  accounts: CashAllocationSelection.fields.accounts,
  invoices: Schema.Array(YearEndMember).check(Schema.isMaxLength(500)),
  journal: Cash.CashJournalLines,
});

export const CashYearEndPlan = Schema.Struct({
  id: Ref,
  scope: Accounting.Scope,
  selection: CashYearEndSelection,
  postingPlan: Schema.NullOr(Accounting.ChangeSet),
  createdBy: Ref,
  createdAt: Schema.String,
  digest: Accounting.Digest,
});

export const ApproveCashYearEnd = Schema.Struct({ planDigest: Accounting.Digest });

export const ExecuteCashYearEnd = Schema.Struct({ planDigest: Accounting.Digest, approvalId: Ref });

export const CashYearEndApproval = Schema.Struct({
  id: Ref,
  planId: Ref,
  planDigest: Accounting.Digest,
  actorId: Ref,
  expiresAt: Schema.String,
  cashPostingApprovalId: Schema.NullOr(Ref),
  receipt: CommandReceipt,
});

export const CashYearEndReceipt = Schema.Struct({
  id: Ref,
  scope: Accounting.Scope,
  planId: Ref,
  approvalId: Ref,
  fiscalYearId: Ref,
  cutoffOn: Accounting.AccountingDate,
  memberCount: Schema.Int,
  recognizedLineCount: Schema.Int,
  recognizedGrossMinor: Accounting.AggregateMinorUnits,
  netMinor: Accounting.AggregateMinorUnits,
  taxMinor: Accounting.AggregateMinorUnits,
  populationDigest: Accounting.Digest,
  members: Schema.Array(YearEndMember),
  postingReceipt: Schema.NullOr(Accounting.ExecutionReceipt),
  committedAt: Schema.String,
  receipt: CommandReceipt,
});

export const RegisterCashMethodLine = AdmitCashInvoice;

export type RegisterCashMethodLine = typeof RegisterCashMethodLine.Type;

export const CashMethodLineView = Schema.Struct({
  lineId: Ref,
  invoiceId: Ref,
  sourceLineId: Ref,
  direction: Direction,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  originalGrossMinor: Accounting.AggregateMinorUnits,
  creditedGrossMinor: Accounting.AggregateMinorUnits,
  paidGrossMinor: Accounting.AggregateMinorUnits,
  recognizedGrossMinor: Accounting.AggregateMinorUnits,
  // The two open balances, both derived rather than stated. Commercial unpaid
  // is what the counterparty still owes; recognized unpaid is what the book has
  // taken but not yet been paid for.
  commercialUnpaidMinor: Accounting.AggregateMinorUnits,
  recognizedUnpaidMinor: Accounting.AggregateMinorUnits,
  profileWitness: Accounting.Description,
  // Whether the book already recognized the unpaid remainder at year end. A
  // second run over the same period is refused, so this is a fact, not a
  // guess.
  yearEndRecognized: Schema.Boolean,
  receipt: CommandReceipt,
});

export type CashMethodLineView = typeof CashMethodLineView.Type;

export const RecognizeCashPayment = Schema.Struct({
  allocationPlanId: Ref,
  planDigest: Accounting.Digest,
  approvalId: Ref,
});

export type RecognizeCashPayment = typeof RecognizeCashPayment.Type;

export const RunCashMethodYearEnd = PrepareCashYearEnd;

export type RunCashMethodYearEnd = typeof RunCashMethodYearEnd.Type;

export const ReadCashMethodLine = Schema.Struct({ lineId: Ref });

export type ReadCashMethodLine = typeof ReadCashMethodLine.Type;

const path = "/v1/entities/:entityId/books/:bookId/commerce/cash-method";

export const CashMethodApi = HttpApiGroup.make("cashMethod")
  .add(
    HttpApiEndpoint.post(
      "admitCashMethodInvoice",
      "/v1/entities/:entityId/books/:bookId/commerce/invoices/cash-method",
      {
        params: Accounting.Scope,
        headers: Accounting.IdempotencyHeaders,
        payload: AdmitCashInvoice.annotate({ parseOptions: { onExcessProperty: "error" } }),
        success: Commerce.Invoice,
        error: errors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("registerCashMethodLine", `${path}/lines`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: RegisterCashMethodLine.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: Commerce.Invoice,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("recognizeCashPayment", `${path}/payments`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: RecognizeCashPayment.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: Commerce.AllocationReceipt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("runCashMethodYearEnd", `${path}/year-end`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: PrepareCashYearEnd.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashYearEndPlan,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approveCashYearEnd", `${path}/year-end/:id/approvals`, {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ApproveCashYearEnd.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashYearEndApproval,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("executeCashYearEnd", `${path}/year-end/:id/execute`, {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: ExecuteCashYearEnd.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashYearEndReceipt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("prepareCashCredit", `${path}/credits`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: Credits.PrepareCashCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: Credits.CashCreditPlan,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approveCashCredit", `${path}/credits/:id/approvals`, {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: Credits.ApproveCashCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: Credits.CashCreditApproval,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("executeCashCredit", `${path}/credits/:id/execute`, {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: Credits.ExecuteCashCredit.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: Credits.CashCreditReceipt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("readCashMethodLine", `${path}/lines/state`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ReadCashMethodLine.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashMethodLineView,
      error: errors,
    }),
  );

// Agent surface. Read-only. An agent may ask how much of a document is paid,
// how much is recognized and how much remains commercially unpaid. It may not
// register a line, recognize a payment or run a year end: each of those is a
// reviewed statement about which accounting method a book uses, and the
// year-end run in particular decides a whole population's recognition.
export const CashMethodCapabilities = {
  commerce_read_cash_method_line: {
    description:
      "Read one cash-method line: its original and credited gross, the paid and recognized prefixes, and the commercial and recognized unpaid balances derived from them, with the reviewed profile witness and whether a year-end run has already recognized the unpaid remainder. A recognized-unpaid balance is what the book has taken but not yet been paid for, which is not the same as what the counterparty still owes.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReadCashMethodLine,
    }),
    output: CashMethodLineView,
    readOnly: true,
  },
};
