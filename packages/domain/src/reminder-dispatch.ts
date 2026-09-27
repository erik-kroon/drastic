import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";
import { CurrencyCode } from "./exchange-rates";

// Pure collection-reminder intent and dispatch race semantics. NEXT-28 leaf:
// exact-message approval, dispatch admission with recovery-first ordering,
// and provider-outcome reduction with honest unknown handling.
//
// One intent is one approved reminder occurrence, not every queue retry. No
// collection fee or interest exists in this profile; a later fee is its own
// evidenced financial operation, never a number inserted into an email.
// SMTP/API acceptance is not evidence the customer read anything. The
// provider call itself, locks and persistence stay with the application and
// delivery owners; this leaf decides what each state transition allows.

export const ReminderFailureCode = Schema.Literals([
  "ZeroCollectible",
  "CurrencyMismatch",
  "DisputeHold",
  "AmbiguousSend",
  "DigestMismatch",
  "StageNotPermitted",
  "ExpiredApproval",
  "StaleBasis",
  "SupersededReminder",
  "CancelledIntent",
  "UnknownOutcomeNeedsInvestigation",
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

function amount(value: bigint) {
  return value.toString();
}

export const ReminderStage = Schema.Literals(["first", "second", "final"]);

export type ReminderStage = typeof ReminderStage.Type;

export const ReminderInvoice = Schema.Struct({
  invoiceId: Identifier,
  residualMinor: MinorUnits,
  currency: CurrencyCode,
});

export type ReminderInvoice = typeof ReminderInvoice.Type;

export const ReminderPrepareInput = Schema.Struct({
  occurrenceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  customerId: Identifier,
  invoices: Schema.Array(ReminderInvoice).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  creditsAppliedMinor: MinorUnits,
  currency: CurrencyCode,
  disputeHold: Schema.Boolean,
  activeOccurrenceIdentities: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  recipientRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  templateRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // Exact content rendered outside financial locks from frozen statement
  // values. A variable template that could pick a different amount or
  // recipient at send time never reaches approval.
  contentDigest: Digest,
  stage: ReminderStage,
  asOf: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  expiresAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
});

export type ReminderPrepareInput = typeof ReminderPrepareInput.Type;

export const ReminderIntent = Schema.Struct({
  occurrenceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  customerId: Identifier,
  invoiceIds: Schema.Array(Identifier),
  residualMinor: MinorUnits,
  currency: CurrencyCode,
  recipientRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  templateRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  contentDigest: Digest,
  stage: ReminderStage,
  asOf: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  expiresAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
});

export type ReminderIntent = typeof ReminderIntent.Type;

// Preparing seals recipient, exact content, residual and stage. A positive
// collectible residual with no dispute hold is required; an ambiguous send
// for the same occurrence refuses instead of queueing a duplicate.
export function prepareReminder(input: ReminderPrepareInput): Checked<ReminderIntent> {
  if (input.disputeHold) {
    return fail("DisputeHold", "A dispute hold blocks reminder preparation.");
  }

  if (input.activeOccurrenceIdentities.includes(input.occurrenceIdentity)) {
    return fail(
      "AmbiguousSend",
      "An active send already exists for this occurrence.",
    );
  }

  let residual = -(BigInt(input.creditsAppliedMinor));

  for (const invoice of input.invoices) {
    if (invoice.currency !== input.currency) {
      return fail("CurrencyMismatch", "One intent covers one currency.");
    }

    residual += BigInt(invoice.residualMinor);
  }

  if (residual <= 0n) {
    return fail("ZeroCollectible", "A reminder needs a positive collectible residual.");
  }

  return Result.succeed({
    occurrenceIdentity: input.occurrenceIdentity,
    customerId: input.customerId,
    invoiceIds: input.invoices.map((invoice) => invoice.invoiceId),
    residualMinor: amount(residual),
    currency: input.currency,
    recipientRevision: input.recipientRevision,
    templateRevision: input.templateRevision,
    contentDigest: input.contentDigest,
    stage: input.stage,
    asOf: input.asOf,
    expiresAt: input.expiresAt,
  });
}

export const ReminderApprovalInput = Schema.Struct({
  intent: ReminderIntent,
  presentedDigest: Digest,
  permittedStages: Schema.Array(ReminderStage),
  permittedRecipients: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  disputedNow: Schema.Boolean,
  settledNow: Schema.Boolean,
  now: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  operatorId: Identifier,
});

export type ReminderApprovalInput = typeof ReminderApprovalInput.Type;

export const ReminderApproval = Schema.Struct({
  intentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  digest: Digest,
  operatorId: Identifier,
});

export type ReminderApproval = typeof ReminderApproval.Type;

// Operator approval validates the exact digest and the permitted
// stage/recipient, then rechecks dispute, settlement and expiry.
export function approveReminder(input: ReminderApprovalInput): Checked<ReminderApproval> {
  if (input.presentedDigest !== input.intent.contentDigest) {
    return fail("DigestMismatch", "Approval needs the exact sealed content digest.");
  }

  if (!input.permittedStages.includes(input.intent.stage)) {
    return fail("StageNotPermitted", "This reminder stage is not permitted.");
  }

  if (!input.permittedRecipients.includes(input.intent.recipientRevision)) {
    return fail("StageNotPermitted", "This recipient revision is not permitted.");
  }

  if (input.disputedNow) {
    return fail("DisputeHold", "A dispute hold blocks approval.");
  }

  if (input.settledNow) {
    return fail("StaleBasis", "The balance settled before approval.");
  }

  if (input.now > input.intent.expiresAt) {
    return fail("ExpiredApproval", "The intent expired before approval.");
  }

  return Result.succeed({
    intentId: input.intent.occurrenceIdentity,
    digest: input.intent.contentDigest,
    operatorId: input.operatorId,
  });
}

export const DispatchAdmitInput = Schema.Struct({
  intent: ReminderIntent,
  approval: ReminderApproval,
  cancelled: Schema.Boolean,
  currentResidualMinor: MinorUnits,
  currentRecipientRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  disputeHold: Schema.Boolean,
  supersedingResolution: Schema.Boolean,
  priorAttemptProviderIdentity: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  attemptSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type DispatchAdmitInput = typeof DispatchAdmitInput.Type;

export const DispatchAdmission = Schema.Struct({
  providerIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  recovered: Schema.Boolean,
});

export type DispatchAdmission = typeof DispatchAdmission.Type;

// Admission recovers an existing attempt or definitive receipt first. If
// payment or a dispute committed before admission, sending refuses as
// stale; if admission wins first, a later payment is recorded separately
// and never rewrites the sent statement.
export function admitDispatch(input: DispatchAdmitInput): Checked<DispatchAdmission> {
  if (input.priorAttemptProviderIdentity !== null) {
    return Result.succeed({
      providerIdentity: input.priorAttemptProviderIdentity,
      recovered: true,
    });
  }

  if (input.cancelled) {
    return fail("CancelledIntent", "A cancelled intent admits no dispatch.");
  }

  if (input.approval.digest !== input.intent.contentDigest) {
    return fail("DigestMismatch", "The approval no longer matches the intent.");
  }

  if (input.disputeHold) {
    return fail("DisputeHold", "A dispute hold blocks dispatch admission.");
  }

  if (input.supersedingResolution) {
    return fail("SupersededReminder", "A superseding resolution replaced this reminder.");
  }

  if (
    BigInt(input.currentResidualMinor) !== BigInt(input.intent.residualMinor) ||
    input.currentRecipientRevision !== input.intent.recipientRevision
  ) {
    return fail(
      "StaleBasis",
      "Collectible amounts or recipient moved after approval; sending refuses.",
    );
  }

  return Result.succeed({
    providerIdentity: `${input.intent.occurrenceIdentity}:attempt:${input.attemptSequence}`,
    recovered: false,
  });
}

export const ProviderOutcome = Schema.Literals(["accepted", "delivered", "failed", "unknown"]);

export type ProviderOutcome = typeof ProviderOutcome.Type;

export const OutcomeReduceInput = Schema.Struct({
  providerIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  outcome: ProviderOutcome,
  readbackSupported: Schema.Boolean,
  idempotencyRetentionValid: Schema.Boolean,
});

export type OutcomeReduceInput = typeof OutcomeReduceInput.Type;

// Reducing a provider outcome. An unknown outcome with no supported
// readback, or with expired idempotency retention, requires investigation:
// never a new send to probe success, and never a retry merely because a
// fresh queue job exists.
export function reduceOutcome(
  input: OutcomeReduceInput,
): Checked<{ readonly state: "delivered" | "failed" | "accepted" | "unknown_pending" }> {
  if (input.outcome === "delivered") return Result.succeed({ state: "delivered" });

  if (input.outcome === "failed") return Result.succeed({ state: "failed" });

  if (input.outcome === "accepted") return Result.succeed({ state: "accepted" });

  if (input.readbackSupported && input.idempotencyRetentionValid) {
    return Result.succeed({ state: "unknown_pending" });
  }

  return fail(
    "UnknownOutcomeNeedsInvestigation",
    "An unknown outcome without readback or retention needs investigation, not another send.",
  );
}

export const LatePaymentNote = Schema.Struct({
  occurrenceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  sentResidualMinor: MinorUnits,
  sentAsOf: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  currentPaidMinor: MinorUnits,
  followUpNotification: Schema.Boolean,
});

export type LatePaymentNote = typeof LatePaymentNote.Type;

// A payment after admission keeps the sent-as-of history and the current
// paid status as two separate facts; a known late payment may raise a
// follow-up notification, never a rewritten statement.
export function noteLatePayment(
  intent: ReminderIntent,
  currentPaidMinor: string,
): LatePaymentNote {
  return {
    occurrenceIdentity: intent.occurrenceIdentity,
    sentResidualMinor: intent.residualMinor,
    sentAsOf: intent.asOf,
    currentPaidMinor,
    followUpNotification: BigInt(currentPaidMinor) > 0n,
  };
}
