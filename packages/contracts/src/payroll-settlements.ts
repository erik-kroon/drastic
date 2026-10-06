import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Calculations from "./payroll-calculations";
import * as Runs from "./payroll-runs";
import * as Domain from "@open-erp/domain/payroll-runs";
import { CommandReceipt, EvidenceReference } from "./commerce";
import { accountingErrors } from "./accounting-errors";
import { AdjustmentInstruction, AdjustmentSnapshot } from "./payroll-adjustments";
import { MileageSplit } from "@open-erp/domain/mileage-reimbursement";

export { AdjustmentInstruction, AdjustmentSnapshot } from "./payroll-adjustments";

const metadata = {
  scope: Accounting.Scope,
  digest: Accounting.Digest,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  receipt: CommandReceipt,
};

const journal = {
  evidenceId: Accounting.Identifier,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  reason: Accounting.Description,
};

const bank = {
  statementId: Accounting.Identifier,
  rowOrdinal: Schema.Int.check(Schema.isGreaterThan(0)),
  bankAccountId: Accounting.Identifier,
  ...journal,
};

export const AdjustmentKind = Schema.Literals([
  "gross_recovery",
  "future_pay",
  "additional_compensation",
  "reporting_only",
]);

export const PrepareSettlement = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("payment"),
    runId: Accounting.Identifier,
    employeeId: Accounting.Identifier,
    payeeEvidenceId: Accounting.Identifier,
    ...bank,
  }),
  Schema.Struct({ kind: Schema.Literal("cash_recovery"), claimId: Accounting.Identifier, ...bank }),
  Schema.Struct({
    kind: Schema.Literal("gross_recovery"),
    mileageSource: Schema.optional(
      Schema.Struct({ proposalId: Accounting.Identifier, proposalDigest: Accounting.Digest }),
    ),
    comparisonId: Accounting.Identifier,
    lawfulBasisId: Accounting.Identifier,
    recoveryReceivableAccountId: Accounting.Identifier,
    futureMonth: Schema.Null,
    ...journal,
  }),
  Schema.Struct({
    kind: Schema.Literal("future_pay"),
    recoveryClaimId: Schema.optional(Accounting.Identifier),
    comparisonId: Accounting.Identifier,
    lawfulBasisId: Accounting.Identifier,
    recoveryReceivableAccountId: Schema.Null,
    futureMonth: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/)),
    ...journal,
  }),
  Schema.Struct({
    kind: Schema.Literal("additional_compensation"),
    comparisonId: Accounting.Identifier,
    lawfulBasisId: Schema.Null,
    recoveryReceivableAccountId: Schema.Null,
    futureMonth: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/)),
    ...journal,
  }),
  Schema.Struct({
    kind: Schema.Literal("reporting_only"),
    comparisonId: Accounting.Identifier,
    lawfulBasisId: Schema.Null,
    recoveryReceivableAccountId: Schema.Null,
    futureMonth: Schema.Null,
    ...journal,
  }),
]);

export const PaidPayrollEvent = Schema.Struct({
  id: Accounting.Identifier,
  ...Domain.PaidCompensationEvent.fields,
  grossCashMinor: Accounting.MinorUnits,
  withholdingMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
  employerContributionMinor: Accounting.MinorUnits,
  specificationNumber: Domain.AgiItemInput.fields.specificationNumber,
  originalRun: Runs.PayrollRun,
  originalEmployee: Runs.PayrollRunEmployee,
  reportingReadiness: Schema.Literals(["ready", "adjustment_required"]),
  sourceDigest: Accounting.Digest,
  settlementExecutionId: Accounting.Identifier,
  ...metadata,
});

export const CorrectionComparison = Schema.Struct({
  id: Accounting.Identifier,
  kind: Schema.Literal("paid_correction_comparison"),
  paidEventId: Accounting.Identifier,
  input: Calculations.PreparePayRun,
  originalPaidDigest: Accounting.Digest,
  basis: Calculations.PayrollCalculationBasis,
  calculation: Calculations.PayrollFrozenCalculation,
  grossDeltaMinor: Accounting.SignedMinorUnits,
  contributionDeltaMinor: Accounting.SignedMinorUnits,
  correctionPopulationDigest: Schema.optional(Accounting.Digest),
  mileageCorrections: Schema.optional(
    Schema.Array(
      Schema.Struct({
        originalInputId: Accounting.Identifier,
        originalInputDigest: Accounting.Digest,
        split: MileageSplit,
      }),
    ).check(Schema.isMaxLength(100)),
  ),
  noFinancialEffect: Schema.Literal(true),
  ...metadata,
});

export const RecordAdjustmentBasis = Schema.Struct({
  recoveryClaimId: Schema.optional(Accounting.Identifier),
  comparisonId: Accounting.Identifier,
  kind: AdjustmentKind,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const AdjustmentBasis = Schema.Struct({
  id: Accounting.Identifier,
  input: RecordAdjustmentBasis,
  comparisonDigest: Accounting.Digest,
  evidence: EvidenceReference,
  qualification: Schema.Literal("synthetic_only"),
  ...metadata,
});

export const CashSnapshot = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: Schema.Int,
  accountId: Accounting.Identifier,
  observedOn: Accounting.AccountingDate,
  amountMinor: Accounting.SignedMinorUnits,
  evidence: EvidenceReference,
  accountVersion: Accounting.MinorUnits,
});

export const RecoveryClaim = Schema.Struct({
  id: Accounting.Identifier,
  paidEventId: Accounting.Identifier,
  comparisonId: Accounting.Identifier,
  claimedGrossMinor: Accounting.MinorUnits,
  receivableMinor: Schema.optional(Accounting.MinorUnits),
  mileageSource: Schema.optional(
    Schema.Struct({ proposalId: Accounting.Identifier, originalInputId: Accounting.Identifier }),
  ),
  recoveryReceivableAccountId: Accounting.Identifier,
  originalSpecificationNumber: Schema.String,
  reportingPeriod: Schema.String,
  executionId: Accounting.Identifier,
});

export const SettlementOutputs = Schema.Struct({
  reportingReadiness: Schema.Literals(["not_applicable", "ready", "adjustment_required"]),
  amountMinor: Accounting.MinorUnits,
  remainingReceivableMinor: Accounting.MinorUnits,
  signedGrossDeltaMinor: Accounting.SignedMinorUnits,
  contributionCorrectionMinor: Accounting.SignedMinorUnits,
});

export const SettlementReview = Schema.Struct({
  reportingReplacement: Schema.NullOr(Domain.AgiItemInput),
  id: Accounting.Identifier,
  input: PrepareSettlement,
  originalRun: Schema.NullOr(Runs.PayrollRun),
  paidEvent: Schema.NullOr(PaidPayrollEvent),
  comparison: Schema.NullOr(CorrectionComparison),
  lawfulBasis: Schema.NullOr(AdjustmentBasis),
  claim: Schema.NullOr(RecoveryClaim),
  cash: Schema.NullOr(CashSnapshot),
  capacityDigest: Accounting.Digest,
  economicKey: Schema.String,
  outputs: SettlementOutputs,
  postingPlan: Schema.NullOr(Accounting.ChangeSet),
  ...metadata,
});

export const ApproveSettlement = Schema.Struct({ reviewDigest: Accounting.Digest });

export const ExecuteSettlement = Schema.Struct({
  ...ApproveSettlement.fields,
  approvalId: Accounting.Identifier,
});

export const SettlementApproval = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  kernelApprovalId: Schema.NullOr(Accounting.Identifier),
  expiresAt: Schema.String,
  ...metadata,
});

export const SettlementExecution = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  kind: Schema.Union([
    PrepareSettlement.members[0].fields.kind,
    Schema.Literal("cash_recovery"),
    AdjustmentKind,
  ]),
  paidEvent: Schema.NullOr(PaidPayrollEvent),
  recoveryClaim: Schema.NullOr(RecoveryClaim),
  instruction: Schema.NullOr(AdjustmentInstruction),
  remainingReceivableMinor: Accounting.MinorUnits,
  postingReceipt: Schema.NullOr(Accounting.ExecutionReceipt),
  ...metadata,
});

export const CancelAdjustmentInstruction = Schema.Struct({
  instructionDigest: Accounting.Digest,
  claimBalanceDigest: Accounting.Digest,
  reason: Accounting.Description,
});

export const AdjustmentInstructionCancellation = Schema.Struct({
  id: Accounting.Identifier,
  instructionId: Accounting.Identifier,
  ...CancelAdjustmentInstruction.fields,
  ...metadata,
});

export const NetInstructionState = Schema.Struct({
  instruction: AdjustmentSnapshot,
  cancellation: Schema.NullOr(AdjustmentInstructionCancellation),
  claimBalanceDigest: Accounting.Digest,
  remainingReceivableMinor: Accounting.MinorUnits,
  reservedRunId: Schema.NullOr(Accounting.Identifier),
  consumedRunId: Schema.NullOr(Accounting.Identifier),
});

export const SettlementView = Schema.Struct({
  review: SettlementReview,
  netInstruction: Schema.NullOr(NetInstructionState),
  approvals: Schema.Array(SettlementApproval),
  execution: Schema.NullOr(SettlementExecution),
  remainingReceivableMinor: Accounting.MinorUnits,
});

export const PreparePayrollPeriod = Schema.Struct({
  reportingPeriod: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/)),
  evidenceId: Accounting.Identifier,
});

export const PayrollPeriod = Schema.Struct({
  id: Accounting.Identifier,
  reportingPeriod: PreparePayrollPeriod.fields.reportingPeriod,
  profile: Schema.Literal("synthetic_paid_semantics_v1"),
  sourceDigest: Accounting.Digest,
  items: Schema.Array(Domain.AgiItemInput),
  totals: Domain.AgiTotals,
  reconciliation: Schema.Struct({
    postedAccrualsMinor: Accounting.MinorUnits,
    unpaidMinor: Accounting.MinorUnits,
    otherPeriodMinor: Accounting.MinorUnits,
    adjustmentMinor: Accounting.SignedMinorUnits,
  }),
  contributionCorrectionMinor: Accounting.SignedMinorUnits,
  contributionOutcome: Schema.Literal("pending_qualification_or_reassessment"),
  externalState: Schema.Literal("not_submitted"),
  artifact: Schema.Struct({
    mediaType: Schema.Literal("application/json"),
    content: Schema.String,
    sha256: Accounting.Digest,
  }),
  ...metadata,
});

const scoped = { scope: Accounting.Scope };

const command = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const PayrollSettlementCapabilities = {
  payroll_cancel_adjustment_instruction: {
    description: "Independently cancel an exact unreserved, unconsumed net recovery instruction.",
    input: Schema.Struct({
      ...command,
      instructionId: Accounting.Identifier,
      input: CancelAdjustmentInstruction,
    }),
    output: AdjustmentInstructionCancellation,
    readOnly: false,
    agentCallable: false,
  },
  payroll_prepare_settlement: {
    description:
      "Prepare exact local payroll settlement or explicit paid adjustment from stored sources.",
    input: Schema.Struct({ ...command, input: PrepareSettlement }),
    output: SettlementReview,
    readOnly: false,
  },
  payroll_approve_settlement: {
    description: "Approve an exact private payroll settlement or adjustment.",
    input: Schema.Struct({ ...command, reviewId: Accounting.Identifier, input: ApproveSettlement }),
    output: SettlementApproval,
    readOnly: false,
    agentCallable: false,
  },
  payroll_execute_settlement: {
    description: "Commit exact payroll settlement and owned consequences atomically.",
    input: Schema.Struct({ ...command, reviewId: Accounting.Identifier, input: ExecuteSettlement }),
    output: SettlementExecution,
    readOnly: false,
  },
  payroll_get_settlement: {
    description: "Read private payroll settlement history and recovery residual.",
    input: Schema.Struct({ ...scoped, reviewId: Accounting.Identifier }),
    output: SettlementView,
    readOnly: true,
  },
  payroll_prepare_comparison: {
    description: "Compute a paid correction comparison without an earning or financial effect.",
    input: Schema.Struct({
      ...command,
      paidEventId: Accounting.Identifier,
      input: Calculations.PreparePayRun,
    }),
    output: CorrectionComparison,
    readOnly: false,
  },
  payroll_record_adjustment_basis: {
    description:
      "Independently review a synthetic lawful adjustment basis, without a financial effect.",
    input: Schema.Struct({ ...command, input: RecordAdjustmentBasis }),
    output: AdjustmentBasis,
    readOnly: false,
    agentCallable: false,
  },
  payroll_prepare_period: {
    description:
      "Retain actual paid-period semantics and synthetic JSON artifact, without statutory submission.",
    input: Schema.Struct({ ...command, input: PreparePayrollPeriod }),
    output: PayrollPeriod,
    readOnly: false,
  },
  payroll_get_period: {
    description: "Read retained private paid-period semantics and synthetic artifact.",
    input: Schema.Struct({ ...scoped, periodId: Accounting.Identifier }),
    output: PayrollPeriod,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll";

const reviewParams = Schema.Struct({ ...Accounting.Scope.fields, reviewId: Accounting.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const PayrollSettlementApi = HttpApiGroup.make("payrollSettlement")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post(
      "cancelPayrollAdjustmentInstruction",
      `${root}/adjustment-instructions/:instructionId/cancellations`,
      {
        params: Schema.Struct({ ...Accounting.Scope.fields, instructionId: Accounting.Identifier }),
        headers: Accounting.IdempotencyHeaders,
        payload: payload(CancelAdjustmentInstruction),
        success: AdjustmentInstructionCancellation,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("preparePayrollSettlement", `${root}/settlement-reviews`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(PrepareSettlement),
      success: SettlementReview,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "approvePayrollSettlement",
      `${root}/settlement-reviews/:reviewId/approvals`,
      {
        params: reviewParams,
        headers: Accounting.IdempotencyHeaders,
        payload: payload(ApproveSettlement),
        success: SettlementApproval,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "executePayrollSettlement",
      `${root}/settlement-reviews/:reviewId/executions`,
      {
        params: reviewParams,
        headers: Accounting.IdempotencyHeaders,
        payload: payload(ExecuteSettlement),
        success: SettlementExecution,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("getPayrollSettlement", `${root}/settlement-reviews/:reviewId`, {
      params: reviewParams,
      success: SettlementView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "preparePayrollComparison",
      `${root}/paid-events/:paidEventId/comparisons`,
      {
        params: Schema.Struct({ ...Accounting.Scope.fields, paidEventId: Accounting.Identifier }),
        headers: Accounting.IdempotencyHeaders,
        payload: payload(Calculations.PreparePayRun),
        success: CorrectionComparison,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("recordPayrollAdjustmentBasis", `${root}/adjustment-bases`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(RecordAdjustmentBasis),
      success: AdjustmentBasis,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("preparePayrollPeriod", `${root}/periods`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(PreparePayrollPeriod),
      success: PayrollPeriod,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPayrollPeriod", `${root}/periods/:periodId`, {
      params: Schema.Struct({ ...Accounting.Scope.fields, periodId: Accounting.Identifier }),
      success: PayrollPeriod,
      error: accountingErrors,
    }),
  );
