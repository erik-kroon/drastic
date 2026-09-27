import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure instruction-resolution math for one payment instruction.
// NEXT-08 leaf: proof-qualified release of reserved instruction capacity and
// successor eligibility. No journal, no supplier credit, no second payment.
// Every position input (original amount, accounted executions, prior releases,
// executed-but-unaccounted amounts) arrives as a reviewed exact amount; the
// application owns reading them from instruction, outcome and reservation
// history. A bound failure is an error rather than a partial release.

export const ResolutionFailureCode = Schema.Literals([
  "InsufficientExternalProof",
  "OutcomeUnknown",
  "ProofScopeMismatch",
  "ChannelNotControlled",
  "ExposureDetected",
  "DispatchFenceOpen",
  "RevocationMissing",
  "HistoryUnreconciled",
  "ResubmissionPossible",
  "NonPositiveRelease",
  "ReleaseExceedsReservation",
  "ExecutedAmountNotExcluded",
  "StaleResolutionBasis",
  "IdempotencyConflict",
  "AlreadyReleased",
  "ReplacementWithoutRelease",
  "ReplacementIdentityReused",
  "BeneficiaryRevisionStale",
]);

export type ResolutionFailureCode = typeof ResolutionFailureCode.Type;

export const ResolutionFailure = Schema.Struct({
  code: ResolutionFailureCode,
  message: Description,
});

export type ResolutionFailure = typeof ResolutionFailure.Type;

export type Checked<A> = Result.Result<A, ResolutionFailure>;

function fail(code: ResolutionFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const ExportHash = Digest;

export const EndToEndId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const BeneficiaryRevision = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(127),
);

export const InvoiceAllocationIntent = Schema.Struct({
  invoiceId: Identifier,
  amountMinor: MinorUnits,
});

export type InvoiceAllocationIntent = typeof InvoiceAllocationIntent.Type;

// Immutable instruction as retained by the payment-batch/export owner.
export const PaymentInstruction = Schema.Struct({
  id: Identifier,
  batchId: Identifier,
  exportHash: ExportHash,
  endToEndId: EndToEndId,
  beneficiaryRevision: BeneficiaryRevision,
  originalAmountMinor: MinorUnits,
  currency: CurrencyCode,
  invoiceAllocationIntents: Schema.Array(InvoiceAllocationIntent),
  disclosedOrDownloaded: Schema.Boolean,
});

export type PaymentInstruction = typeof PaymentInstruction.Type;

export const OutcomeSourceKind = Schema.Literals([
  "provider_response",
  "channel_control_record",
  "operator_report",
  "bank_observation",
]);

export type OutcomeSourceKind = typeof OutcomeSourceKind.Type;

export const ExternalStatus = Schema.Literals([
  "accepted",
  "settled",
  "cancelled",
  "rejected",
  "unknown",
]);

export type ExternalStatus = typeof ExternalStatus.Type;

export const OutcomeObservation = Schema.Struct({
  instructionId: Identifier,
  sourceEvidence: Identifier,
  sourceKind: OutcomeSourceKind,
  authenticatedProviderIdentity: Schema.NullOr(Identifier),
  externalStatus: ExternalStatus,
  observedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  amountScopeMinor: Schema.NullOr(MinorUnits),
});

export type OutcomeObservation = typeof OutcomeObservation.Type;

// The three proof branches from the packet. Each requirement is a retained
// fact the application reads; the leaf refuses when it is not satisfied.
export const NoExecutionEvidence = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("operator_reported_rejection"),
    reportRef: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("controlled_never_dispatched"),
    channelControlledExclusively: Schema.Boolean,
    noBytesExposed: Schema.Boolean,
    dispatchFenceVersion: Identifier,
    noAdmittedInflightRequest: Schema.Boolean,
    revocationId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("qualified_provider_final_cancellation"),
    responseRef: Identifier,
    providerContractVersion: Identifier,
    identifiesExactInstructionExport: Schema.Boolean,
    contractEstablishesNoExecution: Schema.Boolean,
    acceptedSettledHistoryReconciled: Schema.Boolean,
    oldIdentityCannotLaterExecute: Schema.Boolean,
  }),
]);

export type NoExecutionEvidence = typeof NoExecutionEvidence.Type;

export const ProvenNoExecution = Schema.Struct({
  provenAmountMinor: MinorUnits,
  finalityScope: Schema.Literals(["undispatched", "finally_cancelled"]),
});

export type ProvenNoExecution = typeof ProvenNoExecution.Type;

export const ProofEvaluationInput = Schema.Struct({
  instruction: PaymentInstruction,
  evidence: NoExecutionEvidence,
});

export type ProofEvaluationInput = typeof ProofEvaluationInput.Type;

// Proof evaluation returns the exact amount proven not executed. An ordinary
// downloaded manual file never satisfies the controlled branch: the caller
// must evidence exclusivity, non-exposure, fence and revocation explicitly.
export function evaluateNoExecutionProof(input: ProofEvaluationInput): Checked<ProvenNoExecution> {
  const original = BigInt(input.instruction.originalAmountMinor);
  const evidence = input.evidence;

  if (evidence.kind === "operator_reported_rejection") {
    return fail(
      "InsufficientExternalProof",
      "An operator-reported rejection is not external no-execution proof.",
    );
  }

  if (evidence.kind === "controlled_never_dispatched") {
    if (!evidence.channelControlledExclusively) {
      return fail(
        "ChannelNotControlled",
        "The dispatch channel is not controlled exclusively by this system.",
      );
    }

    if (!evidence.noBytesExposed) {
      return fail("ExposureDetected", "Export bytes were exposed outside the controlled channel.");
    }

    if (!evidence.noAdmittedInflightRequest) {
      return fail(
        "DispatchFenceOpen",
        "The dispatch fence does not prove the absence of an admitted provider request.",
      );
    }

    return Result.succeed({
      provenAmountMinor: amount(original),
      finalityScope: "undispatched",
    });
  }

  if (!evidence.identifiesExactInstructionExport) {
    return fail(
      "ProofScopeMismatch",
      "The provider response does not identify this exact instruction and export.",
    );
  }

  if (!evidence.contractEstablishesNoExecution) {
    return fail(
      "OutcomeUnknown",
      "The provider contract does not establish no execution for the stated amount.",
    );
  }

  if (!evidence.acceptedSettledHistoryReconciled) {
    return fail(
      "HistoryUnreconciled",
      "Known accepted and settled history does not reconcile with the cancellation.",
    );
  }

  if (!evidence.oldIdentityCannotLaterExecute) {
    return fail(
      "ResubmissionPossible",
      "The old instruction identity can still execute under the provider contract.",
    );
  }

  return Result.succeed({
    provenAmountMinor: amount(original),
    finalityScope: "finally_cancelled",
  });
}

// Capacity inputs. Prior releases and accounted executions are cumulative
// reviewed totals; executed-but-unaccounted amounts stay reserved until the
// payment is accounted for or separately resolved.
export const ResolutionCapacityInput = Schema.Struct({
  originalAmountMinor: MinorUnits,
  alreadyAccountedExecutedMinor: MinorUnits,
  effectiveNoExecutionReleasesMinor: MinorUnits,
  executedButUnaccountedMinor: MinorUnits,
  provenAmountMinor: MinorUnits,
  outcomeInventoryVersion: Identifier,
  reservationVersion: Identifier,
  invoiceCapacities: Schema.Array(InvoiceAllocationIntent),
  proofDigest: Digest,
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type ResolutionCapacityInput = typeof ResolutionCapacityInput.Type;

export const ResolutionPlan = Schema.Struct({
  instructionId: Identifier,
  proofDigest: Digest,
  releasedAmountMinor: MinorUnits,
  outcomeInventoryVersion: Identifier,
  reservationVersion: Identifier,
  invoiceCapacities: Schema.Array(InvoiceAllocationIntent),
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});

export type ResolutionPlan = typeof ResolutionPlan.Type;

export const PrepareResolutionInput = Schema.Struct({
  instruction: PaymentInstruction,
  capacity: ResolutionCapacityInput,
});

export type PrepareResolutionInput = typeof PrepareResolutionInput.Type;

// A release frees instruction capacity only. It posts no journal and changes
// no payable allocation; the application performs the fenced release,
// successor-eligibility invalidation and receipt in one non-journal tx.
export function prepareResolution(input: PrepareResolutionInput): Checked<ResolutionPlan> {
  const original = BigInt(input.instruction.originalAmountMinor);
  const accounted = BigInt(input.capacity.alreadyAccountedExecutedMinor);
  const priorReleases = BigInt(input.capacity.effectiveNoExecutionReleasesMinor);
  const unaccounted = BigInt(input.capacity.executedButUnaccountedMinor);
  const proven = BigInt(input.capacity.provenAmountMinor);

  if (proven <= 0n) {
    return fail("NonPositiveRelease", "A resolution needs a positive proven no-execution amount.");
  }

  if (accounted < 0n || accounted > original) {
    return fail(
      "ExecutedAmountNotExcluded",
      "Accounted executions must stay within the original instruction amount.",
    );
  }

  if (unaccounted < 0n || unaccounted > original) {
    return fail(
      "ExecutedAmountNotExcluded",
      "Executed-but-unaccounted amounts must stay within the original amount.",
    );
  }

  if (priorReleases < 0n || priorReleases > original) {
    return fail(
      "ReleaseExceedsReservation",
      "Prior releases must stay within the original instruction amount.",
    );
  }

  const available = original - accounted - priorReleases - unaccounted;

  if (proven > available) {
    return fail(
      "ReleaseExceedsReservation",
      "The proven amount exceeds the available instruction reservation.",
    );
  }

  return Result.succeed({
    instructionId: input.instruction.id,
    proofDigest: input.capacity.proofDigest,
    releasedAmountMinor: amount(proven),
    outcomeInventoryVersion: input.capacity.outcomeInventoryVersion,
    reservationVersion: input.capacity.reservationVersion,
    invoiceCapacities: input.capacity.invoiceCapacities,
    commandKey: input.capacity.commandKey,
  });
}

export const ResolutionBasis = Schema.Struct({
  alreadyAccountedExecutedMinor: MinorUnits,
  executedButUnaccountedMinor: MinorUnits,
  effectiveNoExecutionReleasesMinor: MinorUnits,
  outcomeInventoryVersion: Identifier,
  reservationVersion: Identifier,
});

export type ResolutionBasis = typeof ResolutionBasis.Type;

// Execution re-checks the sealed basis inside the owning transaction. A
// payment accounted while review was open shrinks the reservation and makes
// the plan stale instead of releasing twice.
export function assertResolutionCurrent(
  plan: ResolutionPlan,
  current: ResolutionBasis,
): Checked<ResolutionPlan> {
  if (
    current.outcomeInventoryVersion !== plan.outcomeInventoryVersion ||
    current.reservationVersion !== plan.reservationVersion
  ) {
    return fail(
      "StaleResolutionBasis",
      "The outcome or reservation version moved since the resolution was prepared.",
    );
  }

  return Result.succeed(plan);
}

export const SameKeyReplayInput = Schema.Struct({
  existingCommandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  existingProofDigest: Digest,
  proofDigest: Digest,
  existingPlan: ResolutionPlan,
});

export type SameKeyReplayInput = typeof SameKeyReplayInput.Type;

// Same key and digest replays the saved resolution. A different digest under
// the same key conflicts; a different key over the same proof is a duplicate
// economic effect and refuses.
export function replaySameKeyResolution(input: SameKeyReplayInput): Checked<ResolutionPlan> {
  if (input.commandKey !== input.existingCommandKey) {
    return fail(
      "AlreadyReleased",
      "A different key cannot release capacity the saved resolution already released.",
    );
  }

  if (input.proofDigest !== input.existingProofDigest) {
    return fail("IdempotencyConflict", "The same command key carries a different proof digest.");
  }

  return Result.succeed(input.existingPlan);
}

export const ReplacementInput = Schema.Struct({
  resolution: ResolutionPlan,
  releasedEffectiveMinor: MinorUnits,
  liveOutstandingMinor: MinorUnits,
  otherReservationsMinor: MinorUnits,
  predecessorId: Identifier,
  newInstructionId: Identifier,
  currentBeneficiaryRevision: BeneficiaryRevision,
  reviewedBeneficiaryRevision: BeneficiaryRevision,
  approvedNewDigest: Digest,
});

export type ReplacementInput = typeof ReplacementInput.Type;

export const ReplacementPlan = Schema.Struct({
  newInstructionId: Identifier,
  predecessorId: Identifier,
  resolutionId: Identifier,
  approvedNewDigest: Digest,
  compiledAmountMinor: MinorUnits,
  beneficiaryRevision: BeneficiaryRevision,
});

export type ReplacementPlan = typeof ReplacementPlan.Type;

// A replacement compiles a new immutable instruction from current approved
// amounts. It never edits the old export bytes and needs a fresh approval,
// which the application owns.
export function prepareReplacement(input: ReplacementInput): Checked<ReplacementPlan> {
  const released = BigInt(input.resolution.releasedAmountMinor);
  const effective = BigInt(input.releasedEffectiveMinor);
  const outstanding = BigInt(input.liveOutstandingMinor);
  const reserved = BigInt(input.otherReservationsMinor);

  if (effective !== released || released <= 0n) {
    return fail(
      "ReplacementWithoutRelease",
      "A replacement needs a resolution that effectively released exactly this capacity.",
    );
  }

  if (input.newInstructionId === input.predecessorId) {
    return fail(
      "ReplacementIdentityReused",
      "A replacement needs a new immutable instruction identity.",
    );
  }

  if (input.currentBeneficiaryRevision !== input.reviewedBeneficiaryRevision) {
    return fail(
      "BeneficiaryRevisionStale",
      "The beneficiary revision moved since independent verification.",
    );
  }

  const capacity = outstanding - reserved;

  if (released > capacity) {
    return fail(
      "ReplacementWithoutRelease",
      "Live outstanding no longer covers the released capacity.",
    );
  }

  return Result.succeed({
    newInstructionId: input.newInstructionId,
    predecessorId: input.predecessorId,
    resolutionId: input.resolution.instructionId,
    approvedNewDigest: input.approvedNewDigest,
    compiledAmountMinor: amount(released),
    beneficiaryRevision: input.reviewedBeneficiaryRevision,
  });
}

export const LateExecutionObservation = Schema.Struct({
  resolution: ResolutionPlan,
  observedDebitMinor: MinorUnits,
  successorDispatched: Schema.Boolean,
});

export type LateExecutionObservation = typeof LateExecutionObservation.Type;

export const DuplicateExecutionCase = Schema.Struct({
  priority: Schema.Literal("high"),
  action: Schema.Literals(["stop_undispatched_successor", "keep_both_observed"]),
  conflictMinor: MinorUnits,
  caseKind: Schema.Literal("duplicate_execution"),
});

export type DuplicateExecutionCase = typeof DuplicateExecutionCase.Type;

// A late debit against released capacity is retained as a high-priority
// duplicate-execution case. Both outcomes stay observed precisely; the leaf
// never allocates two payments to one invoice silently.
export function observeLateExecution(
  input: LateExecutionObservation,
): Checked<DuplicateExecutionCase> {
  const debit = BigInt(input.observedDebitMinor);
  const released = BigInt(input.resolution.releasedAmountMinor);

  if (debit <= 0n || released <= 0n) {
    return fail(
      "OutcomeUnknown",
      "A late execution needs a positive observed debit against released capacity.",
    );
  }

  return Result.succeed({
    priority: "high",
    action: input.successorDispatched ? "keep_both_observed" : "stop_undispatched_successor",
    conflictMinor: amount(debit < released ? debit : released),
    caseKind: "duplicate_execution",
  });
}
