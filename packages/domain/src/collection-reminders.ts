import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure collection-reminder math for one customer and cutoff. NEXT-28 leaf:
// exact-message approval, dispatch admission and outcome recovery. The
// existing commerce/collections owner, invoice-delivery/legal-delivery
// adapters and the dispute/statement records stay where they are: this
// leaf creates no statement, no dispute entry and no fee or interest.
// The first profile adds no collection fee or interest at all.
//
// No database and no runtime. Residuals arrive net of the NEXT-15 credit
// and NEXT-30 customer-credit effects the application already resolved;
// recipient revisions, dispute holds and provider observations arrive as
// reviewed inputs. A bound failure is an error, never a second send to
// probe success and never a rewritten statement.

export const ReminderFailureCode = Schema.Literals([
  "NonPositiveResidual",
  "DisputeHold",
  "AmbiguousSend",
  "DigestMismatch",
  "ExpiredApproval",
  "StaleReminderBasis",
  "CancelledIntent",
  "SupersededReminder",
  "UnknownAttemptNeedsInvestigation",
]);

export type ReminderFailureCode = typeof ReminderFailureCode.Type;

export const ReminderFailure = Schema.Struct({
  code: ReminderFailureCode,
  message: Description,
});

export type ReminderFailure = typeof ReminderFailure.Type;

export type Checked<A> = Result.Result<A, ReminderFailure>;

function fail(code: ReminderFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const ReminderStage = Schema.Literals(["first", "follow_up", "final"]);

export type ReminderStage = typeof ReminderStage.Type;

export const AttemptOutcome = Schema.Literals([
  "accepted",
  "delivered",
  "failed",
  "unknown",
]);

export type AttemptOutcome = typeof AttemptOutcome.Type;

// One approved reminder occurrence. One intent is one occurrence, not
// every queue retry: retries recover the same attempt below.
export const ReminderIntent = Schema.Struct({
  intentId: Identifier,
  occurrenceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  invoiceIds: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  customerRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  recipientRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  residualMinor: MinorUnits,
  contentDigest: Digest,
  stage: ReminderStage,
  disputeEpoch: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  expiresAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
});

export type ReminderIntent = typeof ReminderIntent.Type;

export const ReminderApproval = Schema.Struct({
  intentId: Identifier,
  digest: Digest,
  operatorId: Identifier,
  cancelled: Schema.Boolean,
});

export type ReminderApproval = typeof ReminderApproval.Type;

export const DispatchAttempt = Schema.Struct({
  attemptId: Identifier,
  intentId: Identifier,
  externalKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  payloadHash: Digest,
  sentAsOfMinor: MinorUnits,
  sentAsOfRevision: ReminderIntent.fields.recipientRevision,
});

export type DispatchAttempt = typeof DispatchAttempt.Type;

export const DispatchBasis = Schema.Struct({
  residualMinor: MinorUnits,
  recipientRevision: ReminderIntent.fields.recipientRevision,
  disputeEpoch: ReminderIntent.fields.disputeEpoch,
  disputeHold: Schema.Boolean,
  superseded: Schema.Boolean,
});

export type DispatchBasis = typeof DispatchBasis.Type;

// Sealing validates the reminder can exist: a positive collectible
// residual, no dispute hold and no active ambiguous send for the same
// occurrence. Rendering happens outside financial locks on frozen values.
export function sealReminderIntent(
  intent: ReminderIntent,
  disputeHold: boolean,
  ambiguousSendActive: boolean,
): Checked<ReminderIntent> {
  if (BigInt(intent.residualMinor) <= 0n) {
    return fail(
      "NonPositiveResidual",
      "A reminder needs a positive collectible residual at the cutoff.",
    );
  }

  if (disputeHold) {
    return fail("DisputeHold", "A dispute hold blocks the reminder before admission.");
  }

  if (ambiguousSendActive) {
    return fail(
      "AmbiguousSend",
      "An active ambiguous send for the same occurrence blocks a new reminder.",
    );
  }

  return Result.succeed(intent);
}

// Approval covers the exact sealed bytes: a variable template that would
// pick a different amount or recipient at send time is never approved.
export function approveReminder(
  intent: ReminderIntent,
  approval: ReminderApproval,
  nowIso: string,
): Checked<ReminderApproval> {
  if (approval.digest !== intent.contentDigest) {
    return fail(
      "DigestMismatch",
      "The approval must cover the exact sealed reminder digest.",
    );
  }

  if (nowIso > intent.expiresAt) {
    return fail("ExpiredApproval", "An expired reminder needs another exact preview.");
  }

  return Result.succeed(approval);
}

// Admission recovers first: an existing attempt or definitive receipt for
// the intent returns as-is, so a retried queue job makes one external
// attempt, never two. If payment or a dispute committed before admission,
// sending is refused as stale. A known late payment afterwards creates a
// follow-up notification; it never rewrites the sent statement.
export function admitReminderDispatch(
  intent: ReminderIntent,
  approval: ReminderApproval,
  current: DispatchBasis,
  knownAttempt: DispatchAttempt | null,
): Checked<DispatchAttempt> {
  if (knownAttempt !== null) {
    return Result.succeed(knownAttempt);
  }

  if (approval.cancelled) {
    return fail("CancelledIntent", "A cancelled intent admits no dispatch.");
  }

  if (current.superseded) {
    return fail(
      "SupersededReminder",
      "A superseding reminder resolution blocks this admission.",
    );
  }

  if (current.disputeHold) {
    return fail("DisputeHold", "A dispute hold added before admission refuses the send.");
  }

  if (
    BigInt(current.residualMinor) !== BigInt(intent.residualMinor) ||
    current.recipientRevision !== intent.recipientRevision ||
    current.disputeEpoch !== intent.disputeEpoch
  ) {
    return fail(
      "StaleReminderBasis",
      "The collectible amount or recipient moved after approval; no provider call is made.",
    );
  }

  return Result.succeed({
    attemptId: `att-${intent.intentId}`,
    intentId: intent.intentId,
    externalKey: `ext-${intent.occurrenceIdentity}`,
    payloadHash: intent.contentDigest,
    sentAsOfMinor: intent.residualMinor,
    sentAsOfRevision: intent.recipientRevision,
  });
}

export const ObservationInput = Schema.Struct({
  attempt: DispatchAttempt,
  outcome: AttemptOutcome,
  retrySupported: Schema.Boolean,
  channelRetentionExpired: Schema.Boolean,
});

export type ObservationInput = typeof ObservationInput.Type;

// An accepted attempt whose response was lost recovers the SAME external
// identity; it never creates a new send to probe success. Queue claim
// expiry proves nothing about delivery, and once the channel's
// idempotency retention expires even a retry needs investigation.
export function recoverAttempt(
  input: ObservationInput,
): Checked<{ readonly externalKey: string; readonly outcome: AttemptOutcome }> {
  if (input.outcome !== "unknown") {
    return Result.succeed({ externalKey: input.attempt.externalKey, outcome: input.outcome });
  }

  if (!input.retrySupported || input.channelRetentionExpired) {
    return fail(
      "UnknownAttemptNeedsInvestigation",
      "An ancient unknown attempt cannot be retried on a fresh queue job; investigate instead.",
    );
  }

  return Result.succeed({ externalKey: input.attempt.externalKey, outcome: "unknown" });
}
