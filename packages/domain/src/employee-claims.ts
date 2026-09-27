import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import { CurrencyCode } from "./exchange-rates";

// Pure employee expense-claim workflow math. NEXT-33 leaf: item review with
// one financial meaning per economic component, an exclusive payout route,
// and the correction boundary.
//
// NEXT-06 concerns owners; this concerns employees. A claim never creates a
// second purchase recognition for the same receipt: an already-recognized
// payable transfers to the employee liability with no new cost or tax, an
// unrecognized item routes through the existing purchase compiler (whose
// reviewed output arrives as input here), and a company-paid card charge
// creates no employee liability at all. NEXT-03's qualified deduction
// decision stays authoritative; a tax amount on an image alone never
// creates VAT. Posting, payroll execution and payment instruction remain
// with their owners.

export const ClaimFailureCode = Schema.Literals([
  "ComponentConflict",
  "UnsupportedItemState",
  "NonPositiveAmount",
  "CapacityExceeded",
  "DuplicateRoute",
  "UnknownPriorOutcome",
  "UnreleasedPriorRoute",
  "IrreversibleAfterPayment",
  "UnbalancedJournal",
]);

export type ClaimFailureCode = typeof ClaimFailureCode.Type;

export const ClaimFailure = Schema.Struct({
  code: ClaimFailureCode,
  message: Description,
});

export type ClaimFailure = typeof ClaimFailure.Type;

export type Checked<A> = Result.Result<A, ClaimFailure>;

function fail(code: ClaimFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

// The reviewed state of one submitted item. Exactly one meaning applies:
// a transfer of an existing payable, a new recognition through the purchase
// compiler, an already-funded conflict, a company-paid charge with no
// employee meaning, or a rejection that leaves source history only.
export const ClaimItemState = Schema.Literals([
  "recognized_payable",
  "unrecognized",
  "already_funded",
  "company_paid",
  "rejected",
]);

export type ClaimItemState = typeof ClaimItemState.Type;

export const ClaimItem = Schema.Struct({
  componentKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  state: ClaimItemState,
  // Reviewed purchase-compiler output for unrecognized items: net expense,
  // deductible tax and non-deductible tax. Other states ignore it.
  netMinor: MinorUnits,
  deductibleTaxMinor: MinorUnits,
  nonDeductibleTaxMinor: MinorUnits,
  // True for taxable cash allowances, which follow the payroll tax profile
  // and stay outside the tax-free claim capacity.
  taxableAllowance: Schema.Boolean,
  conflictResolutionRef: Schema.NullOr(Identifier),
});

export type ClaimItem = typeof ClaimItem.Type;

export const ClaimReviewInput = Schema.Struct({
  claimId: Identifier,
  employeeId: Identifier,
  currency: CurrencyCode,
  items: Schema.Array(ClaimItem).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  knownComponentKeys: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
});

export type ClaimReviewInput = typeof ClaimReviewInput.Type;

export const ReviewedItem = Schema.Struct({
  componentKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  reimbursableMinor: MinorUnits,
  allowanceMinor: MinorUnits,
  transferMinor: MinorUnits,
});

export type ReviewedItem = typeof ReviewedItem.Type;

export const ClaimDecision = Schema.Struct({
  claimId: Identifier,
  reimbursableMinor: MinorUnits,
  allowanceMinor: MinorUnits,
  transferMinor: MinorUnits,
  items: Schema.Array(ReviewedItem),
});

export type ClaimDecision = typeof ClaimDecision.Type;

// Reviewing a claim separates reimbursable cost from taxable allowances and
// fixes each component's single financial meaning. The same receipt
// component under another claim is an existing-recognition conflict.
export function reviewClaim(input: ClaimReviewInput): Checked<ClaimDecision> {
  const seen = new Set<string>();
  const items: Array<ReviewedItem> = [];
  let reimbursable = 0n;
  let allowance = 0n;
  let transfer = 0n;

  for (const item of input.items) {
    if (seen.has(item.componentKey) || input.knownComponentKeys.includes(item.componentKey)) {
      return fail(
        "ComponentConflict",
        `Component ${item.componentKey} is already recognized or submitted.`,
      );
    }

    seen.add(item.componentKey);

    const net = BigInt(item.netMinor);
    const deductible = BigInt(item.deductibleTaxMinor);
    const nonDeductible = BigInt(item.nonDeductibleTaxMinor);

    if (net < 0n || deductible < 0n || nonDeductible < 0n) {
      return fail("NonPositiveAmount", `Item ${item.componentKey} carries a negative amount.`);
    }

    if (item.state === "rejected" || item.state === "company_paid") {
      items.push({
        componentKey: item.componentKey,
        reimbursableMinor: "0",
        allowanceMinor: "0",
        transferMinor: "0",
      });
      continue;
    }

    if (item.state === "already_funded" && item.conflictResolutionRef === null) {
      return fail(
        "ComponentConflict",
        `Item ${item.componentKey} is already funded and needs conflict resolution.`,
      );
    }

    if (item.state === "already_funded") {
      items.push({
        componentKey: item.componentKey,
        reimbursableMinor: "0",
        allowanceMinor: "0",
        transferMinor: "0",
      });
      continue;
    }

    const gross = net + deductible + nonDeductible;

    if (gross <= 0n) {
      return fail("NonPositiveAmount", `Item ${item.componentKey} recognizes nothing.`);
    }

    if (item.taxableAllowance) {
      allowance += gross;
      items.push({
        componentKey: item.componentKey,
        reimbursableMinor: "0",
        allowanceMinor: amount(gross),
        transferMinor: "0",
      });
      continue;
    }

    if (item.state === "recognized_payable") {
      transfer += gross;
      items.push({
        componentKey: item.componentKey,
        reimbursableMinor: "0",
        allowanceMinor: "0",
        transferMinor: amount(gross),
      });
      continue;
    }

    reimbursable += gross;
    items.push({
      componentKey: item.componentKey,
      reimbursableMinor: amount(gross),
      allowanceMinor: "0",
      transferMinor: "0",
    });
  }

  return Result.succeed({
    claimId: input.claimId,
    reimbursableMinor: amount(reimbursable),
    allowanceMinor: amount(allowance),
    transferMinor: amount(transfer),
    items,
  });
}

export const PayoutRouteKind = Schema.Literals(["direct_payable", "payroll"]);

export type PayoutRouteKind = typeof PayoutRouteKind.Type;

export const PayoutRouteInput = Schema.Struct({
  claimId: Identifier,
  employeeId: Identifier,
  currency: CurrencyCode,
  reimbursableMinor: MinorUnits,
  liabilityMinor: MinorUnits,
  kind: PayoutRouteKind,
  knownRouteKinds: Schema.Array(PayoutRouteKind),
  // For a payroll route the instruction references this existing
  // reimbursement liability; payroll books no new expense or liability.
  payrollInstructionRef: Schema.NullOr(Identifier),
});

export type PayoutRouteInput = typeof PayoutRouteInput.Type;

export const PayoutRoute = Schema.Struct({
  claimId: Identifier,
  kind: PayoutRouteKind,
  amountMinor: MinorUnits,
  booksNewExpense: Schema.Boolean,
  instructionRef: Schema.NullOr(Identifier),
});

export type PayoutRoute = typeof PayoutRoute.Type;

// Exactly one active financial handoff per approved reimbursable component.
// Payroll carries the reimbursement on the payslip as cash against the
// existing liability; only a direct payable instructs fresh payment.
export function selectPayoutRoute(input: PayoutRouteInput): Checked<PayoutRoute> {
  if (input.knownRouteKinds.includes(input.kind)) {
    return fail("DuplicateRoute", "This payout route already exists for the claim.");
  }

  const reimbursable = BigInt(input.reimbursableMinor);
  const liability = BigInt(input.liabilityMinor);

  if (reimbursable <= 0n || reimbursable > liability) {
    return fail(
      "CapacityExceeded",
      "The routed amount must stay within the employee liability.",
    );
  }

  if (input.kind === "payroll" && input.payrollInstructionRef === null) {
    return fail("UnknownPriorOutcome", "A payroll route needs its instruction reference.");
  }

  return Result.succeed({
    claimId: input.claimId,
    kind: input.kind,
    amountMinor: amount(reimbursable),
    booksNewExpense: false,
    instructionRef: input.kind === "payroll" ? input.payrollInstructionRef : null,
  });
}

export const RouteReplacementInput = Schema.Struct({
  claimId: Identifier,
  priorKind: PayoutRouteKind,
  priorUnexecuted: Schema.Boolean,
  priorReleased: Schema.Boolean,
  priorOutcomeKnown: Schema.Boolean,
  replacementKind: PayoutRouteKind,
});

export type RouteReplacementInput = typeof RouteReplacementInput.Type;

// A route changes only when the prior destination proves its component
// unexecuted and unreserved, or provides a valid cancellation. An unknown
// payroll or payment outcome blocks a second instruction; queue
// cancellation alone never suffices.
export function replacePayoutRoute(
  input: RouteReplacementInput,
): Checked<{ readonly kind: PayoutRouteKind }> {
  if (!input.priorOutcomeKnown) {
    return fail(
      "UnknownPriorOutcome",
      "An unknown prior outcome blocks another route; no second instruction.",
    );
  }

  if (!input.priorUnexecuted || !input.priorReleased) {
    return fail(
      "UnreleasedPriorRoute",
      "The prior route is executed or still reserved and cannot be replaced.",
    );
  }

  if (input.priorKind === input.replacementKind) {
    return fail("DuplicateRoute", "The replacement repeats the prior route.");
  }

  return Result.succeed({ kind: input.replacementKind });
}

export const ClaimCorrectionInput = Schema.Struct({
  claimId: Identifier,
  reimbursedMinor: MinorUnits,
  overpaidMinor: MinorUnits,
  dependentFiling: Schema.Boolean,
  laterSettlement: Schema.Boolean,
});

export type ClaimCorrectionInput = typeof ClaimCorrectionInput.Type;

// Before payment the complete aggregate reverses; after reimbursement an
// overpaid amount becomes a separately reviewed employee receivable or a
// legally supported future offset, never a negative new expense claim.
export function correctClaim(
  input: ClaimCorrectionInput,
): Checked<{ readonly reversibleMinor: string; readonly employeeReceivableMinor: string }> {
  const reimbursed = BigInt(input.reimbursedMinor);
  const overpaid = BigInt(input.overpaidMinor);

  if (overpaid < 0n) {
    return fail("NonPositiveAmount", "An overpayment cannot be negative.");
  }

  if (reimbursed > 0n || input.dependentFiling || input.laterSettlement) {
    if (overpaid === 0n) {
      return fail(
        "IrreversibleAfterPayment",
        "A paid claim with no overpayment needs an owning correction.",
      );
    }

    return Result.succeed({ reversibleMinor: "0", employeeReceivableMinor: amount(overpaid) });
  }

  return Result.succeed({ reversibleMinor: amount(reimbursed), employeeReceivableMinor: "0" });
}
