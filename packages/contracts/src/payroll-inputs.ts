import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { PurchaseSourceLine, PurchaseTaxFact } from "@open-erp/domain/purchasing";
import {
  TripRevision,
  MileageRuleRelease,
  MileageSplit,
} from "@open-erp/domain/mileage-reimbursement";
import {
  WorkSegment,
  VariableEarning,
  PayComponent,
  NormalizedWork,
  HolidayTargetInput,
  HolidayTarget,
} from "@open-erp/domain/variable-pay";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./commerce";

export const InputEvidence = Schema.Struct({
  evidenceId: Accounting.Identifier,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

export const PayrollInputBasis = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("claim"),
    paidBy: Schema.Literals(["employee", "company"]),
    counterpartyId: Accounting.Identifier,
    supplierDocumentNumber: Accounting.Description,
    line: PurchaseSourceLine,
    inputVatAccountId: Schema.NullOr(Accounting.Identifier),
  }),
  Schema.Struct({
    kind: Schema.Literal("mileage"),
    trip: TripRevision,
    release: MileageRuleRelease,
    expenseAccountId: Accounting.Identifier,
    taxableExpenseAccountId: Accounting.Identifier,
    taxableLiabilityAccountId: Accounting.Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("variable"),
    profile: Schema.Literal("synthetic-exact-hourly-v1"),
    expenseAccountId: Accounting.Identifier,
    work: Schema.Array(WorkSegment).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    earnings: Schema.Array(VariableEarning).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    holiday: HolidayTargetInput,
    holidayExpenseAccountId: Accounting.Identifier,
    holidayLiabilityAccountId: Accounting.Identifier,
    socialExpenseAccountId: Accounting.Identifier,
    socialProvisionAccountId: Accounting.Identifier,
  }),
]);

export const SubmitPayrollInput = Schema.Struct({
  employeeId: Accounting.Identifier,
  month: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/)),
  recordClass: Schema.Literal("synthetic"),
  economicKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  evidence: InputEvidence,
  purpose: Accounting.Description,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  liabilityAccountId: Accounting.Identifier,
  basis: PayrollInputBasis,
});

export const PayrollInput = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  digest: Accounting.Digest,
  input: SubmitPayrollInput,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  receipt: CommandReceipt,
});

export const PayrollInputOutputs = Schema.Struct({
  reimbursementMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  grossRecognizedMinor: Accounting.MinorUnits,
  taxFacts: Schema.Array(PurchaseTaxFact),
  mileage: Schema.NullOr(MileageSplit),
  work: Schema.NullOr(NormalizedWork),
  components: Schema.Array(PayComponent),
  holiday: Schema.NullOr(HolidayTarget),
  holidayMoneyDeltaMinor: Accounting.SignedMinorUnits,
  holidaySocialDeltaMinor: Accounting.SignedMinorUnits,
});

export const DirectPayrollInputPayment = Schema.Struct({
  inputDigest: Accounting.Digest,
  amountMinor: Accounting.MinorUnits,
  bankAccountId: Accounting.Identifier,
  evidence: InputEvidence,
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  series: SubmitPayrollInput.fields.series,
});

export const PayrollInputReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  inputId: Accounting.Identifier,
  inputDigest: Accounting.Digest,
  digest: Accounting.Digest,
  kind: Schema.Literals(["recognition", "direct_payment"]),
  outputs: PayrollInputOutputs,
  componentKeys: Schema.Array(Schema.String),
  capacityDigest: Accounting.Digest,
  payment: Schema.NullOr(DirectPayrollInputPayment),
  currentHolidayMoneyMinor: Accounting.SignedMinorUnits,
  currentHolidaySocialMinor: Accounting.SignedMinorUnits,
  postingPlan: Accounting.ChangeSet,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollInputApproval = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollInputExecution = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  inputId: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  kind: Schema.Literals(["recognition", "direct_payment"]),
  postingReceipt: Accounting.ExecutionReceipt,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollInputSnapshot = Schema.Struct({
  inputId: Accounting.Identifier,
  inputDigest: Accounting.Digest,
  reviewId: Accounting.Identifier,
  executionId: Accounting.Identifier,
  employeeId: Accounting.Identifier,
  month: SubmitPayrollInput.fields.month,
  evidence: InputEvidence,
  reimbursementMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  grossRecognizedMinor: Accounting.MinorUnits,
  liabilityAccountId: Accounting.Identifier,
  taxableLiabilityAccountId: Schema.NullOr(Accounting.Identifier),
  capacityDigest: Accounting.Digest,
});

export const PayrollInputView = Schema.Struct({
  submitted: PayrollInput,
  reviews: Schema.Array(PayrollInputReview),
  executions: Schema.Array(PayrollInputExecution),
  snapshot: Schema.NullOr(PayrollInputSnapshot),
  reservedRunId: Schema.NullOr(Accounting.Identifier),
  consumedRunId: Schema.NullOr(Accounting.Identifier),
});

export const ApprovePayrollInput = Schema.Struct({ reviewDigest: Accounting.Digest });

export const ExecutePayrollInput = Schema.Struct({
  ...ApprovePayrollInput.fields,
  approvalId: Accounting.Identifier,
});

export const ReviewPayrollInput = Schema.Struct({ inputDigest: Accounting.Digest });

const scoped = { scope: Accounting.Scope };

const command = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const PayrollInputCapabilities = {
  payroll_submit_input: {
    description:
      "Retain synthetic claim, mileage or exact hourly source facts for private review. No financial effect.",
    input: Schema.Struct({ ...command, input: SubmitPayrollInput }),
    output: PayrollInput,
    readOnly: false,
  },
  payroll_review_input: {
    description:
      "Prepare the exact synthetic input recognition journal and retained component basis.",
    input: Schema.Struct({ ...command, inputId: Accounting.Identifier, input: ReviewPayrollInput }),
    output: PayrollInputReview,
    readOnly: false,
  },
  payroll_prepare_input_payment: {
    description:
      "Prepare a synthetic direct cash allocation from unreserved claim capacity. Taxable awards cannot use this route.",
    input: Schema.Struct({
      ...command,
      inputId: Accounting.Identifier,
      input: DirectPayrollInputPayment,
    }),
    output: PayrollInputReview,
    readOnly: false,
  },
  payroll_approve_input: {
    description:
      "Human approval of one exact current payroll input recognition or cash allocation.",
    input: Schema.Struct({
      ...command,
      reviewId: Accounting.Identifier,
      input: ApprovePayrollInput,
    }),
    output: PayrollInputApproval,
    readOnly: false,
    agentCallable: false,
  },
  payroll_execute_input: {
    description:
      "Commit approved synthetic recognition or cash allocation atomically. Payroll consumes retained liabilities through a regular run.",
    input: Schema.Struct({
      ...command,
      reviewId: Accounting.Identifier,
      input: ExecutePayrollInput,
    }),
    output: PayrollInputExecution,
    readOnly: false,
  },
  payroll_get_input: {
    description:
      "Privately read retained source, reviews, financial receipts and exclusive payroll reservation or consumption.",
    input: Schema.Struct({ ...scoped, inputId: Accounting.Identifier }),
    output: PayrollInputView,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll";

const params = Schema.Struct({ ...Accounting.Scope.fields, inputId: Accounting.Identifier });

const reviewParams = Schema.Struct({ ...Accounting.Scope.fields, reviewId: Accounting.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const PayrollInputApi = HttpApiGroup.make("payrollInput")
  .add(
    HttpApiEndpoint.post("submitPayrollInput", `${root}/inputs`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(SubmitPayrollInput),
      success: PayrollInput,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reviewPayrollInput", `${root}/inputs/:inputId/reviews`, {
      params,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(ReviewPayrollInput),
      success: PayrollInputReview,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("preparePayrollInputPayment", `${root}/inputs/:inputId/direct-payments`, {
      params,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(DirectPayrollInputPayment),
      success: PayrollInputReview,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approvePayrollInput", `${root}/input-reviews/:reviewId/approvals`, {
      params: reviewParams,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(ApprovePayrollInput),
      success: PayrollInputApproval,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("executePayrollInput", `${root}/input-reviews/:reviewId/executions`, {
      params: reviewParams,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(ExecutePayrollInput),
      success: PayrollInputExecution,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPayrollInput", `${root}/inputs/:inputId`, {
      params,
      success: PayrollInputView,
      error: accountingErrors,
    }),
  );
