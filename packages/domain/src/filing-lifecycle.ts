import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";

// Pure statutory filing lifecycle. NEXT-48 leaf: submission preparation
// with governance gates, admission with replay-first ordering, the provider
// state machine with honest unknown handling, and rejection/correction
// linkage.
//
// An upload response is never fulfillment. Copy upload, original
// signature and authority certification are separate recorded events, and
// a signed original and an iXBRL copy need an explicit validated
// equivalence relationship, not byte identity. The exact provider field
// mapping comes from the selected service specification at the adapter;
// unsupported raw statuses land in `needs_review`, never in assumed
// success. Provider calls, credentials and persistence stay with the
// external-delivery owners.

export const FilingFailureCode = Schema.Literals([
  "IncompleteReport",
  "MissingSignatures",
  "MissingAdoptionFacts",
  "CopyMismatch",
  "EntityMismatch",
  "ActiveSubmissionConflict",
  "IneligibleCertifier",
  "MissingHumanAuthorization",
  "UnresolvedPriorAttempt",
  "StaleIntent",
  "IllegalTransition",
  "ReceiptMismatch",
  "CorrectionAfterAcceptance",
]);

export type FilingFailureCode = typeof FilingFailureCode.Type;

export const FilingFailure = Schema.Struct({
  code: FilingFailureCode,
  message: Description,
});

export type FilingFailure = typeof FilingFailure.Type;

export type Checked<A> = Result.Result<A, FilingFailure>;

function fail(code: FilingFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const SubmissionState = Schema.Literals([
  "prepared",
  "validation_blocked",
  "authorized",
  "upload_admitted",
  "upload_outcome_unknown",
  "copy_uploaded",
  "awaiting_authority_certification",
  "submitted_pending",
  "received",
  "rejected",
  "outcome_unknown",
  "registered_if_required",
  "correction_requested",
  "needs_review",
]);

export type SubmissionState = typeof SubmissionState.Type;

export const SubmissionPrepareInput = Schema.Struct({
  obligationId: Identifier,
  entityId: Identifier,
  fiscalYearId: Identifier,
  reportComplete: Schema.Boolean,
  originalSignaturesValid: Schema.Boolean,
  adoptionFactsPresent: Schema.Boolean,
  copyEquivalent: Schema.Boolean,
  activeSubmissionStates: Schema.Array(SubmissionState),
  certifierEligible: Schema.Boolean,
  humanAuthorized: Schema.Boolean,
  reportRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  copyArtifactHash: Digest,
  providerProfileVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  environment: Schema.Literals(["test", "production"]),
  predecessorIntentId: Schema.NullOr(Identifier),
});

export type SubmissionPrepareInput = typeof SubmissionPrepareInput.Type;

export const SubmissionIntent = Schema.Struct({
  intentId: Identifier,
  obligationId: Identifier,
  reportRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  copyArtifactHash: Digest,
  state: Schema.Literal("prepared"),
});

export type SubmissionIntent = typeof SubmissionIntent.Type;

// Preparation freezes the artifact, signer/certifier, service version and
// deadline relationships behind every governance gate. A deadline reminder
// is not dismissed by a mere upload later; that honesty starts here.
export function prepareSubmission(
  intentId: string,
  input: SubmissionPrepareInput,
): Checked<SubmissionIntent> {
  if (!input.reportComplete) {
    return fail("IncompleteReport", "The report is not complete under its qualified profile.");
  }

  if (!input.originalSignaturesValid) {
    return fail("MissingSignatures", "Required original-signature evidence is missing.");
  }

  if (!input.adoptionFactsPresent) {
    return fail("MissingAdoptionFacts", "Actual meeting and adoption facts are required.");
  }

  if (!input.copyEquivalent) {
    return fail(
      "CopyMismatch",
      "The copy must faithfully represent the signed original under the copy policy.",
    );
  }

  if (
    input.activeSubmissionStates.some(
      (state) => state !== "rejected" && state !== "correction_requested",
    )
  ) {
    return fail(
      "ActiveSubmissionConflict",
      "An incompatible active or accepted submission exists for this obligation.",
    );
  }

  if (!input.certifierEligible) {
    return fail(
      "IneligibleCertifier",
      "The intended certifier is not eligible; administration alone never qualifies.",
    );
  }

  if (!input.humanAuthorized) {
    return fail("MissingHumanAuthorization", "External submission needs human authorization.");
  }

  return Result.succeed({
    intentId,
    obligationId: input.obligationId,
    reportRevision: input.reportRevision,
    copyArtifactHash: input.copyArtifactHash,
    state: "prepared",
  });
}

export const SubmissionAttempt = Schema.Struct({
  attemptId: Identifier,
  intentId: Identifier,
  providerCorrelation: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  requestHash: Digest,
});

export type SubmissionAttempt = typeof SubmissionAttempt.Type;

export const AdmitInput = Schema.Struct({
  intent: SubmissionIntent,
  intentVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  currentIntentVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  priorAttempts: Schema.Array(SubmissionAttempt),
  priorUnresolved: Schema.Boolean,
  providerSafeContinuation: Schema.Boolean,
  attemptId: Identifier,
  requestHash: Digest,
});

export type AdmitInput = typeof AdmitInput.Type;

// Admission replays an exact successful admission before any new-work
// check, refuses an unresolved prior attempt without a provider-safe
// continuation, and otherwise opens one attempt with stable correlation.
export function admitSubmission(input: AdmitInput): Checked<SubmissionAttempt> {
  const replayed = input.priorAttempts.find((attempt) => attempt.intentId === input.intent.intentId);

  if (replayed !== undefined) {
    return Result.succeed(replayed);
  }

  if (input.intentVersion !== input.currentIntentVersion) {
    return fail("StaleIntent", "The intent moved after this admission was prepared.");
  }

  if (input.priorUnresolved && !input.providerSafeContinuation) {
    return fail(
      "UnresolvedPriorAttempt",
      "An unresolved prior attempt blocks admission without provider-safe continuation.",
    );
  }

  return Result.succeed({
    attemptId: input.attemptId,
    intentId: input.intent.intentId,
    providerCorrelation: `${input.intent.intentId}:${input.attemptId}`,
    requestHash: input.requestHash,
  });
}

export const NormalizedObservation = Schema.Literals([
  "local_invalid",
  "local_authorized",
  "upload_accepted",
  "upload_unknown",
  "copy_reference",
  "certification_awaiting",
  "submitted",
  "provider_received",
  "provider_rejected",
  "provider_unknown",
  "provider_registered",
  "correction_demanded",
  "unmapped_status",
]);

export type NormalizedObservation = typeof NormalizedObservation.Type;

// One honest step of the provider state machine. Missing observations
// stay unknown; only a receipt that actually means registration under the
// selected obligation policy reaches `registered_if_required`.
type TransitionTable = {
  readonly [state in SubmissionState]?: {
    readonly [observation in NormalizedObservation]?: SubmissionState;
  };
};

const allowedTransitions: TransitionTable = {
  prepared: { local_invalid: "validation_blocked", local_authorized: "authorized" },
  validation_blocked: { local_authorized: "authorized" },
  authorized: { upload_accepted: "upload_admitted" },
  upload_admitted: { upload_unknown: "upload_outcome_unknown", copy_reference: "copy_uploaded" },
  upload_outcome_unknown: {
    copy_reference: "copy_uploaded",
    upload_unknown: "upload_outcome_unknown",
  },
  copy_uploaded: { certification_awaiting: "awaiting_authority_certification" },
  awaiting_authority_certification: { submitted: "submitted_pending" },
  submitted_pending: {
    provider_received: "received",
    provider_rejected: "rejected",
    provider_unknown: "outcome_unknown",
  },
  outcome_unknown: {
    provider_received: "received",
    provider_rejected: "rejected",
    provider_registered: "registered_if_required",
    provider_unknown: "outcome_unknown",
  },
  received: {
    provider_registered: "registered_if_required",
    correction_demanded: "correction_requested",
  },
  rejected: { correction_demanded: "correction_requested" },
};

export function advanceSubmissionState(
  current: SubmissionState,
  observation: NormalizedObservation,
): Checked<SubmissionState> {
  const next = allowedTransitions[current]?.[observation];

  if (next !== undefined) {
    return Result.succeed(next);
  }

  if (observation === "unmapped_status") {
    return Result.succeed("needs_review");
  }

  return fail(
    "IllegalTransition",
    `Observation ${observation} is not allowed from ${current}.`,
  );
}

export const AuthorityReceipt = Schema.Struct({
  entityId: Identifier,
  fiscalYearId: Identifier,
  artifactHash: Digest,
  meansRegistered: Schema.Boolean,
});

export type AuthorityReceipt = typeof AuthorityReceipt.Type;

// Linking a receipt checks entity, year and artifact identity. A receipt
// for another entity or year is rejected with its raw evidence
// quarantined, never force-linked.
export function linkAuthorityReceipt(
  intent: SubmissionIntent,
  obligationEntityId: string,
  obligationFiscalYearId: string,
  receipt: AuthorityReceipt,
  registrationRequired: boolean,
): Checked<{ readonly state: SubmissionState; readonly quarantined: boolean }> {
  if (
    receipt.entityId !== obligationEntityId ||
    receipt.fiscalYearId !== obligationFiscalYearId ||
    receipt.artifactHash !== intent.copyArtifactHash
  ) {
    return Result.succeed({ state: "needs_review", quarantined: true });
  }

  if (registrationRequired && !receipt.meansRegistered) {
    return Result.succeed({ state: "received", quarantined: false });
  }

  return Result.succeed({
    state: registrationRequired ? "registered_if_required" : "received",
    quarantined: false,
  });
}

export const CorrectionLinkInput = Schema.Struct({
  rejectedIntentId: Identifier,
  rejectedState: SubmissionState,
  newReportRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  newIntentId: Identifier,
  acceptedBefore: Schema.Boolean,
});

export type CorrectionLinkInput = typeof CorrectionLinkInput.Type;

// A rejection opens a case for a new linked revision; the old bytes stay
// retained. After acceptance, only an explicitly supported authority
// procedure replaces anything, never a blind repeated upload.
export function linkCorrection(
  input: CorrectionLinkInput,
): Checked<{ readonly newIntentId: string; readonly predecessorIntentId: string }> {
  if (input.rejectedState !== "rejected" && input.rejectedState !== "correction_requested") {
    return fail("IllegalTransition", "Only a rejected submission links a correction.");
  }

  if (input.acceptedBefore) {
    return fail(
      "CorrectionAfterAcceptance",
      "Post-acceptance replacement needs an explicitly supported authority procedure.",
    );
  }

  return Result.succeed({
    newIntentId: input.newIntentId,
    predecessorIntentId: input.rejectedIntentId,
  });
}
