import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";

// Pure VAT assessment ownership and exact-to-assessed bridge. NEXT-37 leaf:
// the rounding bridge between exact accounting net and legitimately reported
// net, the authority-assessment lifecycle, and the expected settlement
// control equation.
//
// Three amounts stay distinct: N (exact accounting net), R (declared net
// under the qualified filing rule) and A (authority assessed amount). An
// assessment different from the declaration is a visible discrepancy,
// never an automatic rounding plug. Cash arriving at a bank remains a
// separate event owned elsewhere. Reclassification and amendment effects
// stay with their reserved owners; this leaf only combines their vectors.

export const AssessmentFailureCode = Schema.Literals([
  "UnexplainedBridge",
  "AlreadyApplied",
  "IncompatibleAdoption",
  "UnbalancedJournal",
]);

export type AssessmentFailureCode = typeof AssessmentFailureCode.Type;

export const AssessmentFailure = Schema.Struct({
  code: AssessmentFailureCode,
  message: Description,
});

export type AssessmentFailure = typeof AssessmentFailure.Type;

export type Checked<A> = Result.Result<A, AssessmentFailure>;

function fail(code: AssessmentFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const AssessmentJournalLine = Schema.Struct({
  sourceLineId: Schema.NullOr(Identifier),
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type AssessmentJournalLine = typeof AssessmentJournalLine.Type;

export const AssessmentJournalLines = Schema.Array(AssessmentJournalLine);

export type AssessmentJournalLines = typeof AssessmentJournalLines.Type;

type JournalLine = AssessmentJournalLine;

function addSigned(lines: Array<JournalLine>, line: {
  readonly accountId: string;
  readonly signedMinor: bigint;
  readonly description: string;
}) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

export const RoundingBridgeInput = Schema.Struct({
  obligationId: Identifier,
  returnRevision: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  exactNetMinor: SignedMinorUnits,
  reportedNetMinor: SignedMinorUnits,
  priorBridgeEffectsMinor: Schema.Array(SignedMinorUnits),
  // Every component of the new delta must be explained by retained rounding
  // lineage. The lineage total must equal the delta exactly; a tolerance
  // such as "less than 100 means rounding" is never accepted.
  lineageExplainedMinor: SignedMinorUnits,
  roundingReleaseId: Identifier,
  settlementControlAccountId: Identifier,
  roundingGainAccountId: Identifier,
  roundingLossAccountId: Identifier,
});

export type RoundingBridgeInput = typeof RoundingBridgeInput.Type;

export const RoundingBridgePlan = Schema.Struct({
  obligationId: Identifier,
  bridgeDeltaMinor: SignedMinorUnits,
  journal: AssessmentJournalLines,
});

export type RoundingBridgePlan = typeof RoundingBridgePlan.Type;

// The precision bridge between exact net and legitimately reported net.
// A zero delta seals a no-effect bridge with no journal rather than
// manufacturing a zero line.
export function compileRoundingBridge(input: RoundingBridgeInput): Checked<RoundingBridgePlan> {
  const target = BigInt(input.exactNetMinor) - BigInt(input.reportedNetMinor);
  const prior = input.priorBridgeEffectsMinor.reduce((sum, effect) => sum + BigInt(effect), 0n);
  const delta = target - prior;

  if (delta !== BigInt(input.lineageExplainedMinor)) {
    return fail(
      "UnexplainedBridge",
      "The bridge delta must equal its retained rounding lineage exactly.",
    );
  }

  const journal: Array<JournalLine> = [];

  addSigned(journal, {
    accountId: input.settlementControlAccountId,
    signedMinor: delta,
    description: `Rounding bridge ${input.obligationId}`,
  });

  if (delta !== 0n) {
    addSigned(journal, {
      accountId: delta < 0n ? input.roundingLossAccountId : input.roundingGainAccountId,
      signedMinor: -delta,
      description: `Rounding ${delta < 0n ? "loss" : "gain"} ${input.obligationId}`,
    });
  }

  const balance = journal.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  if (balance !== 0n) {
    return fail("UnbalancedJournal", "Bridge lines must balance exactly.");
  }

  return Result.succeed({
    obligationId: input.obligationId,
    bridgeDeltaMinor: amount(delta),
    journal,
  });
}

export const AssessmentMode = Schema.Literals(["adopt_existing_effect", "new_assessment_posting"]);

export type AssessmentMode = typeof AssessmentMode.Type;

export const ExistingAssessmentEffect = Schema.Struct({
  settlementMinor: SignedMinorUnits,
  taxAccountMinor: SignedMinorUnits,
  matchRef: Identifier,
  relationshipUsed: Schema.Boolean,
});

export type ExistingAssessmentEffect = typeof ExistingAssessmentEffect.Type;

export const AssessmentInput = Schema.Struct({
  assessmentIdentity: Identifier,
  obligationId: Identifier,
  authorityPeriod: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  // Positive for an assessed tax charge, negative for a credit/refund
  // entitlement.
  assessedMinor: SignedMinorUnits,
  expectedRemainingMinor: SignedMinorUnits,
  knownAssessmentIdentities: Schema.Array(Identifier),
  existingPosting: Schema.NullOr(ExistingAssessmentEffect),
  settlementControlAccountId: Identifier,
  taxAccountControlId: Identifier,
});

export type AssessmentInput = typeof AssessmentInput.Type;

export const AssessmentPlan = Schema.Struct({
  assessmentIdentity: Identifier,
  obligationId: Identifier,
  mode: AssessmentMode,
  adoptedMatchRef: Schema.NullOr(Identifier),
  // Amount difference to the expected remaining assessed amount, retained
  // as explained or pending. Never auto-bridged and never a plug.
  pendingDifferenceMinor: SignedMinorUnits,
  journal: AssessmentJournalLines,
});

export type AssessmentPlan = typeof AssessmentPlan.Type;

// Capturing one authority assessment. An already-posted compatible effect
// with an unused assessment relationship is adopted with an empty journal;
// otherwise the assessment posts settlement against tax account and calls
// for the tax-account match in the same application transaction.
export function prepareAssessment(input: AssessmentInput): Checked<AssessmentPlan> {
  if (input.knownAssessmentIdentities.includes(input.assessmentIdentity)) {
    return fail(
      "AlreadyApplied",
      "This assessment identity is already financially represented.",
    );
  }

  const assessed = BigInt(input.assessedMinor);
  const expected = BigInt(input.expectedRemainingMinor);
  const pending = assessed - expected;
  const journal: Array<JournalLine> = [];
  let mode: AssessmentMode = "new_assessment_posting";
  let adopted: string | null = null;

  if (input.existingPosting !== null) {
    const posting = input.existingPosting;

    if (
      BigInt(posting.settlementMinor) !== assessed ||
      BigInt(posting.taxAccountMinor) !== -assessed ||
      posting.relationshipUsed
    ) {
      return fail(
        "IncompatibleAdoption",
        "Adoption needs the exact settlement/tax-account vectors with an unused assessment relationship.",
      );
    }

    mode = "adopt_existing_effect";
    adopted = posting.matchRef;
  } else {
    addSigned(journal, {
      accountId: input.settlementControlAccountId,
      signedMinor: assessed,
      description: `Authority assessment ${input.assessmentIdentity}`,
    });
    addSigned(journal, {
      accountId: input.taxAccountControlId,
      signedMinor: -assessed,
      description: `Tax account assessment ${input.assessmentIdentity}`,
    });
  }

  const balance = journal.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  if (balance !== 0n) {
    return fail("UnbalancedJournal", "Assessment lines must balance exactly.");
  }

  return Result.succeed({
    assessmentIdentity: input.assessmentIdentity,
    obligationId: input.obligationId,
    mode,
    adoptedMatchRef: adopted,
    pendingDifferenceMinor: amount(pending),
    journal,
  });
}

// The expected VAT settlement control: all owned reclassification and
// amendment vectors plus all qualified rounding bridge vectors plus all
// signed assessment vectors. A residual while assessment is pending is
// legitimate; it is not "reconciled and paid" by a matching bank deposit.
export function expectedSettlementControl(
  reclassificationVectorsMinor: ReadonlyArray<string>,
  bridgeVectorsMinor: ReadonlyArray<string>,
  assessmentVectorsMinor: ReadonlyArray<string>,
): string {
  let total = 0n;

  for (const vector of reclassificationVectorsMinor) total += BigInt(vector);

  for (const vector of bridgeVectorsMinor) total += BigInt(vector);

  for (const vector of assessmentVectorsMinor) total += BigInt(vector);

  return total.toString();
}
