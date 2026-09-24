import * as Schema from "effect/Schema";
import { Identifier, Scope, ChangePath, IdempotencyHeaders } from "./accounting";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { accountingErrors } from "./accounting-errors";

export const DeadlineInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  periodId: Identifier,
  responsibleActorId: Identifier,
  dueAt: Schema.String,
  timeZone: Schema.String,
  sourceReference: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  sourceRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  overrideReason: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  outcomeKind: Schema.Literals(["prepared", "submitted", "accepted"]),
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
  action: Schema.Literals(["dismiss_reminder", "record_outcome"]),
  reference: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))),
});
export const DeadlineCurrentOutcome = Schema.Struct({
  kind: Schema.Literals(["prepared", "submitted", "accepted"]),
  reference: Schema.String,
  recordedAt: Schema.String,
});
export const DeadlineActivityHistoryEntry = Schema.Struct({
  id: Identifier,
  action: Schema.Literals(["dismiss_reminder", "record_outcome"]),
  reference: Schema.NullOr(Schema.String),
  outcomeKind: Schema.NullOr(Schema.Literals(["prepared", "submitted", "accepted"])),
  actorId: Identifier,
  recordedAt: Schema.String,
});
export const Deadline = Schema.Struct({
  book_id: Identifier, id: Identifier, title: Schema.String,
  period_id: Identifier, responsible_actor_id: Identifier,
  due_at: Schema.String, time_zone: Schema.String,
  source_reference: Schema.String, source_revision: Schema.String,
  override_reason: Schema.NullOr(Schema.String),
  outcome_kind: Schema.Literals(["prepared", "submitted", "accepted"]),
  outcome_reference: Schema.NullOr(Schema.String), outcome_at: Schema.NullOr(Schema.String),
  reminder_dismissed_at: Schema.NullOr(Schema.String),
  current_outcome: Schema.NullOr(DeadlineCurrentOutcome),
  activity_history: Schema.Array(DeadlineActivityHistoryEntry),
  revision: Schema.Int, updated_at: Schema.String,
  status: Schema.optional(Schema.Literals(["upcoming", "overdue", "prepared", "submitted", "accepted"])),
});
export const DeadlineList = Schema.Array(Deadline);
export const FeedEvents = Schema.Struct({ bookId: Identifier, events: Schema.Array(Schema.Struct({
  id: Identifier, title: Schema.String, dueAt: Schema.String,
  updatedAt: Schema.String, timeZone: Schema.String,
})) });

export const DeadlineFeed = Schema.Struct({ id: Identifier, secret: Schema.String });
export const RevokedDeadlineFeed = Schema.Struct({ id: Identifier, revoked: Schema.Literal(true) });
const base = "/v1/entities/:entityId/books/:bookId/deadlines";
export const DeadlinesApi = HttpApiGroup.make("deadlines")
  .add(HttpApiEndpoint.get("listDeadlines", base, { params: Scope, success: DeadlineList, error: accountingErrors }))
  .add(HttpApiEndpoint.post("saveDeadline", `${base}/:id`, { params: ChangePath, headers: IdempotencyHeaders, payload: Schema.Struct({ expectedRevision: Schema.NullOr(Schema.Int), input: DeadlineInput }), success: Deadline, error: accountingErrors }))
  .add(HttpApiEndpoint.post("deadlineActivity", `${base}/:id/activity`, { params: ChangePath, headers: IdempotencyHeaders, payload: Schema.Struct({ action: DeadlineActivity.fields.action, reference: DeadlineActivity.fields.reference }), success: Deadline, error: accountingErrors }))
  .add(HttpApiEndpoint.post("createDeadlineFeed", `${base}/feeds/:id`, { params: ChangePath, success: DeadlineFeed, error: accountingErrors }))
  .add(HttpApiEndpoint.post("revokeDeadlineFeed", `${base}/feeds/:id/revoke`, { params: ChangePath, headers: IdempotencyHeaders, success: RevokedDeadlineFeed, error: accountingErrors }));
