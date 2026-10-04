import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits } from "./money";

export const ImpairmentFailureCode = Schema.Literals([
  "IncompleteCounterfactualEvidence",
  "TargetBelowCarrying",
  "TargetAboveCap",
  "NegativeCarrying",
  "ScheduleDoesNotFoot",
  "AssetNotOwned",
  "DisposalRevivalRefused",
  "ConsumedCorrectionRefused",
  "WrongValuationKind",
]);

export type ImpairmentFailureCode = typeof ImpairmentFailureCode.Type;

export const ImpairmentFailure = Schema.Struct({
  code: ImpairmentFailureCode,
  message: Description,
});

export type ImpairmentFailure = typeof ImpairmentFailure.Type;

export type Checked<A> = Result.Result<A, ImpairmentFailure>;

function fail(code: ImpairmentFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const AssetBasis = Schema.Struct({
  assetId: Identifier,
  grossMinor: MinorUnits,
  ordinaryAccumulationMinor: MinorUnits,
  impairmentContraMinor: MinorUnits,
  owned: Schema.Boolean,
  scheduleState: Schema.Literals(["active", "exhausted", "zero_carrying_in_use", "disposed"]),
});

export type AssetBasis = typeof AssetBasis.Type;

export function currentCarrying(basis: AssetBasis): Checked<typeof MinorUnits.Type> {
  const carrying =
    BigInt(basis.grossMinor) -
    BigInt(basis.ordinaryAccumulationMinor) -
    BigInt(basis.impairmentContraMinor);

  if (carrying < 0n) {
    return fail("NegativeCarrying", "The asset carrying cannot go negative.");
  }

  return Result.succeed(amount(carrying));
}

export const CounterfactualInput = Schema.Struct({
  assetId: Identifier,
  grossMinor: MinorUnits,
  counterfactualOrdinaryMinor: MinorUnits,
  permittedRevisionRefs: Schema.Array(Identifier),
  completeCostEvidence: Schema.Boolean,
  policyRelease: Identifier,
});

export type CounterfactualInput = typeof CounterfactualInput.Type;

export function calculateCounterfactual(
  input: CounterfactualInput,
): Checked<typeof MinorUnits.Type> {
  if (!input.completeCostEvidence) {
    return fail(
      "IncompleteCounterfactualEvidence",
      "Reversal needs complete original cost and eligible ordinary history.",
    );
  }

  if (input.permittedRevisionRefs.length === 0) {
    return fail(
      "IncompleteCounterfactualEvidence",
      "The counterfactual needs its permitted revision witness.",
    );
  }

  const carrying = BigInt(input.grossMinor) - BigInt(input.counterfactualOrdinaryMinor);

  if (carrying < 0n) {
    return fail("NegativeCarrying", "The counterfactual carrying cannot go negative.");
  }

  return Result.succeed(amount(carrying));
}

export const ValuationKind = Schema.Literals(["economic_reversal", "error_correction", "disposal"]);

export type ValuationKind = typeof ValuationKind.Type;

export const ReversalDecision = Schema.Struct({
  assetId: Identifier,
  kind: ValuationKind,
  assessmentOn: AccountingDate,
  targetCarryingMinor: MinorUnits,
  counterfactualCarryingMinor: MinorUnits,
  futureInstallmentsMinor: Schema.Array(MinorUnits),
  futureResidualMinor: MinorUnits,
});

export type ReversalDecision = typeof ReversalDecision.Type;

export const ReversalJournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type ReversalJournalLine = typeof ReversalJournalLine.Type;

export const EconomicReversalPlan = Schema.Struct({
  assetId: Identifier,
  reversalMinor: MinorUnits,
  resultingImpairmentMinor: MinorUnits,
  resultingCarryingMinor: MinorUnits,
  journal: Schema.Array(ReversalJournalLine),
});

export type EconomicReversalPlan = typeof EconomicReversalPlan.Type;

export const CompileReversalInput = Schema.Struct({
  basis: AssetBasis,
  decision: ReversalDecision,
  accumulatedImpairmentAccountId: Identifier,
  reversalIncomeAccountId: Identifier,
});

export type CompileReversalInput = typeof CompileReversalInput.Type;

export function compileEconomicReversal(
  input: CompileReversalInput,
): Checked<EconomicReversalPlan> {
  if (input.decision.kind !== "economic_reversal") {
    return fail(
      "WrongValuationKind",
      "An error correction or disposal cannot run the economic-reversal compiler.",
    );
  }

  if (!input.basis.owned || input.basis.scheduleState === "disposed") {
    return fail("AssetNotOwned", "Only an owned, undisposed asset reverses.");
  }

  const carrying = currentCarrying(input.basis);

  if (Result.isFailure(carrying)) return Result.fail(carrying.failure);

  const before = BigInt(carrying.success);
  const target = BigInt(input.decision.targetCarryingMinor);
  const cap = BigInt(input.decision.counterfactualCarryingMinor);
  const eligible = BigInt(input.basis.impairmentContraMinor);

  if (target < before) {
    return fail("TargetBelowCarrying", "A reversal target cannot sit below carrying.");
  }

  const maximum = cap < before + eligible ? cap : before + eligible;

  if (target > maximum) {
    return fail("TargetAboveCap", "The target exceeds the qualified counterfactual cap.");
  }

  const reversal = target - before;
  let future = BigInt(input.decision.futureResidualMinor);

  for (const installment of input.decision.futureInstallmentsMinor) {
    future += BigInt(installment);
  }

  if (future !== target) {
    return fail(
      "ScheduleDoesNotFoot",
      "Future installments plus residual must equal the target carrying.",
    );
  }

  const journal: Array<ReversalJournalLine> =
    reversal === 0n
      ? []
      : [
          {
            accountId: input.accumulatedImpairmentAccountId,
            debitMinor: amount(reversal),
            creditMinor: "0",
            description: "Reverse accumulated impairment",
          },
          {
            accountId: input.reversalIncomeAccountId,
            debitMinor: "0",
            creditMinor: amount(reversal),
            description: "Qualified impairment-reversal income",
          },
        ];

  return Result.succeed({
    assetId: input.basis.assetId,
    reversalMinor: amount(reversal),
    resultingImpairmentMinor: amount(eligible - reversal),
    resultingCarryingMinor: amount(target),
    journal,
  });
}

export const ZeroCarryingPlan = Schema.Struct({
  assetId: Identifier,
  writeDownMinor: MinorUnits,
  journal: Schema.Array(ReversalJournalLine),
});

export type ZeroCarryingPlan = typeof ZeroCarryingPlan.Type;

export const ZeroCarryingInput = Schema.Struct({
  basis: AssetBasis,
  qualifiedWriteDown: Schema.Boolean,
  impairmentLossAccountId: Identifier,
  accumulatedImpairmentAccountId: Identifier,
});

export type ZeroCarryingInput = typeof ZeroCarryingInput.Type;

export function compileZeroCarryingDecision(input: ZeroCarryingInput): Checked<ZeroCarryingPlan> {
  if (!input.basis.owned || input.basis.scheduleState === "disposed") {
    return fail("AssetNotOwned", "Only a still-owned asset writes down to zero carrying.");
  }

  if (!input.qualifiedWriteDown) {
    return fail(
      "IncompleteCounterfactualEvidence",
      "A complete write-down needs its qualified decision.",
    );
  }

  const carrying = currentCarrying(input.basis);

  if (Result.isFailure(carrying)) return Result.fail(carrying.failure);

  const writeDown = BigInt(carrying.success);

  return Result.succeed({
    assetId: input.basis.assetId,
    writeDownMinor: amount(writeDown),
    journal:
      writeDown === 0n
        ? []
        : [
            {
              accountId: input.impairmentLossAccountId,
              debitMinor: amount(writeDown),
              creditMinor: "0",
              description: "Impairment loss on complete write-down",
            },
            {
              accountId: input.accumulatedImpairmentAccountId,
              debitMinor: "0",
              creditMinor: amount(writeDown),
              description: "Accumulated impairment on complete write-down",
            },
          ],
  });
}

export const ZeroDisposalInput = Schema.Struct({
  assetId: Identifier,
  grossMinor: MinorUnits,
  accumulatedOrdinaryMinor: MinorUnits,
  accumulatedImpairmentMinor: MinorUnits,
  proceedsMinor: MinorUnits,
});

export type ZeroDisposalInput = typeof ZeroDisposalInput.Type;

export const ZeroDisposalPlan = Schema.Struct({
  assetId: Identifier,
  releasesGrossMinor: MinorUnits,
  releasesContraMinor: MinorUnits,
  additionalLossMinor: MinorUnits,
});

export type ZeroDisposalPlan = typeof ZeroDisposalPlan.Type;

export function disposeZeroCarryingAsset(input: ZeroDisposalInput): Checked<ZeroDisposalPlan> {
  const carrying =
    BigInt(input.grossMinor) -
    BigInt(input.accumulatedOrdinaryMinor) -
    BigInt(input.accumulatedImpairmentMinor);

  if (carrying !== 0n) {
    return fail("WrongValuationKind", "This disposal path is only for zero-carrying assets.");
  }

  if (BigInt(input.proceedsMinor) !== 0n) {
    return fail("WrongValuationKind", "Proceeds belong to the disposal-with-proceeds owner.");
  }

  return Result.succeed({
    assetId: input.assetId,
    releasesGrossMinor: input.grossMinor,
    releasesContraMinor: amount(
      BigInt(input.accumulatedOrdinaryMinor) + BigInt(input.accumulatedImpairmentMinor),
    ),
    additionalLossMinor: "0",
  });
}

export const ReviveInput = Schema.Struct({
  assetId: Identifier,
  scheduleState: AssetBasis.fields.scheduleState,
});

export type ReviveInput = typeof ReviveInput.Type;

export function refuseRevival(input: ReviveInput): Checked<typeof Identifier.Type> {
  if (input.scheduleState === "disposed") {
    return fail("DisposalRevivalRefused", "A disposed asset cannot be revived by valuation.");
  }

  return Result.succeed(input.assetId);
}

export const CorrectionScopeInput = Schema.Struct({
  eventId: Identifier,
  consequencesConsumed: Schema.Boolean,
  replacementScheduleComplete: Schema.Boolean,
});

export type CorrectionScopeInput = typeof CorrectionScopeInput.Type;

export function assertCorrectableEvent(
  input: CorrectionScopeInput,
): Checked<typeof Identifier.Type> {
  if (input.consequencesConsumed || !input.replacementScheduleComplete) {
    return fail(
      "ConsumedCorrectionRefused",
      "A consumed event needs its affected chain, not a standalone reversal.",
    );
  }

  return Result.succeed(input.eventId);
}
