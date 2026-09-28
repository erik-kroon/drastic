import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure invoice-linked prepayment and accrued-cost math. NEXT-31 leaf: exact
// schedule allocation from reviewed service coverage, accrual decisions,
// and invoice resolution with signed true-ups.
//
// The expense cost excludes deductible input VAT, and deferring cost changes
// expense timing only, never VAT tax-point attribution. A valid tax invoice
// does not prove service dates; start/end arrive as reviewed inputs. No
// implicit daily proration applies when the reviewed policy uses equal
// months or explicit contractual weights. The schedule owner, persistence
// and approvals stay with the subledger/application owners.

export const PrepaymentFailureCode = Schema.Literals([
  "InvalidServicePeriod",
  "NonPositiveAmount",
  "AllocationMismatch",
  "IncompleteCoverage",
  "DuplicateResolution",
  "EstimateBelowRecognized",
  "UnbalancedJournal",
  "UnsupportedPolicy",
]);

export type PrepaymentFailureCode = typeof PrepaymentFailureCode.Type;

export const PrepaymentFailure = Schema.Struct({
  code: PrepaymentFailureCode,
  message: Description,
});

export type PrepaymentFailure = typeof PrepaymentFailure.Type;

export type Checked<A> = Result.Result<A, PrepaymentFailure>;

function fail(code: PrepaymentFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const AllocationPolicy = Schema.Literals(["daily", "equal_months", "contractual_weights"]);

export type AllocationPolicy = typeof AllocationPolicy.Type;

export const ResidualPolicy = Schema.Literals(["first_installment", "last_installment"]);

export type ResidualPolicy = typeof ResidualPolicy.Type;

export const ServicePeriod = Schema.Struct({
  periodId: Identifier,
  startsOn: AccountingDate,
  endsOnExclusive: AccountingDate,
});

export type ServicePeriod = typeof ServicePeriod.Type;

export const Installment = Schema.Struct({
  periodId: Identifier,
  shareMinor: MinorUnits,
  consumed: Schema.Boolean,
});

export type Installment = typeof Installment.Type;

// Exact allocation of a cost over weights with a selected residual policy.
// The designated installment absorbs the remainder so the shares sum to the
// cost exactly; zero shares are retained, never dropped.
export function allocateByWeights(
  costMinor: string,
  weights: ReadonlyArray<bigint>,
  residual: ResidualPolicy,
): Checked<ReadonlyArray<string>> {
  const cost = BigInt(costMinor);

  if (cost <= 0n) {
    return fail("NonPositiveAmount", "An allocated cost must be positive.");
  }

  if (weights.length === 0 || weights.some((weight) => weight < 0n)) {
    return fail("AllocationMismatch", "Allocation needs a nonempty set of nonnegative weights.");
  }

  const total = weights.reduce((sum, weight) => sum + weight, 0n);

  if (total <= 0n) {
    return fail("AllocationMismatch", "Allocation weights must sum to a positive total.");
  }

  const base = weights.map((weight) => (cost * weight) / total);
  const assigned = base.reduce((sum, part) => sum + part, 0n);
  const remainder = cost - assigned;
  const shares = [...base];

  const index =
    residual === "first_installment"
      ? shares.findIndex((_share, position) => weights[position]! > 0n)
      : findLastPositiveIndex(weights);

  if (index < 0 || index >= shares.length) {
    return fail("AllocationMismatch", "No positive weight can absorb the residual.");
  }

  shares[index] = shares[index]! + remainder;

  if (shares.reduce((sum, share) => sum + share, 0n) !== cost) {
    return fail("AllocationMismatch", "Installment shares must sum to the cost exactly.");
  }

  return Result.succeed(shares.map((share) => share.toString()));
}

function findLastPositiveIndex(weights: ReadonlyArray<bigint>) {
  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if (weights[index]! > 0n) return index;
  }

  return -1;
}

function dayCount(fromInclusive: string, toExclusive: string) {
  const milliseconds =
    Date.parse(`${toExclusive}T00:00:00Z`) - Date.parse(`${fromInclusive}T00:00:00Z`);

  return BigInt(Math.round(milliseconds / 86400000));
}

function periodWeight(
  period: ServicePeriod,
  serviceStartOn: string,
  serviceEndOnExclusive: string,
) {
  const start = period.startsOn > serviceStartOn ? period.startsOn : serviceStartOn;

  const end =
    period.endsOnExclusive < serviceEndOnExclusive ? period.endsOnExclusive : serviceEndOnExclusive;

  return end > start ? dayCount(start, end) : 0n;
}

export const PrepaymentInput = Schema.Struct({
  costMinor: MinorUnits,
  serviceStartOn: AccountingDate,
  serviceEndOnExclusive: AccountingDate,
  cutoffOn: AccountingDate,
  policy: AllocationPolicy,
  residual: ResidualPolicy,
  contractualWeights: Schema.Array(Schema.String.check(Schema.isPattern(/^[0-9]+$/))).check(
    Schema.isMaxLength(120),
  ),
  periods: Schema.Array(ServicePeriod).check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  prepaidAccountId: Identifier,
  expenseAccountId: Identifier,
});

export type PrepaymentInput = typeof PrepaymentInput.Type;

export const PrepaymentPlan = Schema.Struct({
  costMinor: MinorUnits,
  recognizedNowMinor: MinorUnits,
  futureMinor: MinorUnits,
  installments: Schema.Array(Installment),
});

export type PrepaymentPlan = typeof PrepaymentPlan.Type;

// An exact schedule from reviewed service coverage. Periods fully consumed
// at the cutoff recognize now; the future balance defers to prepaid with no
// payable, cash or VAT fact.
export function compilePrepayment(input: PrepaymentInput): Checked<PrepaymentPlan> {
  if (input.serviceEndOnExclusive <= input.serviceStartOn) {
    return fail("InvalidServicePeriod", "The service end must be after the service start.");
  }

  const seen = new Set<string>();

  for (const period of input.periods) {
    if (seen.has(period.periodId)) {
      return fail("AllocationMismatch", `${period.periodId} appears twice.`);
    }

    seen.add(period.periodId);

    if (period.endsOnExclusive <= period.startsOn) {
      return fail("InvalidServicePeriod", `Period ${period.periodId} ends before it starts.`);
    }
  }

  let weights: Array<bigint>;

  if (input.policy === "equal_months") {
    weights = input.periods.map(() => 1n);
  } else if (input.policy === "contractual_weights") {
    if (input.contractualWeights.length !== input.periods.length) {
      return fail("UnsupportedPolicy", "Contractual weights must cover every period.");
    }

    weights = input.contractualWeights.map((weight) => BigInt(weight));
  } else {
    weights = input.periods.map((period) =>
      periodWeight(period, input.serviceStartOn, input.serviceEndOnExclusive),
    );
  }

  const allocated = allocateByWeights(input.costMinor, weights, input.residual);

  if (Result.isFailure(allocated)) {
    return Result.fail(allocated.failure);
  }

  const installments: Array<Installment> = [];
  let recognized = 0n;

  input.periods.forEach((period, index) => {
    const share = BigInt(allocated.success[index]!);
    const consumed = period.endsOnExclusive <= input.cutoffOn;

    if (consumed) recognized += share;

    installments.push({
      periodId: period.periodId,
      shareMinor: share.toString(),
      consumed,
    });
  });

  const cost = BigInt(input.costMinor);

  return Result.succeed({
    costMinor: input.costMinor,
    recognizedNowMinor: amount(recognized),
    futureMinor: amount(cost - recognized),
    installments,
  });
}

export const AccrualInput = Schema.Struct({
  expectedCostMinor: MinorUnits,
  evidenceId: Identifier,
  expenseAccountId: Identifier,
  accruedLiabilityAccountId: Identifier,
});

export type AccrualInput = typeof AccrualInput.Type;

// An evidenced service already received with a reviewed supported estimate.
// No deductible VAT fact exists without qualified supporting tax evidence,
// so none is created here.
export function compileAccrual(input: AccrualInput): Checked<{
  readonly expectedMinor: string;
  readonly journal: ReadonlyArray<{
    readonly accountId: string;
    readonly debitMinor: string;
    readonly creditMinor: string;
    readonly description: string;
  }>;
}> {
  const expected = BigInt(input.expectedCostMinor);

  if (expected <= 0n) {
    return fail("NonPositiveAmount", "An accrual needs a positive expected cost.");
  }

  return Result.succeed({
    expectedMinor: amount(expected),
    journal: [
      {
        accountId: input.expenseAccountId,
        debitMinor: amount(expected),
        creditMinor: "0",
        description: "Accrue expected service cost",
      },
      {
        accountId: input.accruedLiabilityAccountId,
        debitMinor: "0",
        creditMinor: amount(expected),
        description: "Accrued service liability",
      },
    ],
  });
}

export const AccrualResolutionInput = Schema.Struct({
  accrualId: Identifier,
  accrualRemainingMinor: MinorUnits,
  consumedAccrualMinor: MinorUnits,
  actualNetMinor: MinorUnits,
  deductibleTaxMinor: MinorUnits,
  resolutionId: Identifier,
  knownResolutionIds: Schema.Array(Identifier),
  expenseAccountId: Identifier,
  taxAccountId: Identifier,
  payableAccountId: Identifier,
  accruedLiabilityAccountId: Identifier,
});

export type AccrualResolutionInput = typeof AccrualResolutionInput.Type;

// Resolving an accrual with the actual invoice: release the consumed
// liability, post the signed expense true-up (a credit on overestimate,
// never a plug) and the qualified deductible tax, and recognize the payable.
export function resolveAccrualWithInvoice(input: AccrualResolutionInput): Checked<{
  readonly trueUpMinor: string;
  readonly journal: ReadonlyArray<{
    readonly accountId: string;
    readonly debitMinor: string;
    readonly creditMinor: string;
    readonly description: string;
  }>;
}> {
  if (input.knownResolutionIds.includes(input.resolutionId)) {
    return fail(
      "DuplicateResolution",
      "This invoice already resolved the accrual; a second resolution refuses.",
    );
  }

  const remaining = BigInt(input.accrualRemainingMinor);
  const consumed = BigInt(input.consumedAccrualMinor);
  const actual = BigInt(input.actualNetMinor);
  const tax = BigInt(input.deductibleTaxMinor);

  if (actual < 0n || tax < 0n) {
    return fail("NonPositiveAmount", "Actual cost and deductible tax cannot be negative.");
  }

  if (consumed < 0n || consumed > remaining) {
    return fail("IncompleteCoverage", "Consumed accrual must stay within the remaining accrual.");
  }

  // The signed true-up: positive debits expense on underestimate, negative
  // credits it on overestimate.
  const trueUp = actual - consumed;
  const payable = actual + tax;

  if (payable <= 0n) {
    return fail("NonPositiveAmount", "A resolution needs a positive recognized payable.");
  }

  const journal = [
    {
      accountId: input.accruedLiabilityAccountId,
      debitMinor: amount(consumed),
      creditMinor: "0",
      description: `Release accrual ${input.accrualId}`,
    },
    ...(trueUp > 0n
      ? [
          {
            accountId: input.expenseAccountId,
            debitMinor: amount(trueUp),
            creditMinor: "0",
            description: `Accrual underestimate ${input.accrualId}`,
          },
        ]
      : []),
    ...(trueUp < 0n
      ? [
          {
            accountId: input.expenseAccountId,
            debitMinor: "0",
            creditMinor: amount(-trueUp),
            description: `Accrual overestimate ${input.accrualId}`,
          },
        ]
      : []),
    ...(tax > 0n
      ? [
          {
            accountId: input.taxAccountId,
            debitMinor: amount(tax),
            creditMinor: "0",
            description: `Deductible input VAT ${input.accrualId}`,
          },
        ]
      : []),
    {
      accountId: input.payableAccountId,
      debitMinor: "0",
      creditMinor: amount(payable),
      description: `Supplier payable ${input.accrualId}`,
    },
  ];

  const balance = journal.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  if (balance !== 0n) {
    return fail("UnbalancedJournal", "Resolution lines must balance exactly.");
  }

  return Result.succeed({ trueUpMinor: amount(trueUp), journal });
}

// Estimate changes affect only future unrecognized cost through an approved
// revision; past recognized expense stays historical.
export function revisePrepaymentEstimate(
  costMinor: string,
  recognizedMinor: string,
  newTotalMinor: string,
): Checked<{ readonly futureMinor: string }> {
  const recognized = BigInt(recognizedMinor);
  const revised = BigInt(newTotalMinor);

  if (recognized < 0n || recognized > BigInt(costMinor)) {
    return fail("IncompleteCoverage", "Recognized cost is outside the original cost.");
  }

  if (revised < recognized) {
    return fail(
      "EstimateBelowRecognized",
      "A revised estimate cannot go below the already recognized cost.",
    );
  }

  return Result.succeed({ futureMinor: amount(revised - recognized) });
}
