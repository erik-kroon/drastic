import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Inputs from "./payroll-inputs";
import * as Commerce from "./commerce";
import { SourceOccurrence } from "./source-intake";
import { TaxAssessment } from "./expense-tax";
import { accountingErrors } from "./accounting-errors";

export const SyntheticEmployeeReceipt = Schema.Struct({
  profile: Schema.Literal("synthetic-employee-receipt-v1"),
  recordClass: Schema.Literal("synthetic"),
  employeeId: A.Identifier,
  paidBy: Schema.Literals(["employee", "company"]),
  counterpartyId: A.Identifier,
  supplierDocumentNumber: A.Description,
  sourceLineId: A.Identifier,
  currency: Schema.Literal("SEK"),
  issuedOn: A.AccountingDate,
  grossMinor: A.MinorUnits,
  netMinor: A.MinorUnits,
  vatMinor: A.MinorUnits,
  purpose: A.Description,
});

export const ClaimSourceSelection = Schema.Struct({
  occurrenceId: A.Identifier,
  sha256: A.Digest,
  taxSourceId: Schema.NullOr(A.Identifier),
  taxSourceDigest: Schema.NullOr(A.Digest),
  taxReviewDigest: Schema.NullOr(A.Digest),
});

export const SubmitEmployeeClaim = Schema.Struct({
  claimKey: A.Identifier,
  employeeId: A.Identifier,
  month: Inputs.SubmitPayrollInput.fields.month,
  purpose: A.Description,
  items: Schema.Array(ClaimSourceSelection).check(Schema.isMinLength(3), Schema.isMaxLength(3)),
});

export const ReviseEmployeeClaim = Schema.Struct({
  expectedRevisionDigest: A.Digest,
  ...SubmitEmployeeClaim.fields,
});

export const ClaimSourceItem = Schema.Struct({
  selection: ClaimSourceSelection,
  occurrence: SourceOccurrence,
  receipt: SyntheticEmployeeReceipt,
  supplierName: A.Description,
  counterpartyRevision: Commerce.Version,
  outcome: Schema.Literals(["qualified", "company_paid", "duplicate"]),
  originalOccurrenceId: Schema.NullOr(A.Identifier),
  assessment: Schema.NullOr(TaxAssessment),
  reimbursementMinor: A.MinorUnits,
});

const retained = {
  id: A.Identifier,
  scope: A.Scope,
  digest: A.Digest,
  createdAt: Schema.String,
  createdBy: A.Identifier,
  receipt: Commerce.CommandReceipt,
};

export const EmployeeClaimRevision = Schema.Struct({
  ...retained,
  claimId: A.Identifier,
  revision: Schema.Int,
  previousRevisionId: Schema.NullOr(A.Identifier),
  employeeRevisionId: A.Identifier,
  input: SubmitEmployeeClaim,
  items: Schema.Array(ClaimSourceItem),
});

export const ReviewEmployeeClaim = Schema.Struct({
  revisionDigest: A.Digest,
  directMinor: A.MinorUnits,
  expenseAccountId: A.Identifier,
  inputVatAccountId: A.Identifier,
  liabilityAccountId: A.Identifier,
  accountingPeriodId: A.Identifier,
  postingDate: A.AccountingDate,
  series: Inputs.SubmitPayrollInput.fields.series,
});

export const EmployeeClaimReview = Schema.Struct({
  ...retained,
  claimId: A.Identifier,
  revisionId: A.Identifier,
  revisionDigest: A.Digest,
  input: ReviewEmployeeClaim,
  items: Schema.Array(ClaimSourceItem),
  expenseMinor: A.MinorUnits,
  deductibleVatMinor: A.MinorUnits,
  liabilityMinor: A.MinorUnits,
  directMinor: A.MinorUnits,
  payrollMinor: A.MinorUnits,
  preparedInput: Inputs.PayrollInput,
  preparedRecognition: Inputs.PayrollInputReview,
});

export const ClaimInstruction = Schema.Struct({
  ...retained,
  claimId: A.Identifier,
  recognitionId: A.Identifier,
  kind: Schema.Literals(["direct", "payroll"]),
  parentInputId: A.Identifier,
  parentExecutionId: A.Identifier,
  employeeId: A.Identifier,
  employeeRevisionId: A.Identifier,
  month: Inputs.SubmitPayrollInput.fields.month,
  amountMinor: A.MinorUnits,
  liabilityAccountId: A.Identifier,
  evidence: Inputs.InputEvidence,
});

export const ClaimPayrollSnapshot = Schema.Struct({
  instructionId: A.Identifier,
  instructionDigest: A.Digest,
  claimId: A.Identifier,
  recognitionId: A.Identifier,
  parentInputId: A.Identifier,
  parentExecutionId: A.Identifier,
  employeeId: A.Identifier,
  month: Inputs.SubmitPayrollInput.fields.month,
  amountMinor: A.MinorUnits,
  liabilityAccountId: A.Identifier,
  evidence: Inputs.InputEvidence,
});

export const EmployeeClaimRecognition = Schema.Struct({
  ...retained,
  claimId: A.Identifier,
  reviewId: A.Identifier,
  reviewDigest: A.Digest,
  approvalId: A.Identifier,
  inputExecution: Inputs.PayrollInputExecution,
  postingReceipt: A.ExecutionReceipt,
  directInstruction: Schema.NullOr(ClaimInstruction),
  payrollInstruction: Schema.NullOr(ClaimInstruction),
});

export const ApproveEmployeeClaim = Schema.Struct({ reviewDigest: A.Digest });

export const RequestClaimCompletion = Schema.Struct({
  revisionDigest: A.Digest,
  reason: A.Description,
});

export const ClaimCompletionRequest = Schema.Struct({
  ...retained,
  claimId: A.Identifier,
  revisionId: A.Identifier,
  input: RequestClaimCompletion,
});

const iban = Schema.String.check(Schema.isPattern(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/));

const bic = Schema.String.check(Schema.isPattern(/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/));

const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(70));

export const ProposeEmployeePayee = Schema.Struct({
  employeeId: A.Identifier,
  employeeRevisionId: A.Identifier,
  creditorName: name,
  creditorIban: iban,
  creditorBic: bic,
  evidence: Inputs.InputEvidence,
  reason: A.Description,
});

export const EmployeePayeeProposal = Schema.Struct({ ...retained, input: ProposeEmployeePayee });

export const VerifyEmployeePayee = Schema.Struct({
  proposalDigest: A.Digest,
  evidence: Inputs.InputEvidence,
  reason: A.Description,
  confirmIndependentCheck: Schema.Literal(true),
});

export const EmployeePayeeVerification = Schema.Struct({
  ...retained,
  proposal: EmployeePayeeProposal,
  input: VerifyEmployeePayee,
  bankVerified: Schema.Literal(false),
});

export const PrepareClaimPaymentFile = Schema.Struct({
  instructionDigest: A.Digest,
  payeeVerificationId: A.Identifier,
  executionDate: A.AccountingDate,
  debtorName: name,
  debtorIban: iban,
  debtorBic: bic,
  reason: A.Description,
  acknowledgeOfflineOnly: Schema.Literal(true),
});

export const ClaimPaymentPreview = Schema.Struct({
  ...retained,
  instruction: ClaimInstruction,
  payee: EmployeePayeeVerification,
  input: PrepareClaimPaymentFile,
  amountMinor: A.MinorUnits,
  status: Schema.Literal("preview"),
  paid: Schema.Literal(false),
});

export const ApproveClaimPaymentFile = Schema.Struct({
  previewDigest: A.Digest,
  acknowledgeOfflineOnly: Schema.Literal(true),
});

export const ClaimPaymentExport = Schema.Struct({
  ...retained,
  previewId: A.Identifier,
  instructionId: A.Identifier,
  previewDigest: A.Digest,
  amountMinor: A.MinorUnits,
  format: Schema.Literal("pain.001.001.03"),
  mediaType: Schema.Literal("application/xml"),
  sha256: Schema.String,
  base64: Schema.String,
  exposure: Schema.Literal("unknown"),
  paid: Schema.Literal(false),
  bankCompatible: Schema.Literal(false),
  bankAccepted: Schema.Literal(false),
});

export const SyntheticClaimBankConfirmation = Schema.Struct({
  profile: Schema.Literal("synthetic_employee_claim_bank_confirmation_v1"),
  recordClass: Schema.Literal("synthetic"),
  scope: A.Scope,
  statementId: A.Identifier,
  rowOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  bankAccountId: A.Identifier,
  bankEvidence: Inputs.InputEvidence,
  observedOn: A.AccountingDate,
  amountMinor: A.MinorUnits,
  instructionId: A.Identifier,
  instructionDigest: A.Digest,
  exportId: A.Identifier,
  exportDigest: A.Digest,
  exportSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  previewId: A.Identifier,
  previewDigest: A.Digest,
  payeeVerificationId: A.Identifier,
  payeeVerificationDigest: A.Digest,
  creditorIban: iban,
});

export const SettleClaimInstruction = Schema.Struct({
  instructionDigest: A.Digest,
  exportId: A.Identifier,
  statementId: A.Identifier,
  rowOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  bankAccountId: A.Identifier,
  evidenceId: A.Identifier,
  postingDate: A.AccountingDate,
  accountingPeriodId: A.Identifier,
  series: Inputs.SubmitPayrollInput.fields.series,
  payeeEvidence: Inputs.InputEvidence,
});

export const ClaimSettlementReview = Schema.Struct({
  ...retained,
  instructionId: A.Identifier,
  input: SettleClaimInstruction,
  capacityDigest: A.Digest,
  amountMinor: A.MinorUnits,
  confirmation: Schema.optional(SyntheticClaimBankConfirmation),
  postingPlan: A.ChangeSet,
});

export const ClaimSettlement = Schema.Struct({
  ...retained,
  instructionId: A.Identifier,
  reviewId: A.Identifier,
  approvalId: A.Identifier,
  postingReceipt: A.ExecutionReceipt,
});

export const ClaimInstructionState = Schema.Struct({
  instruction: ClaimInstruction,
  paymentPreviews: Schema.Array(ClaimPaymentPreview),
  paymentExports: Schema.Array(ClaimPaymentExport),
  settlementReviews: Schema.Array(ClaimSettlementReview),
  settlements: Schema.Array(ClaimSettlement),
  reservedRunId: Schema.NullOr(A.Identifier),
  consumedRunId: Schema.NullOr(A.Identifier),
  routeChangeAllowed: Schema.Literal(false),
  status: Schema.Literals(["ready", "reserved", "exported_unknown", "consumed", "settled"]),
});

export const EmployeeClaimView = Schema.Struct({
  claimId: A.Identifier,
  employeeName: A.Description,
  currentRevision: Schema.Int,
  current: EmployeeClaimRevision,
  currentReview: Schema.NullOr(EmployeeClaimReview),
  approvalAllowed: Schema.Boolean,
  completionAllowed: Schema.Boolean,
  reviewBlockers: Schema.Array(Schema.String),
  revisions: Schema.Array(EmployeeClaimRevision),
  reviews: Schema.Array(EmployeeClaimReview),
  completionRequests: Schema.Array(ClaimCompletionRequest),
  recognition: Schema.NullOr(EmployeeClaimRecognition),
  instructions: Schema.Array(ClaimInstructionState),
  pendingReviewCurrent: Schema.Boolean,
});

export const EmployeeClaimDirectory = Schema.Struct({
  scope: A.Scope,
  claims: Schema.Array(EmployeeClaimView),
  next: Schema.NullOr(A.Identifier),
  pageSize: Schema.Literal(25),
});

const root = "/v1/entities/:entityId/books/:bookId/payroll/claims";

const scoped = A.Scope.fields;

const claimParams = Schema.Struct({ ...scoped, claimId: A.Identifier });

const reviewParams = Schema.Struct({ ...scoped, reviewId: A.Identifier });

const instructionParams = Schema.Struct({ ...scoped, instructionId: A.Identifier });

const idParams = Schema.Struct({ ...scoped, id: A.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const EmployeeClaimsApi = HttpApiGroup.make("employeeClaims")
  .add(
    HttpApiEndpoint.post("submitEmployeeClaim", root, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: payload(SubmitEmployeeClaim),
      success: EmployeeClaimRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listEmployeeClaims", root, {
      params: A.Scope,
      query: Schema.Struct({ after: Schema.optional(A.Identifier) }),
      success: EmployeeClaimDirectory,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getEmployeeClaim", `${root}/:claimId`, {
      params: claimParams,
      success: EmployeeClaimView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reviseEmployeeClaim", `${root}/:claimId/revisions`, {
      params: claimParams,
      headers: A.IdempotencyHeaders,
      payload: payload(ReviseEmployeeClaim),
      success: EmployeeClaimRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reviewEmployeeClaim", `${root}/:claimId/reviews`, {
      params: claimParams,
      headers: A.IdempotencyHeaders,
      payload: payload(ReviewEmployeeClaim),
      success: EmployeeClaimReview,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approveEmployeeClaim", `${root}/reviews/:reviewId/approvals`, {
      params: reviewParams,
      headers: A.IdempotencyHeaders,
      payload: payload(ApproveEmployeeClaim),
      success: EmployeeClaimRecognition,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("requestClaimCompletion", `${root}/:claimId/completion-requests`, {
      params: claimParams,
      headers: A.IdempotencyHeaders,
      payload: payload(RequestClaimCompletion),
      success: ClaimCompletionRequest,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("proposeEmployeePayee", `${root}/payees`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: payload(ProposeEmployeePayee),
      success: EmployeePayeeProposal,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("verifyEmployeePayee", `${root}/payees/:id/verifications`, {
      params: idParams,
      headers: A.IdempotencyHeaders,
      payload: payload(VerifyEmployeePayee),
      success: EmployeePayeeVerification,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "prepareClaimPaymentFile",
      `${root}/instructions/:instructionId/payment-previews`,
      {
        params: instructionParams,
        headers: A.IdempotencyHeaders,
        payload: payload(PrepareClaimPaymentFile),
        success: ClaimPaymentPreview,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("approveClaimPaymentFile", `${root}/payment-previews/:id/approvals`, {
      params: idParams,
      headers: A.IdempotencyHeaders,
      payload: payload(ApproveClaimPaymentFile),
      success: ClaimPaymentExport,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "prepareClaimSettlement",
      `${root}/instructions/:instructionId/settlement-reviews`,
      {
        params: instructionParams,
        headers: A.IdempotencyHeaders,
        payload: payload(SettleClaimInstruction),
        success: ClaimSettlementReview,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("approveClaimSettlement", `${root}/settlement-reviews/:id/approvals`, {
      params: idParams,
      headers: A.IdempotencyHeaders,
      payload: payload(Schema.Struct({ reviewDigest: A.Digest })),
      success: ClaimSettlement,
      error: accountingErrors,
    }),
  );

export const EmployeeClaimCapabilities = {
  payroll_submit_employee_claim: {
    description: "submitEmployeeClaim: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: SubmitEmployeeClaim,
    }),
    output: EmployeeClaimRevision,
    readOnly: false,
  },
  payroll_list_employee_claims: {
    description: "listEmployeeClaims: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({ scope: A.Scope, after: Schema.optional(A.Identifier) }),
    output: EmployeeClaimDirectory,
    readOnly: true,
  },
  payroll_get_employee_claim: {
    description: "getEmployeeClaim: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({ scope: A.Scope, claimId: A.Identifier }),
    output: EmployeeClaimView,
    readOnly: true,
  },
  payroll_revise_employee_claim: {
    description: "reviseEmployeeClaim: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      claimId: A.Identifier,
      input: ReviseEmployeeClaim,
    }),
    output: EmployeeClaimRevision,
    readOnly: false,
  },
  payroll_review_employee_claim: {
    description: "reviewEmployeeClaim: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      claimId: A.Identifier,
      input: ReviewEmployeeClaim,
    }),
    output: EmployeeClaimReview,
    readOnly: false,
  },
  payroll_approve_employee_claim: {
    description: "approveEmployeeClaim: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      reviewId: A.Identifier,
      input: ApproveEmployeeClaim,
    }),
    output: EmployeeClaimRecognition,
    readOnly: false,
    agentCallable: false,
  },
  payroll_request_claim_completion: {
    description: "requestClaimCompletion: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      claimId: A.Identifier,
      input: RequestClaimCompletion,
    }),
    output: ClaimCompletionRequest,
    readOnly: false,
  },
  payroll_propose_employee_payee: {
    description: "proposeEmployeePayee: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: ProposeEmployeePayee,
    }),
    output: EmployeePayeeProposal,
    readOnly: false,
  },
  payroll_verify_employee_payee: {
    description: "verifyEmployeePayee: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      id: A.Identifier,
      input: VerifyEmployeePayee,
    }),
    output: EmployeePayeeVerification,
    readOnly: false,
    agentCallable: false,
  },
  payroll_prepare_claim_payment_file: {
    description: "prepareClaimPaymentFile: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      instructionId: A.Identifier,
      input: PrepareClaimPaymentFile,
    }),
    output: ClaimPaymentPreview,
    readOnly: false,
  },
  payroll_approve_claim_payment_file: {
    description: "approveClaimPaymentFile: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      id: A.Identifier,
      input: ApproveClaimPaymentFile,
    }),
    output: ClaimPaymentExport,
    readOnly: false,
    agentCallable: false,
  },
  payroll_prepare_claim_settlement: {
    description: "prepareClaimSettlement: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      instructionId: A.Identifier,
      input: SettleClaimInstruction,
    }),
    output: ClaimSettlementReview,
    readOnly: false,
  },
  payroll_approve_claim_settlement: {
    description: "approveClaimSettlement: scoped retained synthetic employee claim workflow.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      id: A.Identifier,
      input: Schema.Struct({ reviewDigest: A.Digest }),
    }),
    output: ClaimSettlement,
    readOnly: false,
    agentCallable: false,
  },
};
