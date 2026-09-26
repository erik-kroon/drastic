import * as Schema from "effect/Schema";
import { Digest, Identifier, Scope, ChangePath, IdempotencyHeaders } from "./accounting";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { accountingErrors } from "./accounting-errors";

export const OutcomeKind = Schema.Literals(["prepared", "submitted", "accepted"]);

export const ReferenceKind = Schema.Literals([
  "local_prepared_artifact",
  "submitted_attempt",
  "authority_outcome",
  "reviewed_external_evidence",
]);

// An environment an obligation may be fulfilled in. A sandbox observation can
// never stand in for a production one.
export const FulfillmentEnvironment = Schema.Literals(["production", "sandbox"]);

export const RuleFamily = Schema.Literals([
  "posting_eligibility",
  "vat",
  "payroll",
  "statements",
  "legal_ar",
]);

// A statutory due date is a qualified input, never a computed default. This is
// the reviewed rule and calendar release that produced it, the reporting period
// it belongs to, and the date that basis yields. The application never derives
// a due date from a cadence shortcut.
export const StatutoryBasis = Schema.Struct({
  jurisdiction: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  family: RuleFamily,
  ruleReference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  ruleVersion: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  calendarReference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  periodId: Identifier,
  basisDueAt: Schema.String,
});

// A successor obligation names the obligation it supersedes and the rule-change
// notice that required it. The original receipt stays on the original row.
export const DeadlineAmendment = Schema.Struct({
  obligationId: Identifier,
  noticeId: Identifier,
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
});

export const DeadlineInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  periodId: Identifier,
  responsibleActorId: Identifier,
  dueAt: Schema.String,
  timeZone: Schema.String,
  sourceReference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  sourceRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  overrideReason: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  ),
  jurisdiction: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  statutoryBasis: StatutoryBasis,
  requiredEnvironment: FulfillmentEnvironment,
  amendment: Schema.optional(DeadlineAmendment),
  outcomeKind: OutcomeKind,
});

export const SaveDeadline = Schema.Struct({
  scope: Scope,
  id: Identifier,
  expectedRevision: Schema.NullOr(Schema.Int),
  input: DeadlineInput,
});

export const DeadlineActivity = Schema.Struct({
  scope: Scope,
  id: Identifier,
  action: Schema.Literals(["dismiss_reminder"]),
}).check(
  Schema.makeFilter(
    (value) =>
      value.action === "dismiss_reminder" ||
      "An outcome is recorded by linking verified fulfillment evidence, not by typing a reference.",
  ),
);

export const DeadlineCurrentOutcome = Schema.Struct({
  kind: OutcomeKind,
  reference: Schema.String,
  recordedAt: Schema.String,
});

export const DeadlineActivityHistoryEntry = Schema.Struct({
  id: Identifier,
  action: Schema.Literals(["dismiss_reminder", "record_outcome"]),
  reference: Schema.NullOr(Schema.String),
  outcomeKind: Schema.NullOr(OutcomeKind),
  actorId: Identifier,
  recordedAt: Schema.String,
});

// A typed reference resolved against the record's own owner. Nothing here is a
// free-text claim: each variant names the owner that has to confirm it.
export const FulfillmentReference = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("local_prepared_artifact"),
    owner: Schema.Literals(["accountant_review_artifact", "sie_transaction_artifact"]),
    artifactId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    revision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
    digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    environment: FulfillmentEnvironment,
  }),
  Schema.Struct({
    kind: Schema.Literal("submitted_attempt"),
    owner: Schema.Literal("ar_legal_delivery_attempt"),
    attemptId: Identifier,
    digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    environment: FulfillmentEnvironment,
  }),
  Schema.Struct({
    kind: Schema.Literal("authority_outcome"),
    observationId: Identifier,
    receiptIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
    coveredScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
    environment: FulfillmentEnvironment,
  }),
  Schema.Struct({
    kind: Schema.Literal("reviewed_external_evidence"),
    originalRef: Identifier,
    reviewer: Identifier,
    assertedMeaning: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
    limitations: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
    environment: FulfillmentEnvironment,
  }),
]);

// What the owner's own retained record was observed to mean. `confirmed` is only
// set for a fact the owner itself retains; otherwise the requirement is open.
export const FulfillmentWitness = Schema.Struct({
  owner: Schema.NullOr(Schema.String),
  outcomeConfirmed: Schema.Boolean,
  periodConfirmed: Schema.Boolean,
  familyConfirmed: Schema.Boolean,
  revisionConfirmed: Schema.Boolean,
  environmentConfirmed: Schema.Boolean,
  digestConfirmed: Schema.Boolean,
  observedPeriodId: Schema.NullOr(Identifier),
  observedFamily: Schema.NullOr(RuleFamily),
  observedRevision: Schema.NullOr(Schema.String),
  limitations: Schema.Array(Schema.String).check(Schema.isMaxLength(8)),
});

export const FulfillmentVerification = Schema.Struct({
  state: Schema.Literals(["satisfied", "pending", "mismatch"]),
  reason: Schema.String,
  witness: FulfillmentWitness,
});

export const FulfillmentLink = Schema.Struct({
  id: Identifier,
  scope: Scope,
  obligationId: Identifier,
  obligationRevision: Schema.Int,
  outcomeKind: OutcomeKind,
  reference: FulfillmentReference,
  referenceDigest: Digest,
  environment: FulfillmentEnvironment,
  verification: FulfillmentVerification,
  recordedBy: Identifier,
  recordedAt: Schema.String,
  digest: Digest,
});

export const FulfillmentList = Schema.Array(FulfillmentLink);

export const Deadline = Schema.Struct({
  book_id: Identifier,
  id: Identifier,
  title: Schema.String,
  period_id: Identifier,
  responsible_actor_id: Identifier,
  due_at: Schema.String,
  time_zone: Schema.String,
  source_reference: Schema.String,
  source_revision: Schema.String,
  override_reason: Schema.NullOr(Schema.String),
  outcome_kind: OutcomeKind,
  outcome_reference: Schema.NullOr(Schema.String),
  outcome_at: Schema.NullOr(Schema.String),
  reminder_dismissed_at: Schema.NullOr(Schema.String),
  jurisdiction: Schema.NullOr(Schema.String),
  statutory_basis: Schema.NullOr(StatutoryBasis),
  required_environment: Schema.NullOr(FulfillmentEnvironment),
  amends_obligation_id: Schema.NullOr(Identifier),
  amendment_notice_id: Schema.NullOr(Identifier),
  amended_outcome_kind: Schema.NullOr(OutcomeKind),
  amended_outcome_reference: Schema.NullOr(Schema.String),
  current_outcome: Schema.NullOr(DeadlineCurrentOutcome),
  // The latest typed evidence for this obligation, satisfied or not.
  fulfillment: Schema.NullOr(
    Schema.Struct({
      id: Identifier,
      outcomeKind: OutcomeKind,
      referenceKind: ReferenceKind,
      environment: FulfillmentEnvironment,
      verification: FulfillmentVerification.fields.state,
      reason: Schema.String,
      recordedAt: Schema.String,
      recordedBy: Identifier,
    }),
  ),
  // A pre-existing operator string stays an unverified observation. It is never
  // upgraded to authority evidence and never advances the derived outcome.
  reported_reference: Schema.NullOr(Schema.String),
  activity_history: Schema.Array(DeadlineActivityHistoryEntry),
  revision: Schema.Int,
  updated_at: Schema.String,
  status: Schema.optional(
    Schema.Literals(["upcoming", "overdue", "prepared", "submitted", "accepted"]),
  ),
}).check(
  Schema.makeFilter(
    (row) =>
      row.current_outcome === null ||
      row.reported_reference === null ||
      "A stored reference is either a verified outcome or a reported note, never both.",
  ),
);

export const FulfillmentResult = Schema.Struct({
  fulfillment: FulfillmentLink,
  obligation: Deadline,
});

export const DeadlineList = Schema.Array(Deadline);

export const FeedEvents = Schema.Struct({
  bookId: Identifier,
  events: Schema.Array(
    Schema.Struct({
      id: Identifier,
      title: Schema.String,
      dueAt: Schema.String,
      updatedAt: Schema.String,
      timeZone: Schema.String,
      revision: Schema.Int,
    }),
  ),
});

export const DeadlineFeed = Schema.Struct({ id: Identifier, secret: Schema.String });

export const RevokedDeadlineFeed = Schema.Struct({ id: Identifier, revoked: Schema.Literal(true) });

export const DeadlinesCapabilities = {
  deadlines_list: {
    description:
      "Read book-scoped obligations with current outcome and append-only reminder/outcome activity history.",
    input: Schema.Struct({ scope: Scope }),
    output: DeadlineList,
    readOnly: true,
  },
  deadlines_fulfillment_list: {
    description:
      "Read the typed fulfillment evidence recorded for one obligation, including why a reference was not accepted as proof.",
    input: Schema.Struct({ scope: Scope, id: Identifier }),
    output: FulfillmentList,
    readOnly: true,
  },
};

const base = "/v1/entities/:entityId/books/:bookId/deadlines";

export const DeadlinesApi = HttpApiGroup.make("deadlines")
  .add(
    HttpApiEndpoint.get("listDeadlines", base, {
      params: Scope,
      success: DeadlineList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listDeadlineFulfillments", `${base}/:id/fulfillments`, {
      params: ChangePath,
      success: FulfillmentList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveDeadline", `${base}/:id`, {
      params: ChangePath,
      headers: IdempotencyHeaders,
      payload: Schema.Struct({ expectedRevision: Schema.NullOr(Schema.Int), input: DeadlineInput }),
      success: Deadline,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("deadlineActivity", `${base}/:id/activity`, {
      params: ChangePath,
      headers: IdempotencyHeaders,
      payload: Schema.Struct({ action: DeadlineActivity.fields.action }),
      success: Deadline,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("linkDeadlineFulfillment", `${base}/:id/fulfillments`, {
      params: ChangePath,
      headers: IdempotencyHeaders,
      payload: Schema.Struct({ reference: FulfillmentReference }),
      success: FulfillmentResult,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createDeadlineFeed", `${base}/feeds/:id`, {
      params: ChangePath,
      success: DeadlineFeed,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("revokeDeadlineFeed", `${base}/feeds/:id/revoke`, {
      params: ChangePath,
      headers: IdempotencyHeaders,
      success: RevokedDeadlineFeed,
      error: accountingErrors,
    }),
  );
