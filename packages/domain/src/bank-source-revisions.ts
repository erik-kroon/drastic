import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure provider-revision math for one bank observation identity.
// NEXT-10 leaf: exact revision mapping and same/different economic-event
// decisions over published NEXT-09 generations. No posting, no matching,
// no automatic deletion: source admission and provenance commit together
// in the application, and a removed booked observation becomes an
// investigation case. Descriptions and enrichment stay source assertions.

export const RevisionFailureCode = Schema.Literals([
  "UnpublishedGeneration",
  "AccountFilterMismatch",
  "UnknownChangeKind",
  "UnsupportedCurrency",
  "InvalidAmountLexeme",
  "FractionalMinorUnits",
  "AmbiguousRevisionOrder",
  "StaleRevisionBasis",
  "MaterialConflictUnresolved",
  "OverlapNeedsDecision",
  "PredecessorAlreadyAccepted",
  "AdmissionSemanticsMismatch",
  "IdempotencyConflict",
  "AlreadyAdmitted",
]);

export type RevisionFailureCode = typeof RevisionFailureCode.Type;

export const RevisionFailure = Schema.Struct({
  code: RevisionFailureCode,
  message: Description,
});

export type RevisionFailure = typeof RevisionFailure.Type;

export type Checked<A> = Result.Result<A, RevisionFailure>;

function fail(code: RevisionFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const ProviderChangeKind = Schema.Literals(["added", "modified", "removed"]);

export type ProviderChangeKind = typeof ProviderChangeKind.Type;

export const ProviderIdentity = Schema.Struct({
  bookId: Identifier,
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  streamId: Identifier,
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

export type ProviderIdentity = typeof ProviderIdentity.Type;

export const NormalizedFacts = Schema.Struct({
  cashMovementMinor: MinorUnits,
  currency: CurrencyCode,
  bookingDate: AccountingDate,
  authorizationDate: Schema.NullOr(AccountingDate),
  pending: Schema.Boolean,
  pendingReference: Schema.NullOr(Identifier),
});

export type NormalizedFacts = typeof NormalizedFacts.Type;

export const SourceRevision = Schema.Struct({
  identity: ProviderIdentity,
  publicationVersion: MinorUnits,
  changeKind: ProviderChangeKind,
  rawLocator: Identifier,
  rawDigest: Digest,
  normalizedFacts: Schema.NullOr(NormalizedFacts),
  parserVersion: Identifier,
});

export type SourceRevision = typeof SourceRevision.Type;

export const InterpretInput = Schema.Struct({
  publicationMarkerPresent: Schema.Boolean,
  accountMatchesFilter: Schema.Boolean,
  changeKind: ProviderChangeKind,
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  amountLexeme: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  currency: CurrencyCode,
  currencySupported: Schema.Boolean,
  currencyScale: MinorUnits,
  bookingDate: AccountingDate,
  authorizationDate: Schema.NullOr(AccountingDate),
  pending: Schema.Boolean,
  pendingReference: Schema.NullOr(Identifier),
  rawLocator: Identifier,
  rawDigest: Digest,
  parserVersion: Identifier,
  identity: ProviderIdentity,
  publicationVersion: MinorUnits,
});

export type InterpretInput = typeof InterpretInput.Type;

function parseAmountLexeme(lexeme: string): Checked<{ units: bigint; fractionDigits: number }> {
  const match = /^(-)?([0-9]+)(?:\.([0-9]+))?$/.exec(lexeme);

  if (match === null || match[2] === undefined) {
    return fail("InvalidAmountLexeme", "The provider amount is not an exact decimal lexeme.");
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";

  return Result.succeed({
    units: sign * BigInt(match[2] + fraction),
    fractionDigits: fraction.length,
  });
}

// Exact interpretation of one provider change. Only published generations
// are interpreted; the Transactions API positive means money leaving the
// account, so admission stores the flipped cash movement. A removal needs
// no amount; anything else does.
export function interpretProviderChange(input: InterpretInput): Checked<SourceRevision> {
  if (!input.publicationMarkerPresent) {
    return fail(
      "UnpublishedGeneration",
      "Raw provider delivery is not a reviewed bank observation.",
    );
  }

  if (!input.accountMatchesFilter) {
    return fail(
      "AccountFilterMismatch",
      "The change account does not match the configured account filter.",
    );
  }

  if (!input.currencySupported) {
    return fail("UnsupportedCurrency", "The change currency has no qualified metadata.");
  }

  if (input.changeKind === "removed") {
    return Result.succeed({
      identity: input.identity,
      publicationVersion: input.publicationVersion,
      changeKind: input.changeKind,
      rawLocator: input.rawLocator,
      rawDigest: input.rawDigest,
      normalizedFacts: null,
      parserVersion: input.parserVersion,
    });
  }

  if (input.amountLexeme === null) {
    return fail("InvalidAmountLexeme", "A non-removal change needs an exact amount lexeme.");
  }

  const parsed = parseAmountLexeme(input.amountLexeme);

  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);

  const scale = BigInt(input.currencyScale);
  const { units, fractionDigits } = parsed.success;
  const factor = 10n ** scale;
  const divisor = 10n ** BigInt(fractionDigits);
  const scaled = units * factor;

  if (scaled % divisor !== 0n) {
    return fail(
      "FractionalMinorUnits",
      "The provider amount does not convert to whole minor units.",
    );
  }

  const providerMinor = scaled / divisor;

  return Result.succeed({
    identity: input.identity,
    publicationVersion: input.publicationVersion,
    changeKind: input.changeKind,
    rawLocator: input.rawLocator,
    rawDigest: input.rawDigest,
    normalizedFacts: {
      cashMovementMinor: (-providerMinor).toString(),
      currency: input.currency,
      bookingDate: input.bookingDate,
      authorizationDate: input.authorizationDate,
      pending: input.pending,
      pendingReference: input.pendingReference,
    },
    parserVersion: input.parserVersion,
  });
}

export const ObservationHead = Schema.Struct({
  identity: ProviderIdentity,
  latestRevisionLocator: Identifier,
  latestRawDigest: Digest,
  eligibilityVersion: MinorUnits,
  admittedObservationId: Schema.NullOr(Identifier),
  matched: Schema.Boolean,
  accountingComplete: Schema.Boolean,
});

export type ObservationHead = typeof ObservationHead.Type;

export const RevisionOutcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("replayed"),
    observationId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("pending_observation"),
    observationId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("lineage_linked"),
    observationId: Identifier,
    predecessorObservationId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("new_head"),
    observationId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("material_impact"),
    observationId: Identifier,
    impactCase: Schema.Struct({
      caseKind: Schema.Literal("material_source_change"),
      priorAdmissionRef: Identifier,
      matchedBefore: Schema.Boolean,
      staleEligibilityVersion: MinorUnits,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("removal_investigation"),
    observationId: Identifier,
    investigationCase: Schema.Struct({
      caseKind: Schema.Literal("removed_booked_observation"),
      bookedBefore: Schema.Boolean,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("overlap_case"),
    candidateObservationIds: Schema.Array(Identifier),
  }),
  Schema.Struct({
    kind: Schema.Literal("ambiguous_order"),
    rawLocator: Identifier,
  }),
]);

export type RevisionOutcome = typeof RevisionOutcome.Type;

export const ApplyRevisionInput = Schema.Struct({
  revision: SourceRevision,
  currentHead: Schema.NullOr(ObservationHead),
  retainedRevisionLocators: Schema.Array(Identifier),
  predecessorAcceptedAsFinal: Schema.Boolean,
  providerLinksPendingPredecessor: Schema.Boolean,
  pendingPredecessorObservationId: Schema.NullOr(Identifier),
  providerOrderResolvesConflict: Schema.Boolean,
  conflictingChangeWithinWindow: Schema.Boolean,
  lookalikeObservationIds: Schema.Array(Identifier),
  observationId: Identifier,
});

export type ApplyRevisionInput = typeof ApplyRevisionInput.Type;

// Applies one published revision to its identity head. A repeated source
// revision recovers the retained outcome; pending stays nonfinancial; an
// explicitly linked successor adopts one final observation; a material
// change to admitted or matched state raises an impact case and marks
// eligibility stale while preserving every old record; a removed booked
// observation becomes an investigation with no ledger delta.
export function applyPublishedRevision(input: ApplyRevisionInput): Checked<RevisionOutcome> {
  if (input.retainedRevisionLocators.includes(input.revision.rawLocator)) {
    return Result.succeed({ kind: "replayed", observationId: input.observationId });
  }

  if (input.conflictingChangeWithinWindow && !input.providerOrderResolvesConflict) {
    return Result.succeed({ kind: "ambiguous_order", rawLocator: input.revision.rawLocator });
  }

  const facts = input.revision.normalizedFacts;
  const head = input.currentHead;

  if (input.revision.changeKind === "removed") {
    return Result.succeed({
      kind: "removal_investigation",
      observationId: input.observationId,
      investigationCase: {
        caseKind: "removed_booked_observation",
        bookedBefore: head !== null && (head.matched || head.accountingComplete),
      },
    });
  }

  if (facts === null) {
    return fail(
      "InvalidAmountLexeme",
      "A non-removal revision needs normalized facts before it can advance the head.",
    );
  }

  if (facts.pending) {
    return Result.succeed({ kind: "pending_observation", observationId: input.observationId });
  }

  if (input.providerLinksPendingPredecessor) {
    if (input.pendingPredecessorObservationId === null) {
      return fail(
        "PredecessorAlreadyAccepted",
        "The linked pending predecessor names no retained pending observation.",
      );
    }

    if (input.predecessorAcceptedAsFinal) {
      return Result.succeed({
        kind: "overlap_case",
        candidateObservationIds: [input.pendingPredecessorObservationId, input.observationId],
      });
    }

    return Result.succeed({
      kind: "lineage_linked",
      observationId: input.observationId,
      predecessorObservationId: input.pendingPredecessorObservationId,
    });
  }

  if (head !== null && (head.admittedObservationId !== null || head.matched)) {
    const priorFacts = head.admittedObservationId !== null;

    if (priorFacts && input.lookalikeObservationIds.length === 0) {
      return Result.succeed({
        kind: "material_impact",
        observationId: input.observationId,
        impactCase: {
          caseKind: "material_source_change",
          priorAdmissionRef: head.admittedObservationId ?? input.observationId,
          matchedBefore: head.matched,
          staleEligibilityVersion: head.eligibilityVersion,
        },
      });
    }
  }

  if (input.lookalikeObservationIds.length > 0 && head === null) {
    return Result.succeed({
      kind: "overlap_case",
      candidateObservationIds: [...input.lookalikeObservationIds, input.observationId],
    });
  }

  return Result.succeed({ kind: "new_head", observationId: input.observationId });
}

export const OverlapDecision = Schema.Struct({
  relation: Schema.Literals(["same_event", "different_events"]),
  reviewer: Identifier,
  decidedAt: AccountingDate,
});

export type OverlapDecision = typeof OverlapDecision.Type;

export const AdmissionPlan = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("adopt_existing"),
    observationId: Identifier,
    provenanceRevisionLocator: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("new_observation"),
    observationId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("needs_decision"),
    candidateObservationIds: Schema.Array(Identifier),
  }),
]);

export type AdmissionPlan = typeof AdmissionPlan.Type;

export const PrepareAdmissionInput = Schema.Struct({
  revision: SourceRevision,
  revisionCurrent: Schema.Boolean,
  materialConflictOpen: Schema.Boolean,
  terminalSupported: Schema.Boolean,
  sameEventRelation: Schema.NullOr(OverlapDecision),
  existingObservationId: Schema.NullOr(Identifier),
  existingSemanticsReconcile: Schema.Boolean,
  lookalikeObservationIds: Schema.Array(Identifier),
  observationId: Identifier,
});

export type PrepareAdmissionInput = typeof PrepareAdmissionInput.Type;

// Reviewed admission: an evidenced same-event relation adopts the existing
// economic observation with added provenance and never mints a second cash
// capacity; an unresolved lookalike waits for a same/different decision and
// is never deduplicated automatically; otherwise the ordinary observation
// is prepared through the existing intake owner.
export function prepareBankAdmission(input: PrepareAdmissionInput): Checked<AdmissionPlan> {
  if (!input.terminalSupported) {
    return fail("StaleRevisionBasis", "Only a terminal supported observation can be admitted.");
  }

  if (!input.revisionCurrent) {
    return fail("StaleRevisionBasis", "The revision is no longer the current head.");
  }

  if (input.materialConflictOpen) {
    return fail("MaterialConflictUnresolved", "An unresolved material conflict blocks admission.");
  }

  if (input.sameEventRelation !== null) {
    if (input.existingObservationId === null) {
      return fail(
        "AdmissionSemanticsMismatch",
        "A same-event relation needs an existing economic observation.",
      );
    }

    if (!input.existingSemanticsReconcile) {
      return fail(
        "AdmissionSemanticsMismatch",
        "Amount, currency and date semantics do not reconcile under the decision.",
      );
    }

    return Result.succeed({
      kind: "adopt_existing",
      observationId: input.existingObservationId,
      provenanceRevisionLocator: input.revision.rawLocator,
    });
  }

  if (input.lookalikeObservationIds.length > 0) {
    return Result.succeed({
      kind: "needs_decision",
      candidateObservationIds: [...input.lookalikeObservationIds, input.observationId],
    });
  }

  return Result.succeed({ kind: "new_observation", observationId: input.observationId });
}

export const SameKeyAdmissionInput = Schema.Struct({
  existingCommandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  commandKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  existingRawDigest: Digest,
  rawDigest: Digest,
  existingObservationId: Identifier,
});

export type SameKeyAdmissionInput = typeof SameKeyAdmissionInput.Type;

// A repeated source revision under the same command recovers its single
// observation; anything else refuses rather than minting a duplicate.
export function replayAdmission(input: SameKeyAdmissionInput): Checked<typeof Identifier.Type> {
  if (input.commandKey !== input.existingCommandKey) {
    return fail(
      "AlreadyAdmitted",
      "A different key cannot admit a source revision that already has an observation.",
    );
  }

  if (input.rawDigest !== input.existingRawDigest) {
    return fail("IdempotencyConflict", "The same command key carries a different source revision.");
  }

  return Result.succeed(input.existingObservationId);
}
