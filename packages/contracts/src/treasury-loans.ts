import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Loan from "@open-erp/domain/loan-lifecycle";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt, EvidenceReference } from "./commerce";
import { PostedEffect } from "./owner-register";

const metadata = {
  digest: Accounting.Digest,
  createdAt: Schema.String,
  receipt: CommandReceipt,
};

export const AdoptLoan = Schema.Struct({
  principalEffectId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  coverageStartOn: Accounting.AccountingDate,
  convention: Loan.DayCountConvention,
  interestExpenseAccountId: Accounting.Identifier,
  accruedInterestLiabilityAccountId: Accounting.Identifier,
  feeExpenseAccountId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const RetainedLoan = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  input: AdoptLoan,
  principal: PostedEffect,
  evidence: EvidenceReference,
  principalEffectiveConvention: Schema.Literal("end_of_day"),
  roundingPolicy: Schema.Literal("cumulative_half_up"),
  allocationRule: Schema.Literal("explicit_split"),
  ledgerDeltaMinor: Schema.Literal("0"),
  legalPolicyApproved: Schema.Literal(false),
  ...metadata,
});

export const RecordLoanRate = Schema.Struct({
  ...Loan.RateSegment.fields,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const LoanRate = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  loanId: Accounting.Identifier,
  input: RecordLoanRate,
  evidence: EvidenceReference,
  ...metadata,
});

const journalInput = {
  evidenceId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
};

export const PrepareLoanAccrual = Schema.Struct({
  kind: Schema.Literal("accrual"),
  coverageEndExclusiveOn: Accounting.AccountingDate,
  ...journalInput,
});

export const PrepareLoanRepayment = Schema.Struct({
  kind: Schema.Literal("repayment"),
  statementId: Accounting.Identifier,
  rowOrdinal: Schema.Int.check(Schema.isGreaterThan(0)),
  bankAccountId: Accounting.Identifier,
  principalPartMinor: Accounting.MinorUnits,
  interestPartMinor: Accounting.MinorUnits,
  feePartMinor: Accounting.MinorUnits,
  feeEvidenceId: Schema.NullOr(Accounting.Identifier),
  ...journalInput,
});

export const PrepareLoanReview = Schema.Union([PrepareLoanAccrual, PrepareLoanRepayment]);

export const LoanBalance = Schema.Struct({
  principalRemainingMinor: Accounting.MinorUnits,
  accruedInterestMinor: Accounting.MinorUnits,
  paidInterestMinor: Accounting.MinorUnits,
  interestRemainingMinor: Accounting.MinorUnits,
  coverageEndExclusiveOn: Schema.NullOr(Accounting.AccountingDate),
});

export const LoanBasis = Schema.Struct({
  ...LoanBalance.fields,
  loanDigest: Accounting.Digest,
  rateDigests: Schema.Array(Accounting.Digest),
  eventDigests: Schema.Array(Accounting.Digest),
  principalEvents: Schema.Array(Loan.PrincipalEvent),
  allocations: Schema.Array(
    Schema.Struct({
      receiptId: Accounting.Identifier,
      settlementId: Accounting.Identifier,
      postingDate: Accounting.AccountingDate,
      effectiveOn: Accounting.AccountingDate,
      amountMinor: Accounting.MinorUnits,
    }),
  ),
  versions: Schema.JsonObject,
  cashSource: Schema.NullOr(
    Schema.Struct({
      statementId: Accounting.Identifier,
      rowOrdinal: Schema.Int,
      accountId: Accounting.Identifier,
      evidenceId: Accounting.Identifier,
      evidenceSha256: Schema.String,
      observedOn: Accounting.AccountingDate,
      amountMinor: Accounting.SignedMinorUnits,
    }),
  ),
});

export const LoanReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  loanId: Accounting.Identifier,
  input: PrepareLoanReview,
  basis: LoanBasis,
  calculation: Schema.NullOr(Loan.InterestCalculation),
  evidence: EvidenceReference,
  postingPlan: Schema.NullOr(Accounting.ChangeSet),
  ...metadata,
});

export const ApproveLoanReview = Schema.Struct({ digest: Accounting.Digest });

export const ExecuteLoanReview = Schema.Struct({
  ...ApproveLoanReview.fields,
  approvalId: Accounting.Identifier,
});

export const LoanApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  kernelApprovalId: Schema.NullOr(Accounting.Identifier),
  expiresAt: Schema.String,
  ...metadata,
});

export const LoanEvent = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  loanId: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  kind: Schema.Literals(["accrual", "repayment"]),
  postingDate: Accounting.AccountingDate,
  principalMinor: Accounting.MinorUnits,
  interestMinor: Accounting.MinorUnits,
  feeMinor: Accounting.MinorUnits,
  coverageEndExclusiveOn: Schema.NullOr(Accounting.AccountingDate),
  ownerEffectId: Schema.NullOr(Accounting.Identifier),
  postingReceipt: Schema.NullOr(Accounting.ExecutionReceipt),
  noJournal: Schema.Boolean,
  ...metadata,
});

export const LoanView = Schema.Struct({
  loan: RetainedLoan,
  rates: Schema.Array(LoanRate),
  events: Schema.Array(LoanEvent),
  balance: LoanBalance,
  principalAllocations: LoanBasis.fields.allocations,
  sourceCoverage: Schema.Literal("unknown"),
  lenderStatementDifferenceMinor: Schema.Null,
});

export const LoanReviewView = Schema.Struct({
  review: LoanReview,
  approvals: Schema.Array(LoanApproval),
  event: Schema.NullOr(LoanEvent),
});

const scoped = { scope: Accounting.Scope };

const command = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

const loanCommand = { ...command, id: Accounting.Identifier };

const capabilities = {
  treasury_adopt_loan: {
    input: Schema.Struct({ ...command, input: AdoptLoan }),
    output: RetainedLoan,
    description:
      "Adopt one posted synthetic shareholder principal with immutable agreement evidence and no new journal.",
    readOnly: false,
  },
  treasury_record_loan_rate: {
    input: Schema.Struct({ ...loanCommand, input: RecordLoanRate }),
    output: LoanRate,
    description:
      "Retain one evidenced simple-interest rate at a unique effective date beyond accrued coverage.",
    readOnly: false,
  },
  treasury_prepare_loan_review: {
    input: Schema.Struct({ ...loanCommand, input: PrepareLoanReview }),
    output: LoanReview,
    description:
      "Seal a cumulative interest calculation or source-backed explicit repayment split against current loan balances.",
    readOnly: false,
  },
  treasury_approve_loan_review: {
    input: Schema.Struct({ ...loanCommand, input: ApproveLoanReview }),
    output: LoanApproval,
    description: "Approve one exact current loan review for one hour.",
    readOnly: false,
    agentCallable: false,
  },
  treasury_execute_loan_review: {
    input: Schema.Struct({ ...loanCommand, input: ExecuteLoanReview }),
    output: LoanEvent,
    description:
      "Commit the approved loan journal, principal allocation, interest effect and bank match atomically.",
    readOnly: false,
  },
  treasury_get_loan: {
    input: Schema.Struct({ ...scoped, id: Accounting.Identifier }),
    output: LoanView,
    description:
      "Read retained agreement, rates, all loan events and principal allocations with honest unknown lender coverage.",
    readOnly: true,
  },
  treasury_get_loan_review: {
    input: Schema.Struct({ ...scoped, id: Accounting.Identifier }),
    output: LoanReviewView,
    description: "Read an exact retained loan review, its approvals and committed event.",
    readOnly: true,
  },
};

export const LoanCapabilities = capabilities;

const root = "/v1/entities/:entityId/books/:bookId/treasury/loans";

const params = Accounting.ChangePath;

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const LoanApi = HttpApiGroup.make("treasuryLoan").add(
  HttpApiEndpoint.post("adoptLoan", root, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: payload(AdoptLoan),
    success: RetainedLoan,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("recordLoanRate", `${root}/:id/rates`, {
    params,
    headers: Accounting.IdempotencyHeaders,
    payload: payload(RecordLoanRate),
    success: LoanRate,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("prepareLoanReview", `${root}/:id/reviews`, {
    params,
    headers: Accounting.IdempotencyHeaders,
    payload: payload(PrepareLoanReview),
    success: LoanReview,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("approveLoanReview", `${root}/reviews/:id/approvals`, {
    params,
    headers: Accounting.IdempotencyHeaders,
    payload: payload(ApproveLoanReview),
    success: LoanApproval,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("executeLoanReview", `${root}/reviews/:id/execute`, {
    params,
    headers: Accounting.IdempotencyHeaders,
    payload: payload(ExecuteLoanReview),
    success: LoanEvent,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getLoan", `${root}/:id`, {
    params,
    success: LoanView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getLoanReview", `${root}/reviews/:id`, {
    params,
    success: LoanReviewView,
    error: accountingErrors,
  }),
);
