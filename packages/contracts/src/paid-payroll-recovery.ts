import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Settlement from "./payroll-settlements";
import * as Runs from "./payroll-runs";
import { CommandReceipt, EvidenceReference } from "./commerce";
import { accountingErrors } from "./accounting-errors";

const metadata = {
  scope: A.Scope,
  digest: A.Digest,
  createdAt: Schema.String,
  createdBy: A.Identifier,
  receipt: CommandReceipt,
};

const Month = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/));

export const PreparePaidRecovery = Schema.Struct({
  comparisonId: A.Identifier,
  calculationId: A.Identifier,
});

export const PaidRecoveryCapacity = Schema.Struct({
  calculationId: A.Identifier,
  digest: A.Digest,
  month: Month,
  availableNetMinor: A.MinorUnits,
  paymentOn: A.AccountingDate,
  context: A.Description,
});

export const PaidRecoveryAssessment = Schema.Struct({
  id: A.Identifier,
  comparisonId: A.Identifier,
  comparisonDigest: A.Digest,
  paidEventId: A.Identifier,
  paidEventDigest: A.Digest,
  employee: Schema.Struct({ id: A.Identifier, name: A.Description }),
  original: Schema.Struct({
    runId: A.Identifier,
    voucherId: A.Identifier,
    reportingPeriod: Month,
    paidOn: A.AccountingDate,
    grossMinor: A.MinorUnits,
    payableMinor: A.MinorUnits,
  }),
  targetMinor: A.MinorUnits,
  contributionDeltaMinor: A.SignedMinorUnits,
  capacity: PaidRecoveryCapacity,
  shortfallMinor: A.MinorUnits,
  blockers: Schema.Array(Schema.Literals(["missing_lawful_basis", "insufficient_net_capacity"])),
  ...metadata,
});

export const SplitPaidRecovery = Schema.Struct({ assessmentDigest: A.Digest });

export const PaidRecoveryLeg = Schema.Struct({
  id: A.Identifier,
  month: Month,
  amountMinor: A.MinorUnits,
  capacityCalculationId: Schema.NullOr(A.Identifier),
  capacityDigest: Schema.NullOr(A.Digest),
});

export const PaidRecoveryDraft = Schema.Struct({
  id: A.Identifier,
  assessmentId: A.Identifier,
  assessmentDigest: A.Digest,
  legs: Schema.Array(PaidRecoveryLeg).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  ...metadata,
});

export const AttachPaidRecovery = Schema.Struct({
  assessmentDigest: A.Digest,
  evidenceId: A.Identifier,
  reason: A.Description,
});

export const PaidRecoveryAttachment = Schema.Struct({
  id: A.Identifier,
  assessmentId: A.Identifier,
  assessmentDigest: A.Digest,
  evidence: EvidenceReference,
  reason: A.Description,
  ...metadata,
});

export const QualifyPaidRecovery = Schema.Struct({
  attachmentId: A.Identifier,
  attachmentDigest: A.Digest,
  purpose: Schema.Literals(["gross_claim", "net_offset"]),
});

export const PaidRecoveryQualification = Schema.Struct({
  id: A.Identifier,
  assessmentId: A.Identifier,
  assessmentDigest: A.Digest,
  attachmentId: A.Identifier,
  attachmentDigest: A.Digest,
  purpose: QualifyPaidRecovery.fields.purpose,
  adjustmentBasis: Settlement.AdjustmentBasis,
  ...metadata,
});

export const CancelPaidRecovery = Schema.Struct({
  assessmentDigest: A.Digest,
  reason: A.Description,
});

export const PaidRecoveryCancellation = Schema.Struct({
  id: A.Identifier,
  assessmentId: A.Identifier,
  ...CancelPaidRecovery.fields,
  ...metadata,
});

export const PreparePaidRecoveryClaim = Schema.Struct({
  assessmentDigest: A.Digest,
  qualificationId: A.Identifier,
  recoveryReceivableAccountId: A.Identifier,
  accountingPeriodId: A.Identifier,
  postingDate: A.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
});

export const PaidRecoveryView = Schema.Struct({
  assessment: PaidRecoveryAssessment,
  originalPaidEvent: Settlement.PaidPayrollEvent,
  comparison: Settlement.CorrectionComparison,
  drafts: Schema.Array(PaidRecoveryDraft),
  attachments: Schema.Array(PaidRecoveryAttachment),
  qualifications: Schema.Array(PaidRecoveryQualification),
  cancellation: Schema.NullOr(PaidRecoveryCancellation),
  claimReview: Schema.NullOr(Settlement.SettlementReview),
  claimExecution: Schema.NullOr(Settlement.SettlementExecution),
  claimSettlement: Schema.NullOr(Settlement.SettlementView),
  claimRemainingMinor: Schema.NullOr(A.MinorUnits),
  legs: Schema.Array(
    Schema.Struct({
      leg: PaidRecoveryLeg,
      reviews: Schema.Array(Settlement.SettlementView),
      capacityCalculationId: Schema.NullOr(A.Identifier),
      payrollRun: Schema.NullOr(Runs.PayrollRunView),
      noncash: Schema.NullOr(Settlement.SettlementView),
    }),
  ),
  current: Schema.Struct({
    assessmentCurrent: Schema.Boolean,
    canSplit: Schema.Boolean,
    canAttach: Schema.Boolean,
    canCancel: Schema.Boolean,
    canPrepareClaim: Schema.Boolean,
    status: Schema.Literals(["blocked", "drafted", "cancelled", "claimed"]),
  }),
});

export const PaidRecoveryBasisSources = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      title: A.Description,
      sha256: EvidenceReference.fields.sha256,
      mediaType: Schema.String,
      createdAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(20)),
  next: Schema.NullOr(A.Identifier),
});

export const PaidRecoveryList = Schema.Struct({
  items: Schema.Array(PaidRecoveryView),
  next: Schema.NullOr(A.Identifier),
});

const scoped = { scope: A.Scope };

const command = { ...scoped, idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"] };

export const PaidRecoveryCapabilities = {
  payroll_prepare_paid_recovery: {
    description:
      "Retain evidenced paid payroll recovery target and current NET capacity blockers without financial effects.",
    input: Schema.Struct({ ...command, input: PreparePaidRecovery }),
    output: PaidRecoveryView,
    readOnly: false,
  },
  payroll_split_paid_recovery: {
    description:
      "Retain server-derived recovery installments; unknown later capacity stays explicit.",
    input: Schema.Struct({ ...command, recoveryId: A.Identifier, input: SplitPaidRecovery }),
    output: PaidRecoveryView,
    readOnly: false,
  },
  payroll_attach_paid_recovery: {
    description: "Retain exact unqualified lawful-basis evidence for paid payroll recovery.",
    input: Schema.Struct({ ...command, recoveryId: A.Identifier, input: AttachPaidRecovery }),
    output: PaidRecoveryView,
    readOnly: false,
  },
  payroll_cancel_paid_recovery: {
    description:
      "Cancel an unexecuted paid payroll recovery attempt while retaining its refused assessment.",
    input: Schema.Struct({ ...command, recoveryId: A.Identifier, input: CancelPaidRecovery }),
    output: PaidRecoveryView,
    readOnly: false,
  },
  payroll_get_paid_recovery: {
    description: "Privately read paid payroll recovery history and current blockers.",
    input: Schema.Struct({ ...scoped, recoveryId: A.Identifier }),
    output: PaidRecoveryView,
    readOnly: true,
  },
  payroll_list_paid_recoveries: {
    description: "Privately discover retained paid payroll recovery attempts.",
    input: Schema.Struct({ ...scoped, cursor: Schema.optional(A.Identifier) }),
    output: PaidRecoveryList,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll/paid-recoveries";

const params = Schema.Struct({ ...A.Scope.fields, recoveryId: A.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const PaidRecoveryApi = HttpApiGroup.make("paidRecovery")
  .add(
    HttpApiEndpoint.get(
      "listPaidRecoveryBasisSources",
      "/v1/entities/:entityId/books/:bookId/payroll/paid-recovery-basis-sources",
      {
        params: A.Scope,
        query: Schema.Struct({ cursor: Schema.optional(A.Identifier) }),
        success: PaidRecoveryBasisSources,
        error: accountingErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("preparePaidRecovery", root, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: payload(PreparePaidRecovery),
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.post("splitPaidRecovery", `${root}/:recoveryId/splits`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(SplitPaidRecovery),
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.post("attachPaidRecovery", `${root}/:recoveryId/attachments`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(AttachPaidRecovery),
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.post("qualifyPaidRecovery", `${root}/:recoveryId/qualifications`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(QualifyPaidRecovery),
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.post("preparePaidRecoveryClaim", `${root}/:recoveryId/claim-reviews`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(PreparePaidRecoveryClaim),
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.post("cancelPaidRecovery", `${root}/:recoveryId/cancellations`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(CancelPaidRecovery),
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.get("getPaidRecovery", `${root}/:recoveryId`, {
      params,
      success: PaidRecoveryView,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  )
  .add(
    HttpApiEndpoint.get("listPaidRecoveries", root, {
      params: A.Scope,
      query: Schema.Struct({ cursor: Schema.optional(A.Identifier) }),
      success: PaidRecoveryList,
      error: accountingErrors,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" }),
  );
