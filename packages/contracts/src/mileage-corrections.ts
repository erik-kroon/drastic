import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  TripRevision,
  MileageRuleRelease,
  MileageSplit,
} from "@open-erp/domain/mileage-reimbursement";
import * as A from "./accounting";
import * as Settlement from "./payroll-settlements";
import * as Payroll from "./payroll-calculations";
import { CommandReceipt } from "./commerce";
import { SourceOccurrence } from "./source-intake";
import { accountingErrors } from "./accounting-errors";

const retained = {
  id: A.Identifier,
  scope: A.Scope,
  digest: A.Digest,
  createdAt: Schema.String,
  createdBy: A.Identifier,
  receipt: CommandReceipt,
};

export const MileageSourceSelection = Schema.Struct({
  occurrenceId: A.Identifier,
  sha256: A.Digest,
});

export const PrepareMileageCorrection = Schema.Struct({
  originalInputId: A.Identifier,
  originalInputDigest: A.Digest,
  previousCorrectionExecutionId: Schema.NullOr(A.Identifier),
  revisedTrip: TripRevision,
  originalRouteSource: Schema.NullOr(MileageSourceSelection),
  routeSource: Schema.NullOr(MileageSourceSelection),
  recoveryBasisSource: Schema.NullOr(MileageSourceSelection),
  recoveryReason: Schema.NullOr(A.Description),
  recoveryReceivableAccountId: A.Identifier,
  accountingPeriodId: A.Identifier,
  postingDate: A.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
});

export const MileageCorrectionBlocker = Schema.Struct({
  code: Schema.String,
  message: A.Description,
  sourceRef: Schema.NullOr(A.Identifier),
});

export const MileageContributionWitness = Schema.Struct({
  ruleReleaseId: A.Identifier,
  ruleReleaseChecksum: A.Digest,
  calculatorVersion: Schema.String,
  profileId: A.Identifier,
  obligationReference: A.Description,
  bands: Schema.Array(Payroll.ContributionBand),
  rounding: Payroll.PayrollRounding,
  openingBaseMinor: A.MinorUnits,
  originalBaseMinor: A.MinorUnits,
  revisedBaseMinor: A.MinorUnits,
  originalContributionMinor: A.MinorUnits,
  revisedContributionMinor: A.MinorUnits,
});

export const MileageCorrectionOriginal = Schema.Struct({
  reference: A.Description,
  trip: TripRevision,
  split: Schema.NullOr(MileageSplit),
  release: MileageRuleRelease,
  inputId: A.Identifier,
  inputDigest: A.Digest,
  recognitionReviewId: Schema.NullOr(A.Identifier),
  recognitionExecutionId: Schema.NullOr(A.Identifier),
  recognitionVoucherId: Schema.NullOr(A.Identifier),
  consumedRunId: Schema.NullOr(A.Identifier),
  paidEventId: Schema.NullOr(A.Identifier),
  paidEventDigest: Schema.NullOr(A.Digest),
  paidOn: Schema.NullOr(A.AccountingDate),
  earningsPeriod: Schema.NullOr(
    Schema.Struct({ startsOn: A.AccountingDate, endsOn: A.AccountingDate }),
  ),
  reportingPeriod: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(A.Identifier),
  runDigest: Schema.NullOr(A.Digest),
  payslips: Schema.Array(
    Schema.Struct({
      documentId: A.Identifier,
      documentDigest: A.Digest,
      artifactId: Schema.NullOr(A.Identifier),
      sha256: Schema.NullOr(A.Digest),
    }),
  ),
  declarations: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      digest: A.Digest,
      reportingPeriod: Schema.String,
    }),
  ),
});

export const MileageCorrectionComparison = Schema.Struct({
  originalDistanceMeters: A.MinorUnits,
  predecessorDistanceMeters: A.MinorUnits,
  revisedDistanceMeters: A.MinorUnits,
  distanceDeltaMeters: A.SignedMinorUnits,
  originalSplit: MileageSplit,
  predecessorSplit: MileageSplit,
  revisedSplit: MileageSplit,
  entitlementDeltaMinor: A.SignedMinorUnits,
  exemptDeltaMinor: A.SignedMinorUnits,
  taxableDeltaMinor: A.SignedMinorUnits,
  paidComparisonId: A.Identifier,
  paidComparisonDigest: A.Digest,
  contributionCorrectionMinor: A.SignedMinorUnits,
  contributionIncludedInJournal: Schema.Literal(false),
  contributionWitness: MileageContributionWitness,
});

export const MileageCorrectionJournal = Schema.Struct({
  lines: Schema.Array(
    Schema.Struct({
      accountId: A.Identifier,
      accountCode: Schema.String,
      accountName: Schema.String,
      debitMinor: A.MinorUnits,
      creditMinor: A.MinorUnits,
    }),
  ),
  debitMinor: A.MinorUnits,
  creditMinor: A.MinorUnits,
  receivableMinor: A.MinorUnits,
  claimedGrossMinor: A.MinorUnits,
});

export const MileageCorrectionProposal = Schema.Struct({
  ...retained,
  input: PrepareMileageCorrection,
  employee: Schema.Struct({ id: A.Identifier, personRef: A.Description }),
  original: MileageCorrectionOriginal,
  sources: Schema.Struct({
    originalRoute: Schema.NullOr(SourceOccurrence),
    revisedRoute: Schema.NullOr(SourceOccurrence),
    recoveryBasis: Schema.NullOr(SourceOccurrence),
    recoveryReason: Schema.NullOr(A.Description),
  }),
  comparison: Schema.NullOr(MileageCorrectionComparison),
  journal: Schema.NullOr(MileageCorrectionJournal),
  dependencyDigest: A.Digest,
  blockers: Schema.Array(MileageCorrectionBlocker),
});

export const ReviewMileageCorrection = Schema.Struct({
  proposalDigest: A.Digest,
  lawfulBasisId: A.Identifier,
});

export const MileageCorrectionReviewLink = Schema.Struct({
  ...retained,
  proposalId: A.Identifier,
  proposalDigest: A.Digest,
  reviewId: A.Identifier,
});

export const SubmitMileageCorrection = Schema.Struct({
  proposalDigest: A.Digest,
  reviewDigest: A.Digest,
});

export const MileageCorrectionSubmission = Schema.Struct({
  ...retained,
  proposalId: A.Identifier,
  proposalDigest: A.Digest,
  reviewId: A.Identifier,
  reviewDigest: A.Digest,
});

export const CancelMileageCorrection = Schema.Struct({ proposalDigest: A.Digest });

export const MileageCorrectionCancellation = Schema.Struct({
  ...retained,
  proposalId: A.Identifier,
  proposalDigest: A.Digest,
});

export const MileageCorrectionView = Schema.Struct({
  proposal: MileageCorrectionProposal,
  employee: MileageCorrectionProposal.fields.employee,
  original: MileageCorrectionOriginal,
  sources: Schema.Struct({
    ...MileageCorrectionProposal.fields.sources.fields,
    lawfulBasisId: Schema.NullOr(A.Identifier),
    lawfulBasisDigest: Schema.NullOr(A.Digest),
    lawfulBasisReviewedBy: Schema.NullOr(A.Identifier),
  }),
  comparison: Schema.NullOr(MileageCorrectionComparison),
  journal: Schema.NullOr(MileageCorrectionJournal),
  settlementReview: Schema.NullOr(Settlement.SettlementReview),
  submissions: Schema.Array(MileageCorrectionSubmission),
  cancellation: Schema.NullOr(MileageCorrectionCancellation),
  approvals: Schema.Array(Settlement.SettlementApproval),
  execution: Schema.NullOr(Settlement.SettlementExecution),
  current: Schema.Struct({
    status: Schema.Literals([
      "blocked",
      "proposal",
      "submitted",
      "approved",
      "executed",
      "cancelled",
    ]),
    dependencyDigest: A.Digest,
    sourceCurrent: Schema.Boolean,
    approvalUsable: Schema.Boolean,
    canSubmit: Schema.Boolean,
    canCancel: Schema.Boolean,
    blockers: Schema.Array(MileageCorrectionBlocker),
    remainingReceivableMinor: A.MinorUnits,
    recoveryClaimId: Schema.NullOr(A.Identifier),
  }),
});

export const MileageCorrectionSummary = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  employee: MileageCorrectionProposal.fields.employee,
  originalReference: A.Description,
  paidOn: Schema.NullOr(A.AccountingDate),
  revisedDistanceMeters: A.MinorUnits,
  entitlementDeltaMinor: Schema.NullOr(A.SignedMinorUnits),
  status: MileageCorrectionView.fields.current.fields.status,
});

export const ListMileageCorrections = Schema.Struct({
  employeeId: Schema.optional(A.Identifier),
  originalInputId: Schema.optional(A.Identifier),
  cursor: Schema.optional(A.Identifier),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 50 })),
  ),
});

export const MileageCorrectionPage = Schema.Struct({
  items: Schema.Array(MileageCorrectionSummary),
  next: Schema.NullOr(A.Identifier),
});

const command = { scope: A.Scope, idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"] };

export const MileageCorrectionCapabilities = {
  payroll_prepare_mileage_correction: {
    description:
      "Retain an exact mileage source correction and paid comparison, including blocked proposals. No posting.",
    input: Schema.Struct({ ...command, input: PrepareMileageCorrection }),
    output: MileageCorrectionView,
    readOnly: false,
  },
  payroll_review_mileage_correction: {
    description:
      "Prepare the settlement-owned mileage recovery journal from an independently reviewed basis.",
    input: Schema.Struct({ ...command, proposalId: A.Identifier, input: ReviewMileageCorrection }),
    output: MileageCorrectionView,
    readOnly: false,
  },
  payroll_submit_mileage_correction: {
    description:
      "Submit an exact mileage proposal for independent approval. Does not approve or post.",
    input: Schema.Struct({ ...command, proposalId: A.Identifier, input: SubmitMileageCorrection }),
    output: MileageCorrectionView,
    readOnly: false,
  },
  payroll_cancel_mileage_correction: {
    description: "Retain cancellation and invalidate unexecuted mileage correction authority.",
    input: Schema.Struct({ ...command, proposalId: A.Identifier, input: CancelMileageCorrection }),
    output: MileageCorrectionView,
    readOnly: false,
  },
  payroll_get_mileage_correction: {
    description: "Read retained mileage correction source, history and current authority.",
    input: Schema.Struct({ scope: A.Scope, proposalId: A.Identifier }),
    output: MileageCorrectionView,
    readOnly: true,
  },
  payroll_list_mileage_corrections: {
    description: "Discover bounded private mileage correction history.",
    input: Schema.Struct({ scope: A.Scope, input: ListMileageCorrections }),
    output: MileageCorrectionPage,
    readOnly: true,
  },
};

const root = "/v1/entities/:entityId/books/:bookId/payroll/mileage-corrections";

const params = Schema.Struct({ ...A.Scope.fields, proposalId: A.Identifier });

const payload = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: { onExcessProperty: "error" } });

export const MileageCorrectionApi = HttpApiGroup.make("mileageCorrections")
  .add(
    HttpApiEndpoint.post("prepareMileageCorrection", root, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: payload(PrepareMileageCorrection),
      success: MileageCorrectionView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listMileageCorrections", root, {
      params: A.Scope,
      query: ListMileageCorrections,
      success: MileageCorrectionPage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getMileageCorrection", `${root}/:proposalId`, {
      params,
      success: MileageCorrectionView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reviewMileageCorrection", `${root}/:proposalId/reviews`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(ReviewMileageCorrection),
      success: MileageCorrectionView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("submitMileageCorrection", `${root}/:proposalId/submissions`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(SubmitMileageCorrection),
      success: MileageCorrectionView,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelMileageCorrection", `${root}/:proposalId/cancellations`, {
      params,
      headers: A.IdempotencyHeaders,
      payload: payload(CancelMileageCorrection),
      success: MileageCorrectionView,
      error: accountingErrors,
    }),
  );
