import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./commerce";
import { PayrollCalculation } from "./payroll-calculations";
import { RoleKind } from "./roles";

export const payslipRendererVersion = "payroll-payslip-v1";

export const payslipRenderEvent = "payroll.payslip.render_requested";

export const PayrollRunRoles = Schema.Struct({
  salaryExpenseAccountId: Accounting.Identifier,
  reimbursementExpenseAccountId: Accounting.Identifier,
  netPayLiabilityAccountId: Accounting.Identifier,
  withholdingLiabilityAccountId: Accounting.Identifier,
  employerContributionExpenseAccountId: Accounting.Identifier,
  employerContributionLiabilityAccountId: Accounting.Identifier,
  deductions: Schema.Array(
    Schema.Struct({ roleKind: RoleKind, accountId: Accounting.Identifier }),
  ).check(Schema.isMaxLength(20)),
  accruals: Schema.Array(
    Schema.Struct({
      componentId: Accounting.Identifier,
      expenseAccountId: Accounting.Identifier,
      liabilityAccountId: Accounting.Identifier,
    }),
  ).check(Schema.isMaxLength(64)),
});

export const PreparePayrollRun = Schema.Struct({
  calculationIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  evidenceId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  roles: PayrollRunRoles,
  reason: Accounting.Description,
});

export const PayrollEmployeeObligation = Schema.Struct({
  employeeId: Accounting.Identifier,
  calculationId: Accounting.Identifier,
  payableMinor: Accounting.MinorUnits,
  grossMinor: Accounting.MinorUnits,
  withholdingMinor: Accounting.MinorUnits,
  netDeductionMinor: Accounting.MinorUnits,
  employerContributionMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
});

export const PayrollRunEmployee = Schema.Struct({
  calculation: PayrollCalculation,
  personRef: Accounting.Description,
});

export const PayrollRun = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  digest: Accounting.Digest,
  input: PreparePayrollRun,
  employees: Schema.Array(PayrollRunEmployee).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  employeeObligations: Schema.Array(PayrollEmployeeObligation),
  postingPlan: Accounting.ChangeSet,
  state: Schema.Literal("prepared"),
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollRunApproval = Schema.Struct({
  runId: Accounting.Identifier,
  runDigest: Accounting.Digest,
  id: Accounting.Identifier,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollPayslipDocument = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  runId: Accounting.Identifier,
  runDigest: Accounting.Digest,
  calculationId: Accounting.Identifier,
  employeeId: Accounting.Identifier,
  personRef: Accounting.Description,
  earningsPeriod: PayrollCalculation.fields.calculation.fields.earningsPeriod,
  expectedPaymentOn: Accounting.AccountingDate,
  currency: Schema.String,
  currencyScale: Schema.Int,
  grossMinor: Accounting.MinorUnits,
  cashReimbursementMinor: Accounting.MinorUnits,
  withholdingMinor: Accounting.MinorUnits,
  netDeductionMinor: Accounting.MinorUnits,
  payableMinor: Accounting.MinorUnits,
  employerContributionMinor: Accounting.MinorUnits,
  withholdingBaseMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
  benefitBases: PayrollCalculation.fields.calculation.fields.benefitBases,
  extraAccruals: PayrollCalculation.fields.calculation.fields.extraAccruals,
  deductions:
    PayrollCalculation.fields.basis.fields.reviewedInput.fields.employment.fields
      .deductionComponents,
  status: Schema.Literal("posted_unpaid"),
  digest: Accounting.Digest,
});

export const PayrollRunExecution = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  runId: Accounting.Identifier,
  runDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  postingReceipt: Accounting.ExecutionReceipt,
  employeeObligations: Schema.Array(PayrollEmployeeObligation),
  payslips: Schema.Array(PayrollPayslipDocument),
  status: Schema.Literal("posted_unpaid"),
  createdAt: Schema.String,
  receipt: CommandReceipt,
});

export const PayrollRunView = Schema.Struct({
  run: PayrollRun,
  execution: Schema.NullOr(PayrollRunExecution),
});

export const PayrollRunPage = Schema.Struct({
  items: Schema.Array(PayrollRunView),
  next: Schema.NullOr(Accounting.Identifier),
});

export const PayrollPayslipArtifact = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  documentId: Accounting.Identifier,
  documentDigest: Accounting.Digest,
  rendererVersion: Schema.Literal(payslipRendererVersion),
  mediaType: Schema.Literal("application/pdf"),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  byteLength: Schema.Int,
  createdAt: Schema.String,
});

export const PayrollPayslipArtifactBytes = Schema.Struct({
  artifact: PayrollPayslipArtifact,
  contentBase64: Schema.String,
});

export const PayrollPayslipView = Schema.Struct({
  document: PayrollPayslipDocument,
  artifact: Schema.NullOr(PayrollPayslipArtifact),
  attempts: Schema.Int,
});

export const ApprovePayrollRun = Schema.Struct({ runDigest: Accounting.Digest });

export const ExecutePayrollRun = Schema.Struct({
  ...ApprovePayrollRun.fields,
  approvalId: Accounting.Identifier,
});

export const RenderPayrollPayslip = Schema.Struct({ documentDigest: Accounting.Digest });

const scoped = { scope: Accounting.Scope };

const command = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

const run = { ...scoped, runId: Accounting.Identifier };

const document = { ...scoped, documentId: Accounting.Identifier };

export const PayrollRunCapabilities = {
  payroll_prepare_run: {
    description:
      "Prepare one frozen regular payroll journal from selected stored calculations. No posting, payment or monthly capacity is created.",
    input: Schema.Struct({ ...command, input: PreparePayrollRun }),
    output: PayrollRun,
    readOnly: false,
  },
  payroll_approve_run: {
    description:
      "Approve the exact current frozen regular payroll run. Posting is a separate operation.",
    input: Schema.Struct({ ...command, runId: Accounting.Identifier, input: ApprovePayrollRun }),
    output: PayrollRunApproval,
    readOnly: false,
    agentCallable: false,
  },
  payroll_execute_run: {
    description:
      "Atomically post an approved run, employee obligations, earning reservations and original payslip render intents. The run remains unpaid and creates no AGI membership.",
    input: Schema.Struct({ ...command, runId: Accounting.Identifier, input: ExecutePayrollRun }),
    output: PayrollRunExecution,
    readOnly: false,
  },
  payroll_get_run: {
    description: "Privately read one frozen payroll run and its posting result.",
    input: Schema.Struct(run),
    output: PayrollRunView,
    readOnly: true,
  },
  payroll_list_runs: {
    description: "Privately page frozen regular payroll runs. Follow next until null.",
    input: Schema.Struct({ ...scoped, after: Schema.optional(Accounting.Identifier) }),
    output: PayrollRunPage,
    readOnly: true,
  },
  payroll_get_payslip: {
    description:
      "Privately read the original payslip semantic document and retained artifact state.",
    input: Schema.Struct(document),
    output: PayrollPayslipView,
    readOnly: true,
  },
  payroll_get_payslip_artifact: {
    description: "Privately read the saved original payslip PDF bytes with their verified hash.",
    input: Schema.Struct(document),
    output: PayrollPayslipArtifactBytes,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll";

const params = Schema.Struct({ ...Accounting.Scope.fields, runId: Accounting.Identifier });

const docParams = Schema.Struct({ ...Accounting.Scope.fields, documentId: Accounting.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const PayrollRunApi = HttpApiGroup.make("payrollRun")
  .add(
    HttpApiEndpoint.post("preparePayrollRun", `${root}/runs`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(PreparePayrollRun),
      success: PayrollRun,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("approvePayrollRun", `${root}/runs/:runId/approvals`, {
      params,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(ApprovePayrollRun),
      success: PayrollRunApproval,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("executePayrollRun", `${root}/runs/:runId/executions`, {
      params,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(ExecutePayrollRun),
      success: PayrollRunExecution,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPayrollRun", `${root}/runs/:runId`, {
      params,
      success: PayrollRunView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listPayrollRuns", `${root}/runs`, {
      params: Accounting.Scope,
      query: Schema.Struct({ after: Schema.optional(Accounting.Identifier) }),
      success: PayrollRunPage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPayrollPayslip", `${root}/payslips/:documentId`, {
      params: docParams,
      success: PayrollPayslipView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPayrollPayslipArtifact", `${root}/payslips/:documentId/artifact`, {
      params: docParams,
      success: PayrollPayslipArtifactBytes,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("renderPayrollPayslip", `${root}/payslips/:documentId/renders`, {
      params: docParams,
      headers: Accounting.IdempotencyHeaders,
      payload: payload(RenderPayrollPayslip),
      success: PayrollPayslipArtifact,
      error: accountingErrors,
    }),
  );
