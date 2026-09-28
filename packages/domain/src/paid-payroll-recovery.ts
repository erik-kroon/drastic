import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure paid-payroll math for one employee.
// NEXT-36 leaf: recovery and retroactive compensation after actual
// payment. NEXT-21 owns unpaid-run correction; this packet covers only
// consumed history through four explicit kinds that are never inferred
// from a negative amount: additional compensation, future-pay
// adjustment, gross recovery claim and reporting-only correction. Paid
// runs, filed snapshots and credited withholding are immutable inputs:
// a correction references them, never relabels their dates or erases
// them. Recovery needs its lawful basis as a reviewed input, and a tax
// account posts only from its own evidenced assessment event. The
// application owns run/payment/reporting persistence and AGI filing.

export const RecoveryFailureCode = Schema.Literals([
  "MissingLawfulBasis",
  "InsufficientFutureEarnings",
  "NegativePayRefused",
  "RecoveryCapacityExceeded",
  "DuplicateRecoveryClaim",
  "SpecificationIdentityMismatch",
  "LedgerFactsMismatch",
  "CashOverAllocated",
  "UnsupportedNegativeSalary",
]);

export type RecoveryFailureCode = typeof RecoveryFailureCode.Type;

export const RecoveryFailure = Schema.Struct({
  code: RecoveryFailureCode,
  message: Description,
});

export type RecoveryFailure = typeof RecoveryFailure.Type;

export type Checked<A> = Result.Result<A, RecoveryFailure>;

function fail(code: RecoveryFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const RecoveryJournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type RecoveryJournalLine = typeof RecoveryJournalLine.Type;

export const AdditionalCompensationInput = Schema.Struct({
  adjustmentId: Identifier,
  employeeId: Identifier,
  earningPeriods: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  additionalEntitlementMinor: MinorUnits,
  wageExpenseAccountId: Identifier,
  employeePayableAccountId: Identifier,
});

export type AdditionalCompensationInput = typeof AdditionalCompensationInput.Type;

export const EarningInstruction = Schema.Struct({
  instructionId: Identifier,
  employeeId: Identifier,
  entitlementMinor: MinorUnits,
  wageExpenseAccountId: Identifier,
  employeePayableAccountId: Identifier,
});

export type EarningInstruction = typeof EarningInstruction.Type;

// Additional compensation creates a new earning instruction for future
// payment and reporting. Original cash and reporting items stand: no
// reversal merely due to an earned date.
export function compileAdditionalCompensation(
  input: AdditionalCompensationInput,
): Checked<EarningInstruction> {
  const entitlement = BigInt(input.additionalEntitlementMinor);

  if (entitlement <= 0n) {
    return fail(
      "LedgerFactsMismatch",
      "Additional compensation needs a positive recomputed entitlement.",
    );
  }

  return Result.succeed({
    instructionId: `${input.adjustmentId}-earn`,
    employeeId: input.employeeId,
    entitlementMinor: amount(entitlement),
    wageExpenseAccountId: input.wageExpenseAccountId,
    employeePayableAccountId: input.employeePayableAccountId,
  });
}

export const FuturePayAdjustmentInput = Schema.Struct({
  adjustmentId: Identifier,
  employeeId: Identifier,
  originalPayRefs: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  lawfulOffsetBasis: Schema.NullOr(Identifier),
  supportedFutureEarningsMinor: MinorUnits,
  grossDeltaMinor: MinorUnits,
});

export type FuturePayAdjustmentInput = typeof FuturePayAdjustmentInput.Type;

export const FuturePayInstruction = Schema.Struct({
  instructionId: Identifier,
  employeeId: Identifier,
  reductionMinor: MinorUnits,
  consumedOnce: Schema.Boolean,
  createsRecoveryReceivable: Schema.Boolean,
});

export type FuturePayInstruction = typeof FuturePayInstruction.Type;

// A future-pay adjustment records one negative earning component for
// exactly one future run under a qualified offset right. It creates no
// gross-recovery receivable, leaves original reporting unchanged, and
// refuses an unsupported negative pay instead of selecting another case
// silently.
export function compileFuturePayAdjustment(
  input: FuturePayAdjustmentInput,
): Checked<FuturePayInstruction> {
  if (input.lawfulOffsetBasis === null) {
    return fail("MissingLawfulBasis", "A future-pay adjustment needs a qualified offset right.");
  }

  const delta = BigInt(input.grossDeltaMinor);

  if (delta <= 0n) {
    return fail("LedgerFactsMismatch", "A future-pay adjustment needs a positive gross delta.");
  }

  if (delta > BigInt(input.supportedFutureEarningsMinor)) {
    return fail(
      "InsufficientFutureEarnings",
      "Supported future earnings do not cover the adjustment.",
    );
  }

  if (delta === BigInt(input.supportedFutureEarningsMinor)) {
    return fail(
      "NegativePayRefused",
      "The adjustment would erase the supported future pay; select another reviewed case.",
    );
  }

  return Result.succeed({
    instructionId: `${input.adjustmentId}-future`,
    employeeId: input.employeeId,
    reductionMinor: amount(delta),
    consumedOnce: true,
    createsRecoveryReceivable: false,
  });
}

export const GrossRecoveryInput = Schema.Struct({
  claimId: Identifier,
  employeeId: Identifier,
  originalPayRefs: Schema.Array(Identifier).check(Schema.isMinLength(1)),
  enforceableClaimEvidence: Schema.NullOr(Identifier),
  claimedGrossMinor: MinorUnits,
  unclaimedEligibleMinor: MinorUnits,
  recoveryReceivableAccountId: Identifier,
  wageCostAccountId: Identifier,
  originalSpecificationId: Identifier,
});

export type GrossRecoveryInput = typeof GrossRecoveryInput.Type;

export const GrossRecoveryPlan = Schema.Struct({
  claimId: Identifier,
  employeeId: Identifier,
  grossClaimedMinor: MinorUnits,
  remainingReceivableMinor: MinorUnits,
  journal: Schema.Array(RecoveryJournalLine),
  reportingSpecificationId: Identifier,
});

export type GrossRecoveryPlan = typeof GrossRecoveryPlan.Type;

// A gross recovery books the employee receivable against wage cost and
// keeps every original cash, withholding and bank value untouched. The
// reporting action reuses the original specification identity; a new
// number is a duplicate, never a replacement.
export function compileGrossRecoveryClaim(input: GrossRecoveryInput): Checked<GrossRecoveryPlan> {
  if (input.enforceableClaimEvidence === null) {
    return fail("MissingLawfulBasis", "A gross recovery needs enforceable claim evidence.");
  }

  const claimed = BigInt(input.claimedGrossMinor);

  if (claimed <= 0n) {
    return fail("LedgerFactsMismatch", "A gross recovery needs a positive claimed amount.");
  }

  if (claimed > BigInt(input.unclaimedEligibleMinor)) {
    return fail(
      "RecoveryCapacityExceeded",
      "The claim exceeds the unclaimed eligible original compensation.",
    );
  }

  return Result.succeed({
    claimId: input.claimId,
    employeeId: input.employeeId,
    grossClaimedMinor: amount(claimed),
    remainingReceivableMinor: amount(claimed),
    journal: [
      {
        accountId: input.recoveryReceivableAccountId,
        debitMinor: amount(claimed),
        creditMinor: "0",
        description: "Employee recovery receivable",
      },
      {
        accountId: input.wageCostAccountId,
        debitMinor: "0",
        creditMinor: amount(claimed),
        description: "Original wage-cost recovery",
      },
    ],
    reportingSpecificationId: input.originalSpecificationId,
  });
}

export const RecoveryCashInput = Schema.Struct({
  claimId: Identifier,
  remainingReceivableMinor: MinorUnits,
  receivedMinor: MinorUnits,
  bankAccountId: Identifier,
  recoveryReceivableAccountId: Identifier,
});

export type RecoveryCashInput = typeof RecoveryCashInput.Type;

export const RecoveryCashPlan = Schema.Struct({
  claimId: Identifier,
  allocatedMinor: MinorUnits,
  remainingReceivableMinor: MinorUnits,
  journal: Schema.Array(RecoveryJournalLine),
});

export type RecoveryCashPlan = typeof RecoveryCashPlan.Type;

// Actual repayment allocates bank against the receivable with no further
// wage or tax correction. An overclaim never becomes negative net salary
// here: excess refuses with its capacity.
export function recordRecoveryCash(input: RecoveryCashInput): Checked<RecoveryCashPlan> {
  const received = BigInt(input.receivedMinor);
  const remaining = BigInt(input.remainingReceivableMinor);

  if (received <= 0n) {
    return fail("LedgerFactsMismatch", "A recovery receipt needs a positive amount.");
  }

  if (received > remaining) {
    return fail("CashOverAllocated", "The receipt exceeds the remaining gross receivable.");
  }

  return Result.succeed({
    claimId: input.claimId,
    allocatedMinor: amount(received),
    remainingReceivableMinor: amount(remaining - received),
    journal: [
      {
        accountId: input.bankAccountId,
        debitMinor: amount(received),
        creditMinor: "0",
        description: "Employee recovery cash receipt",
      },
      {
        accountId: input.recoveryReceivableAccountId,
        debitMinor: "0",
        creditMinor: amount(received),
        description: "Settle employee recovery receivable",
      },
    ],
  });
}

export const ReplayClaimInput = Schema.Struct({
  existingClaimId: Identifier,
  existingComponent: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  claimId: Identifier,
  component: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  existingPlan: GrossRecoveryPlan,
});

export type ReplayClaimInput = typeof ReplayClaimInput.Type;

// The same claim and component under a new key recovers no second
// entitlement.
export function replayRecoveryClaim(input: ReplayClaimInput): Checked<GrossRecoveryPlan> {
  if (input.claimId !== input.existingClaimId || input.component !== input.existingComponent) {
    return fail(
      "DuplicateRecoveryClaim",
      "A different claim cannot reuse a committed recovery entitlement.",
    );
  }

  return Result.succeed(input.existingPlan);
}

export const AgiReplacementInput = Schema.Struct({
  originalSpecificationId: Identifier,
  replacementSpecificationId: Identifier,
});

export type AgiReplacementInput = typeof AgiReplacementInput.Type;

// A replacement AGI reuses the original specification number. A new
// number is refused as an accidental duplicate identity.
export function assertAgiReplacementIdentity(
  input: AgiReplacementInput,
): Checked<typeof Identifier.Type> {
  if (input.replacementSpecificationId !== input.originalSpecificationId) {
    return fail(
      "SpecificationIdentityMismatch",
      "A replacement AGI must reuse the original specification identity.",
    );
  }

  return Result.succeed(input.originalSpecificationId);
}

export const ReportingOnlyInput = Schema.Struct({
  correctionId: Identifier,
  ledgerFactsCorrect: Schema.Boolean,
  declarationDifferences: Schema.Array(
    Schema.Struct({ itemIdentity: Identifier, correctedValues: Identifier }),
  ),
});

export type ReportingOnlyInput = typeof ReportingOnlyInput.Type;

export const ReportingRevision = Schema.Struct({
  correctionId: Identifier,
  revisedItems: Schema.Array(Identifier),
});

export type ReportingRevision = typeof ReportingRevision.Type;

// A reporting-only correction proves ledger and pay facts already agree
// and revises declarations alone: no wage or cash journal.
export function compileReportingOnlyCorrection(
  input: ReportingOnlyInput,
): Checked<ReportingRevision> {
  if (!input.ledgerFactsCorrect) {
    return fail(
      "LedgerFactsMismatch",
      "A reporting-only correction needs already-correct ledger and pay facts.",
    );
  }

  if (input.declarationDifferences.length === 0) {
    return fail(
      "LedgerFactsMismatch",
      "A reporting-only correction needs at least one declaration difference.",
    );
  }

  return Result.succeed({
    correctionId: input.correctionId,
    revisedItems: input.declarationDifferences.map((difference) => difference.itemIdentity),
  });
}
