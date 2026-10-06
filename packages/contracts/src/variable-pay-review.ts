import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { WorkSegmentKind } from "@open-erp/domain/variable-pay";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./commerce";

const Month = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/));

const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));

const SourceIdentity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const VariablePaySourceOccurrence = Schema.Struct({
  occurrenceId: A.Identifier,
  sha256: A.Digest,
});

export const VariablePaySourceProfile = Schema.Struct({
  profile: Schema.Literal("synthetic-variable-timesheet-v1"),
  employeeId: A.Identifier,
  month: Month,
  paymentOn: A.AccountingDate,
  sourceSystem: SourceIdentity,
  sourceAccountId: SourceIdentity,
  occurrenceKey: SourceIdentity,
  rows: Schema.Array(
    Schema.Struct({
      rowIdentity: A.Identifier,
      sourceId: SourceIdentity,
      economicOccurrence: SourceIdentity,
      kind: WorkSegmentKind,
      scheduleDate: A.AccountingDate,
      startLocal: LocalTime,
      endLocal: LocalTime,
      breakMinutes: A.MinorUnits,
      unitsMinor: A.MinorUnits,
      rateMinor: A.MinorUnits,
      priorRunRow: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

export const VariablePayBlocker = Schema.Struct({
  code: Schema.Literals([
    "unsupported_work",
    "holiday_control",
    "duplicate_source",
    "invalid_source",
  ]),
  sourceIds: Schema.Array(SourceIdentity),
  dates: Schema.Array(A.AccountingDate),
  amountMinor: Schema.NullOr(A.MinorUnits),
  priorInputId: Schema.NullOr(A.Identifier),
  priorRunId: Schema.NullOr(A.Identifier),
  priorPaidEventId: Schema.NullOr(A.Identifier),
  priorPaidEventDigest: Schema.NullOr(A.Digest),
  priorPaidEvidenceId: Schema.NullOr(A.Identifier),
  priorSettlementExecutionId: Schema.NullOr(A.Identifier),
  paidOn: Schema.NullOr(A.AccountingDate),
  priorRunRow: Schema.NullOr(Schema.Int),
});

export const AssessVariablePay = Schema.Struct({
  inputDigest: A.Digest,
  sourceOccurrence: VariablePaySourceOccurrence,
});

export const VariablePayAssessment = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  inputId: A.Identifier,
  inputDigest: A.Digest,
  digest: A.Digest,
  sourceOccurrence: VariablePaySourceOccurrence,
  sourceProfile: VariablePaySourceProfile,
  employee: Schema.Struct({ id: A.Identifier, personRef: A.Description }),
  submitter: Schema.Struct({ actorId: A.Identifier, displayName: A.Description }),
  paymentOn: A.AccountingDate,
  workedMinutes: Schema.NullOr(A.MinorUnits),
  rateMinor: Schema.NullOr(A.MinorUnits),
  workedAmountMinor: Schema.NullOr(A.MinorUnits),
  sickAmountMinor: Schema.NullOr(A.MinorUnits),
  holidayDeltaMinor: Schema.NullOr(A.SignedMinorUnits),
  holidayControl: Schema.Struct({
    accountId: A.Identifier,
    accountCode: A.Description,
    openingMinor: A.MinorUnits,
    ledgerMinor: A.SignedMinorUnits,
    differenceMinor: A.SignedMinorUnits,
    socialAccountId: A.Identifier,
    openingSocialMinor: A.MinorUnits,
    ledgerSocialMinor: A.SignedMinorUnits,
  }),
  blockers: Schema.Array(VariablePayBlocker),
  dependencyDigest: A.Digest,
  createdAt: Schema.String,
  createdBy: A.Identifier,
  receipt: CommandReceipt,
});

export const SelectVariablePay = Schema.Struct({ assessmentDigest: A.Digest });

export const VariablePayPendingSelection = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  inputId: A.Identifier,
  inputDigest: A.Digest,
  assessmentId: A.Identifier,
  assessmentDigest: A.Digest,
  digest: A.Digest,
  createdAt: Schema.String,
  createdBy: A.Identifier,
  receipt: CommandReceipt,
});

export const DisposeVariablePay = Schema.Struct({
  assessmentDigest: A.Digest,
  selectionId: A.Identifier,
  kind: Schema.Literals(["returned", "removed"]),
});

export const VariablePayDisposition = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  inputId: A.Identifier,
  inputDigest: A.Digest,
  assessmentId: A.Identifier,
  assessmentDigest: A.Digest,
  selectionId: A.Identifier,
  kind: DisposeVariablePay.fields.kind,
  submitterActorId: A.Identifier,
  digest: A.Digest,
  createdAt: Schema.String,
  createdBy: A.Identifier,
  receipt: CommandReceipt,
});

export const VariablePayReviewView = Schema.Struct({
  assessment: VariablePayAssessment,
  current: Schema.Struct({
    assessmentCurrent: Schema.Boolean,
    holidayControl: VariablePayAssessment.fields.holidayControl,
    canPrepareFinancialReview: Schema.Boolean,
    canApprove: Schema.Boolean,
    canReturn: Schema.Boolean,
    canRemove: Schema.Boolean,
    blockers: Schema.Array(VariablePayBlocker),
    status: Schema.Literals(["blocked", "ready", "returned", "removed", "recognized"]),
  }),
  selection: Schema.NullOr(VariablePayPendingSelection),
  dispositions: Schema.Array(VariablePayDisposition),
  financialReview: Schema.NullOr(
    Schema.Struct({ id: A.Identifier, digest: A.Digest, postingPlanId: A.Identifier }),
  ),
  recognition: Schema.NullOr(
    Schema.Struct({ id: A.Identifier, reviewId: A.Identifier, voucherId: A.Identifier }),
  ),
  financialApproval: Schema.NullOr(
    Schema.Struct({
      id: A.Identifier,
      reviewId: A.Identifier,
      reviewDigest: A.Digest,
      actorId: A.Identifier,
      expiresAt: Schema.String,
      usable: Schema.Boolean,
    }),
  ),
});

export const VariablePayReviewPage = Schema.Struct({
  items: Schema.Array(VariablePayReviewView),
  next: Schema.NullOr(A.Identifier),
});

const scoped = { scope: A.Scope };

const command = { ...scoped, idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"] };

export const VariablePayReviewCapabilities = {
  payroll_assess_variable_input: {
    description:
      "Retain all current synthetic variable-pay blockers and known partial calculations without approval or posting.",
    input: Schema.Struct({ ...command, inputId: A.Identifier, input: AssessVariablePay }),
    output: VariablePayReviewView,
    readOnly: false,
  },
  payroll_select_variable_input: {
    description: "Retain a nonfinancial pending selection for an exact variable-pay assessment.",
    input: Schema.Struct({ ...command, assessmentId: A.Identifier, input: SelectVariablePay }),
    output: VariablePayReviewView,
    readOnly: false,
  },
  payroll_dispose_variable_input: {
    description:
      "Retain return to the actual human submitter or removal of a pending variable-pay selection; preserve financial history.",
    input: Schema.Struct({ ...command, assessmentId: A.Identifier, input: DisposeVariablePay }),
    output: VariablePayReviewView,
    readOnly: false,
  },
  payroll_get_variable_assessment: {
    description:
      "Privately read retained variable-pay assessment, current blockers and dispositions.",
    input: Schema.Struct({ ...scoped, assessmentId: A.Identifier }),
    output: VariablePayReviewView,
    readOnly: true,
  },
  payroll_list_variable_assessments: {
    description:
      "Privately discover bounded retained variable-pay assessments with durable continuation.",
    input: Schema.Struct({ ...scoped, cursor: Schema.optional(A.Identifier) }),
    output: VariablePayReviewPage,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll/variable-pay";

const params = Schema.Struct({ ...A.Scope.fields, assessmentId: A.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const VariablePayReviewApi = HttpApiGroup.make("variablePayReview")
  .add(
    HttpApiEndpoint.post("assessVariablePay", `${root}/:inputId/assessments`, {
      params: Schema.Struct({ ...A.Scope.fields, inputId: A.Identifier }),
      headers: A.IdempotencyHeaders,
      payload: payload(AssessVariablePay),
      success: VariablePayReviewView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("selectVariablePay", `${root}/assessments/:assessmentId/selections`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(SelectVariablePay),
      success: VariablePayReviewView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("disposeVariablePay", `${root}/assessments/:assessmentId/dispositions`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(DisposeVariablePay),
      success: VariablePayReviewView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getVariablePayAssessment", `${root}/assessments/:assessmentId`, {
      params,
      success: VariablePayReviewView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listVariablePayAssessments", root, {
      params: A.Scope,
      query: Schema.Struct({ cursor: Schema.optional(A.Identifier) }),
      success: VariablePayReviewPage,
      error: accountingErrors,
    }),
  );
