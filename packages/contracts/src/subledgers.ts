import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";

export const SchedulePeriod = Schema.Struct({
  postingDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
});
export const ScheduleTerms = Schema.Struct({
  kind: Schema.Literals(["asset", "deferral"]),
  name: Accounting.Description,
  evidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  costMinor: Accounting.MinorUnits,
  residualMinor: Accounting.MinorUnits,
  usefulPeriods: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
  allocationPolicy: Schema.Literal("equal_minor_final_remainder_v1"),
  debitAccountId: Accounting.Identifier,
  creditAccountId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  periods: Schema.Array(SchedulePeriod).check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  taxAssessment: Schema.Literal("not_applicable"),
});
export const RetainedScheduleTerms = Schema.Struct({
  ...ScheduleTerms.fields,
  allocationPolicy: Schema.Literals([
    "equal_minor_final_remainder_v1",
    "explicit_remaining_minor_v1",
  ]),
});
export const CreateSchedule = Schema.Struct({
  sourceKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
  terms: ScheduleTerms,
});
export const ReviseSchedule = Schema.Struct({
  expectedDigest: Accounting.Digest,
  terms: ScheduleTerms,
});
export const AmendScheduleFutureDates = Schema.Struct({
  expectedDigest: Accounting.Digest,
  expectedBasisDigest: Accounting.Digest,
  firstOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
  remainingMinor: Accounting.MinorUnits,
  periods: Schema.Array(SchedulePeriod).check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  reviewEvidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
});
export const ScheduleDateAmendment = Schema.Struct({
  kind: Schema.Literal("future_dates_v1"),
  input: AmendScheduleFutureDates,
  basisDigest: Accounting.Digest,
  basisScheduleDigest: Accounting.Digest,
  reviewSha256: Schema.String,
  reviewedOn: Accounting.AccountingDate,
});
export const AmendScheduleEstimate = Schema.Struct({
  expectedDigest: Accounting.Digest,
  expectedBasisDigest: Accounting.Digest,
  firstOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
  remainingMinor: Accounting.MinorUnits,
  residualMinor: Accounting.MinorUnits,
  installments: Schema.Array(
    Schema.Struct({
      ...SchedulePeriod.fields,
      amountMinor: Accounting.MinorUnits.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/)),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  reviewEvidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
});
export const ScheduleEstimateAmendment = Schema.Struct({
  kind: Schema.Literal("remaining_estimate_v1"),
  input: AmendScheduleEstimate,
  basisDigest: Accounting.Digest,
  basisScheduleDigest: Accounting.Digest,
  recognizedMinor: Accounting.MinorUnits,
  reversedMinor: Accounting.AggregateMinorUnits,
  reviewSha256: Schema.String,
  reviewedOn: Accounting.AccountingDate,
});
export const ScheduleOccurrence = Schema.Struct({
  ordinal: Schema.Int,
  ...SchedulePeriod.fields,
  eventKey: Schema.String,
  amountMinor: Accounting.MinorUnits,
});
export const ScheduleRevision = Schema.Struct({
  scheduleId: Accounting.Identifier,
  sourceKey: Schema.String,
  revision: Schema.Int,
  scope: Accounting.Scope,
  terms: RetainedScheduleTerms,
  currency: Schema.String,
  currencyScale: Schema.Int,
  sourceSha256: Schema.String,
  previousDigest: Schema.NullOr(Accounting.Digest),
  digest: Accounting.Digest,
  occurrences: Schema.Array(ScheduleOccurrence),
  allocatedMinor: Accounting.MinorUnits,
  amendment: Schema.optional(Schema.Union([ScheduleDateAmendment, ScheduleEstimateAmendment])),
  createdAt: Schema.String,
  receipt: CommandReceipt,
});
export const OccurrenceState = Schema.Struct({
  ...ScheduleOccurrence.fields,
  changeSetId: Schema.NullOr(Accounting.Identifier),
  planDigest: Schema.NullOr(Accounting.Digest),
  voucherId: Schema.NullOr(Accounting.Identifier),
  reversalVoucherId: Schema.NullOr(Accounting.Identifier),
  state: Schema.Literals(["unprepared", "prepared", "posted", "reversed", "conflicted"]),
});
// Live prerequisite state, not a legal policy or reconciliation certificate.
export const SchedulePostingBasis = Schema.Struct({
  mode: Schema.Literals(["standalone_synthetic", "linked_basis"]),
  supported: Schema.Boolean,
  basisDigest: Schema.NullOr(Accounting.Digest),
  basisVoucherId: Schema.NullOr(Accounting.Identifier),
  scheduleDigest: Schema.optional(Accounting.Digest),
  blocker: Schema.NullOr(
    Schema.Literals([
      "basis_reversed_or_corrected",
      "basis_mismatch",
      "estimate_history_changed",
      "disposed",
    ]),
  ),
  legalPolicyApproved: Schema.Literal(false),
});
export const AssetDisposal = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  scheduleId: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  scheduleDigest: Accounting.Digest,
  basisDigest: Accounting.Digest,
  originalCostMinor: Accounting.MinorUnits,
  openingAccumulatedMinor: Accounting.MinorUnits,
  recognizedMinor: Accounting.MinorUnits,
  totalAccumulatedMinor: Accounting.MinorUnits,
  carryingMinorReleased: Accounting.MinorUnits,
  carryingMinor: Schema.Literal("0"),
  status: Schema.Literal("synthetic_disposed"),
  futureRecognitionBlocked: Schema.Literal(true),
  postingReceipt: Accounting.ExecutionReceipt,
  coverage: Schema.Literal("not_established"),
  legalPolicyApproved: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
// Live references only. Reservation presence does not assess role compatibility or authority.
export const ScheduleBasisTaxMatches = Schema.Struct({
  roleCompatibility: Schema.Literal("not_assessed"),
  matches: Schema.Array(
    Schema.Struct({
      voucherId: Accounting.Identifier,
      lineId: Accounting.Identifier,
      matchId: Accounting.Identifier,
      eventId: Accounting.Identifier,
      matchDigest: Accounting.Digest,
    }),
  ).check(Schema.isMaxLength(20)),
});
export const ScheduleView = Schema.Struct({
  basisTaxMatches: Schema.optional(ScheduleBasisTaxMatches),
  disposal: Schema.optional(Schema.NullOr(AssetDisposal)),
  current: ScheduleRevision,
  revisions: Schema.Array(ScheduleRevision),
  occurrences: Schema.Array(OccurrenceState),
  recognizedMinor: Accounting.MinorUnits,
  remainingMinor: Accounting.MinorUnits,
  revisionAllowed: Schema.Boolean,
  postingBasis: Schema.optional(SchedulePostingBasis),
  controlAccountReconciled: Schema.Literal(false),
  requiresPostingApproval: Schema.Literal(true),
});
export const ScheduleSummary = Schema.Struct({
  id: Accounting.Identifier,
  sourceKey: Schema.String,
  name: Accounting.Description,
  kind: ScheduleTerms.fields.kind,
  revision: Schema.Int,
  digest: Accounting.Digest,
});
export const SchedulePage = Schema.Struct({
  items: Schema.Array(ScheduleSummary),
  next: Schema.NullOr(Accounting.Identifier),
});
export const ScheduleQuery = Schema.Struct({ after: Schema.optional(Accounting.Identifier) });
export const PrepareScheduleOccurrence = Schema.Struct({
  expectedDigest: Accounting.Digest,
  ordinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
});
export const SchedulePreparation = Schema.Struct({
  scheduleId: Accounting.Identifier,
  revisionDigest: Accounting.Digest,
  ordinal: Schema.Int,
  changeSetId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  postingBasis: Schema.optional(SchedulePostingBasis),
  requiresPostingApproval: Schema.Literal(true),
  receipt: CommandReceipt,
});
const path = "/v1/entities/:entityId/books/:bookId/schedules";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
export const SubledgersApi = HttpApiGroup.make("subledgers").add(
  HttpApiEndpoint.post("createSchedule", path, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateSchedule.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ScheduleRevision,
  }),
  HttpApiEndpoint.get("listSchedules", path, {
    ...scoped,
    query: ScheduleQuery,
    success: SchedulePage,
  }),
  HttpApiEndpoint.get("getSchedule", `${path}/:id`, { ...identified, success: ScheduleView }),
  HttpApiEndpoint.post("reviseSchedule", `${path}/:id/revisions`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: ReviseSchedule.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ScheduleRevision,
  }),
  HttpApiEndpoint.post("amendScheduleFutureDates", `${path}/:id/future-dates`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: AmendScheduleFutureDates.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ScheduleRevision,
  }),
  HttpApiEndpoint.post("amendScheduleEstimate", `${path}/:id/estimates`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: AmendScheduleEstimate.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: ScheduleRevision,
  }),
  HttpApiEndpoint.post("prepareScheduleOccurrence", `${path}/:id/prepare`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareScheduleOccurrence.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SchedulePreparation,
  }),
);
const scope = { scope: Accounting.Scope };
const mutation = {
  ...scope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};
export const SubledgerCapabilities = {
  schedules_create: {
    description:
      "Retain an evidence-backed synthetic asset or deferral schedule. Exact caller-selected allocation, dates and accounts; no legal policy or posting approval.",
    input: Schema.Struct({ ...mutation, input: CreateSchedule }),
    output: ScheduleRevision,
    readOnly: false,
  },
  schedules_list: {
    description:
      "Page through retained schedules in this book. Absence does not establish complete source coverage.",
    input: Schema.Struct({ ...scope, ...ScheduleQuery.fields }),
    output: SchedulePage,
    readOnly: true,
  },
  schedules_get: {
    description:
      "Read immutable schedule revisions and live proposal, posting, reversal and remaining-amount state, including active tax-match references on basis lines. Role compatibility is not assessed. Not control-account reconciliation.",
    input: Schema.Struct({ ...scope, scheduleId: Accounting.Identifier }),
    output: ScheduleView,
    readOnly: true,
  },
  schedules_revise: {
    description:
      "Append an immutable schedule revision before any occurrence has been prepared. Sealed proposals freeze the schedule; no history is reset.",
    input: Schema.Struct({ ...mutation, scheduleId: Accounting.Identifier, input: ReviseSchedule }),
    output: ScheduleRevision,
    readOnly: false,
  },
  schedules_prepare: {
    description:
      "Prepare or recover one ordinary kernel proposal with stable schedule occurrence identity. Stale dependencies may create a fresh proposal; human posting approval remains separate.",
    input: Schema.Struct({
      ...mutation,
      scheduleId: Accounting.Identifier,
      input: PrepareScheduleOccurrence,
    }),
    output: SchedulePreparation,
    readOnly: false,
  },
};
