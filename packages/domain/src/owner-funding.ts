import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure owner funding, liability transfer and reimbursement calculation. No
// database, no runtime and no default: every account, amount, classification and
// evidence reference arrives as a reviewed input, and a bound failure is an error
// rather than a truncation. The owner-paid purchase itself is not compiled here:
// it reuses the source-line purchase compiler with a reviewed owner-liability
// funding role, so the tax decision stays with that one owner.

export const OwnerFailureCode = Schema.Literals([
  "UnsupportedOwnerTreatment",
  "OwnerAmountOutOfRange",
  "OwnerAmountExceedsCapacity",
  "DuplicateOwnerAllocationLeg",
  "UnbalancedOwnerJournal",
]);

export type OwnerFailureCode = typeof OwnerFailureCode.Type;

export const OwnerFailure = Schema.Struct({
  code: OwnerFailureCode,
  message: Description,
});

export type OwnerFailure = typeof OwnerFailure.Type;

export type Checked<A> = Result.Result<A, OwnerFailure>;

export const OwnerJournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type OwnerJournalLine = typeof OwnerJournalLine.Type;

export const OwnerClassification = Schema.Literals([
  "owner_expense",
  "owner_reimbursement",
  "shareholder_loan",
  "loan_repayment",
  "conditional_contribution",
  "unconditional_contribution",
]);

export type OwnerClassification = typeof OwnerClassification.Type;

export const FundingLegalForm = Schema.Literals([
  "shareholder_loan",
  "conditional_contribution",
  "unconditional_contribution",
  "unresolved",
]);

export type FundingLegalForm = typeof FundingLegalForm.Type;

function fail(code: OwnerFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

function minorCeiling(currencyScale: number) {
  return 10n ** BigInt(38 - currencyScale);
}

function positiveExact(value: string, scale: number, subject: string): Checked<bigint> {
  const parsed = BigInt(value);
  const ceiling = minorCeiling(scale);

  if (parsed <= 0n || parsed >= ceiling) {
    return fail("OwnerAmountOutOfRange", `${subject} is not a positive exact minor amount.`);
  }

  return Result.succeed(parsed);
}

// A complete group balances exactly and every line carries exactly one positive
// side. A zero-valued line is never manufactured.
export function assertBalancedOwnerJournal(
  lines: ReadonlyArray<OwnerJournalLine>,
): Checked<ReadonlyArray<OwnerJournalLine>> {
  if (lines.length < 2) {
    return fail("UnbalancedOwnerJournal", "A complete owner group needs at least two lines.");
  }

  for (const line of lines) {
    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);

    if (debit < 0n || credit < 0n || debit === credit) {
      return fail(
        "UnbalancedOwnerJournal",
        "An owner journal line needs exactly one positive side.",
      );
    }
  }

  const balance = lines.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  return balance === 0n
    ? Result.succeed(lines)
    : fail("UnbalancedOwnerJournal", "An owner group must balance exactly.");
}

export const OwnerTransferInput = Schema.Struct({
  currencyScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  supplierPayableAccountId: Identifier,
  ownerLiabilityAccountId: Identifier,
  amountMinor: MinorUnits,
  description: Description,
});

export type OwnerTransferInput = typeof OwnerTransferInput.Type;

export const OwnerTransferPlan = Schema.Struct({
  amountMinor: MinorUnits,
  journal: Schema.Array(OwnerJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
});

export type OwnerTransferPlan = typeof OwnerTransferPlan.Type;

// The owner discharges an already recognized supplier obligation. This is a
// transfer of the same amount, not a second purchase: the original invoice, its
// expense and its tax facts are untouched and no cash line appears when the owner
// used a private account.
export function compileOwnerPayableTransfer(input: OwnerTransferInput): Checked<OwnerTransferPlan> {
  if (input.supplierPayableAccountId === input.ownerLiabilityAccountId) {
    return fail("UnsupportedOwnerTreatment", "A payable transfer needs two distinct accounts.");
  }

  const moved = positiveExact(input.amountMinor, input.currencyScale, "The transferred amount");

  if (Result.isFailure(moved)) return Result.fail(moved.failure);

  const balanced = assertBalancedOwnerJournal([
    {
      accountId: input.supplierPayableAccountId,
      debitMinor: amount(moved.success),
      creditMinor: "0",
      description: input.description,
    },
    {
      accountId: input.ownerLiabilityAccountId,
      debitMinor: "0",
      creditMinor: amount(moved.success),
      description: input.description,
    },
  ]);

  if (Result.isFailure(balanced)) return Result.fail(balanced.failure);

  return Result.succeed({
    amountMinor: amount(moved.success),
    journal: [...balanced.success],
  });
}

export const OwnerAllocationLeg = Schema.Struct({
  claimId: Identifier,
  amountMinor: MinorUnits,
});

export type OwnerAllocationLeg = typeof OwnerAllocationLeg.Type;

export const ReimbursementInput = Schema.Struct({
  currencyScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  ownerLiabilityAccountId: Identifier,
  cashAccountId: Identifier,
  description: Description,
  legs: Schema.Array(OwnerAllocationLeg).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  capacities: Schema.Array(
    Schema.Struct({ claimId: Identifier, remainingMinor: MinorUnits }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export type ReimbursementInput = typeof ReimbursementInput.Type;

export const ReimbursementPlan = Schema.Struct({
  totalMinor: MinorUnits,
  legs: Schema.Array(
    Schema.Struct({
      claimId: Identifier,
      amountMinor: MinorUnits,
      remainingAfterMinor: MinorUnits,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  journal: Schema.Array(OwnerJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
});

export type ReimbursementPlan = typeof ReimbursementPlan.Type;

// One payment may consume several owner claims. Every leg is positive, bounded by
// the claim's own current remaining capacity, and a claim appears once. A claim
// keeps its original source and its prior allocations.
export function compileOwnerReimbursement(input: ReimbursementInput): Checked<ReimbursementPlan> {
  if (input.ownerLiabilityAccountId === input.cashAccountId) {
    return fail("UnsupportedOwnerTreatment", "A reimbursement needs a distinct cash account.");
  }

  const capacityByClaim = new Map(
    input.capacities.map((capacity) => [capacity.claimId, capacity.remainingMinor]),
  );

  if (capacityByClaim.size !== input.capacities.length) {
    return fail("DuplicateOwnerAllocationLeg", "A claim capacity is repeated.");
  }

  const seen = new Set<string>();
  const legs: Array<{ claimId: string; amountMinor: string; remainingAfterMinor: string }> = [];
  let total = 0n;

  for (const leg of input.legs) {
    if (seen.has(leg.claimId)) {
      return fail("DuplicateOwnerAllocationLeg", `${leg.claimId} is allocated twice.`);
    }

    seen.add(leg.claimId);

    const remaining = capacityByClaim.get(leg.claimId);

    if (remaining === undefined) {
      return fail("OwnerAmountExceedsCapacity", `${leg.claimId} is not a selected owner claim.`);
    }

    const requested = positiveExact(leg.amountMinor, input.currencyScale, `${leg.claimId} leg`);

    if (Result.isFailure(requested)) return Result.fail(requested.failure);

    if (requested.success > BigInt(remaining)) {
      return fail(
        "OwnerAmountExceedsCapacity",
        `${leg.claimId} leg ${amount(requested.success)} exceeds its remaining ${remaining}.`,
      );
    }

    total += requested.success;
    legs.push({
      claimId: leg.claimId,
      amountMinor: amount(requested.success),
      remainingAfterMinor: amount(BigInt(remaining) - requested.success),
    });
  }

  const balanced = assertBalancedOwnerJournal([
    {
      accountId: input.ownerLiabilityAccountId,
      debitMinor: amount(total),
      creditMinor: "0",
      description: input.description,
    },
    {
      accountId: input.cashAccountId,
      debitMinor: "0",
      creditMinor: amount(total),
      description: input.description,
    },
  ]);

  if (Result.isFailure(balanced)) return Result.fail(balanced.failure);

  return Result.succeed({
    totalMinor: amount(total),
    legs,
    journal: [...balanced.success],
  });
}

export const FundingInput = Schema.Struct({
  currencyScale: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(6)),
  cashAccountId: Identifier,
  liabilityAccountId: Identifier,
  amountMinor: MinorUnits,
  legalForm: FundingLegalForm,
  description: Description,
});

export type FundingInput = typeof FundingInput.Type;

export const FundingPlan = Schema.Struct({
  amountMinor: MinorUnits,
  legalForm: Schema.Literals([
    "shareholder_loan",
    "conditional_contribution",
    "unconditional_contribution",
  ]),
  ownerClassification: OwnerClassification,
  journal: Schema.Array(OwnerJournalLine).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
});

export type FundingPlan = typeof FundingPlan.Type;

const fundingClassifications = new Map<FundingLegalForm, OwnerClassification>([
  ["shareholder_loan", "shareholder_loan"],
  ["conditional_contribution", "conditional_contribution"],
  ["unconditional_contribution", "unconditional_contribution"],
]);

// A reviewed company cash inflow. A loan creates a principal obligation and its
// interest is a separate, unsupported question. A supported contribution credits
// the reviewed equity role and is not reimbursable. An unresolved classification
// produces no financial plan at all.
export function compileOwnerFunding(input: FundingInput): Checked<FundingPlan> {
  if (input.cashAccountId === input.liabilityAccountId) {
    return fail("UnsupportedOwnerTreatment", "A funding inflow needs two distinct accounts.");
  }

  if (input.legalForm === "unresolved") {
    return fail(
      "UnsupportedOwnerTreatment",
      "An unresolved funding classification produces evidence only, never a financial plan.",
    );
  }

  const classification = fundingClassifications.get(input.legalForm);

  if (classification === undefined) {
    return fail(
      "UnsupportedOwnerTreatment",
      "The reviewed funding classification is not supported.",
    );
  }

  const funded = positiveExact(input.amountMinor, input.currencyScale, "The funded amount");

  if (Result.isFailure(funded)) return Result.fail(funded.failure);

  const balanced = assertBalancedOwnerJournal([
    {
      accountId: input.cashAccountId,
      debitMinor: amount(funded.success),
      creditMinor: "0",
      description: input.description,
    },
    {
      accountId: input.liabilityAccountId,
      debitMinor: "0",
      creditMinor: amount(funded.success),
      description: input.description,
    },
  ]);

  if (Result.isFailure(balanced)) return Result.fail(balanced.failure);

  return Result.succeed({
    amountMinor: amount(funded.success),
    legalForm: input.legalForm,
    ownerClassification: classification,
    journal: [...balanced.success],
  });
}
