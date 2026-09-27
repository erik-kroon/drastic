import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import {
  assertBalancedJournal,
  compilePurchaseCreditLines,
  PurchaseCreditInput,
  PurchaseCreditLineRelease,
  PurchaseTaxFact,
  type PurchaseJournalLine,
} from "./purchasing";

// Pure paid-credit and refund-receipt math for one supplier obligation.
// NEXT-07 leaf: the existing unpaid credit path refuses amounts above the
// unpaid residual, so a credit beyond unpaid capacity and the later cash
// refund against the resulting refund receivable are compiled here.
//
// No database, no runtime, no FX, no advances and no general netting. Every
// position input (original gross, cumulative credits, allocated payments,
// allocated refunds) arrives as a reviewed exact amount; the application owns
// reading them from recognition, credit, allocation and refund history. A
// bound failure is an error rather than a truncation or a partial posting.

export const RefundFailureCode = Schema.Literals([
  "CreditExceedsOriginal",
  "PaymentExceedsOriginal",
  "RefundExceedsPrincipal",
  "InsufficientLineCapacity",
  "ExportReservationUnresolved",
  "DuplicateCreditIdentity",
  "UnbalancedJournal",
  "NonPositiveRefund",
  "RefundCapacityExceeded",
  "UnsupportedRefundSource",
  "UnsupportedConsumedHistory",
]);

export type RefundFailureCode = typeof RefundFailureCode.Type;

export const RefundFailure = Schema.Struct({
  code: RefundFailureCode,
  message: Description,
});

export type RefundFailure = typeof RefundFailure.Type;

export type Checked<A> = Result.Result<A, RefundFailure>;

function fail(code: RefundFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function refuse<A>(result: Checked<A>): Checked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("UnbalancedJournal", "A checked stage unexpectedly succeeded.");
}

function amount(value: bigint) {
  return value.toString();
}

// G = original gross obligation, K = effective cumulative credits,
// P = effective payments allocated under this bounded profile,
// Q = refunds already allocated to the linked refund receivable.
export const PaidPositionInput = Schema.Struct({
  originalGrossMinor: MinorUnits,
  creditedMinor: MinorUnits,
  paidMinor: MinorUnits,
  refundedMinor: MinorUnits,
});

export type PaidPositionInput = typeof PaidPositionInput.Type;

export const PaidPosition = Schema.Struct({
  unpaidMinor: MinorUnits,
  refundPrincipalMinor: MinorUnits,
  refundDueMinor: MinorUnits,
});

export type PaidPosition = typeof PaidPosition.Type;

// State is derived from immutable effects, never stored as a negative
// outstanding: the refund receivable is its own explicit projection.
export function derivePaidPosition(input: PaidPositionInput): Checked<PaidPosition> {
  const g = BigInt(input.originalGrossMinor);
  const k = BigInt(input.creditedMinor);
  const p = BigInt(input.paidMinor);
  const q = BigInt(input.refundedMinor);

  if (k < 0n || k > g) {
    return fail(
      "CreditExceedsOriginal",
      "Effective credits must stay within the original gross obligation.",
    );
  }

  // A pre-existing overpayment needs its own admission; this bounded profile
  // does not admit payments above the original gross.
  if (p < 0n || p > g) {
    return fail(
      "PaymentExceedsOriginal",
      "Allocated payments must stay within the original gross obligation.",
    );
  }

  const netOwed = g - k;
  const refundPrincipal = p > netOwed ? p - netOwed : 0n;
  const unpaid = p >= netOwed ? 0n : netOwed - p;

  if (q < 0n || q > refundPrincipal) {
    return fail(
      "RefundExceedsPrincipal",
      "Allocated refunds must stay within the refund principal.",
    );
  }

  return Result.succeed({
    unpaidMinor: amount(unpaid),
    refundPrincipalMinor: amount(refundPrincipal),
    refundDueMinor: amount(refundPrincipal - q),
  });
}

export const CreditNoteIdentity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);

export const PaidSupplierCreditInput = Schema.Struct({
  ...PurchaseCreditInput.fields,
  payableControlAccountId: Identifier,
  // An explicit reviewed refund-receivable role, never an inferred account
  // and never a negative payable.
  refundReceivableAccountId: Identifier,
  // NEXT-08 is conditional: an exported instruction still reserving any of
  // the affected payable refuses the paid credit until it is resolved.
  reservedMinor: MinorUnits,
  position: PaidPositionInput,
  creditNoteIdentity: CreditNoteIdentity,
  knownCreditNoteIdentities: Schema.Array(CreditNoteIdentity),
});

export type PaidSupplierCreditInput = typeof PaidSupplierCreditInput.Type;

export const PaidSupplierCreditPlan = Schema.Struct({
  currencyScale: PurchaseCreditInput.fields.currencyScale,
  creditGrossMinor: MinorUnits,
  apReleaseMinor: MinorUnits,
  refundPrincipalIncreaseMinor: MinorUnits,
  lines: Schema.Array(PurchaseCreditLineRelease),
  taxAdjustments: Schema.Array(PurchaseTaxFact),
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Identifier),
      accountId: Identifier,
      debitMinor: MinorUnits,
      creditMinor: MinorUnits,
      description: Description,
    }),
  ),
  positionAfter: PaidPosition,
});

export type PaidSupplierCreditPlan = typeof PaidSupplierCreditPlan.Type;

function addSigned(
  lines: Array<PurchaseJournalLine>,
  line: {
    readonly sourceLineId: string | null;
    readonly accountId: string;
    readonly signedMinor: bigint;
    readonly description: string;
  },
) {
  if (line.signedMinor === 0n) return;

  lines.push({
    sourceLineId: line.sourceLineId,
    accountId: line.accountId,
    debitMinor: amount(line.signedMinor > 0n ? line.signedMinor : 0n),
    creditMinor: amount(line.signedMinor < 0n ? -line.signedMinor : 0n),
    description: line.description,
  });
}

// A credit beyond unpaid capacity: the unpaid part releases the payable and
// the remainder raises an explicit refund receivable, within the original
// line and tax limits. A full paid credit is allowed; an over-capacity
// credit is refused whole, never posted partially.
export function compilePaidSupplierCredit(
  input: PaidSupplierCreditInput,
): Checked<PaidSupplierCreditPlan> {
  if (input.knownCreditNoteIdentities.includes(input.creditNoteIdentity)) {
    return fail(
      "DuplicateCreditIdentity",
      "A new key for the same credit-note identity is already applied, not another refund entitlement.",
    );
  }

  if (BigInt(input.reservedMinor) !== 0n) {
    return fail(
      "ExportReservationUnresolved",
      "An unresolved export reservation over the affected payable refuses the paid credit.",
    );
  }

  const creditInput: PurchaseCreditInput = {
    currencyScale: input.currencyScale,
    taxPoint: input.taxPoint,
    reportingObligationId: input.reportingObligationId,
    ruleReleaseId: input.ruleReleaseId,
    taxComponentPrefix: input.taxComponentPrefix,
    creditEvidence: input.creditEvidence,
    original: input.original,
    requested: input.requested,
  };

  const compiled = compilePurchaseCreditLines(creditInput);

  if (Result.isFailure(compiled)) {
    return fail("InsufficientLineCapacity", compiled.failure.message);
  }

  const releases = compiled.success;
  const g = BigInt(releases.creditGrossMinor);

  const remainingCapacity = input.original.reduce(
    (total, line) =>
      total +
      (BigInt(line.originalNetMinor) - BigInt(line.creditedNetMinor)) +
      (BigInt(line.originalSourceTaxMinor) - BigInt(line.creditedSourceTaxMinor)),
    0n,
  );

  if (g > remainingCapacity) {
    return fail(
      "InsufficientLineCapacity",
      "The credit gross exceeds the remaining original-line gross capacity.",
    );
  }

  const before = derivePaidPosition(input.position);

  if (Result.isFailure(before)) return refuse(before);

  const unpaid = BigInt(before.success.unpaidMinor);
  const refundPrincipal = BigInt(before.success.refundPrincipalMinor);
  const apRelease = g < unpaid ? g : unpaid;
  const newRefund = g - apRelease;

  // Conservation: the raised principal must equal the overpayment implied by
  // the new cumulative credit total.
  const k = BigInt(input.position.creditedMinor);
  const p = BigInt(input.position.paidMinor);
  const gg = BigInt(input.position.originalGrossMinor);
  const implied = p - (gg - (k + g));
  const expectedPrincipal = implied > 0n ? implied : 0n;

  if (refundPrincipal + newRefund !== expectedPrincipal) {
    return fail(
      "UnbalancedJournal",
      "The refund principal increase does not conserve the paid position.",
    );
  }

  const journal: Array<PurchaseJournalLine> = [];

  addSigned(journal, {
    sourceLineId: null,
    accountId: input.payableControlAccountId,
    signedMinor: apRelease,
    description: "Reduce supplier payable",
  });
  addSigned(journal, {
    sourceLineId: null,
    accountId: input.refundReceivableAccountId,
    signedMinor: newRefund,
    description: "Supplier refund receivable",
  });

  for (const reversal of releases.reversals) journal.push(reversal);

  const finished = assertBalancedJournal(journal, 2);

  if (Result.isFailure(finished)) return fail("UnbalancedJournal", finished.failure.message);

  const after = derivePaidPosition({
    originalGrossMinor: input.position.originalGrossMinor,
    creditedMinor: amount(k + g),
    paidMinor: input.position.paidMinor,
    refundedMinor: input.position.refundedMinor,
  });

  if (Result.isFailure(after)) return refuse(after);

  return Result.succeed({
    currencyScale: input.currencyScale,
    creditGrossMinor: releases.creditGrossMinor,
    apReleaseMinor: amount(apRelease),
    refundPrincipalIncreaseMinor: amount(newRefund),
    lines: releases.lines,
    taxAdjustments: releases.taxAdjustments,
    journal: finished.success,
    positionAfter: after.success,
  });
}

export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const RefundAllocation = Schema.Struct({
  allocationId: Identifier,
  amountMinor: MinorUnits,
});

export type RefundAllocation = typeof RefundAllocation.Type;

export const RefundSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unposted_cash"),
    currency: CurrencyCode,
    evidenceId: Identifier,
    bankAccountId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("posted_credit"),
    currency: CurrencyCode,
    creditRef: Identifier,
    unusedCapacityMinor: MinorUnits,
  }),
]);

export type RefundSource = typeof RefundSource.Type;

export const SupplierRefundInput = Schema.Struct({
  refundDueMinor: MinorUnits,
  amountMinor: MinorUnits,
  invoiceCurrency: CurrencyCode,
  allocations: Schema.Array(RefundAllocation).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  source: RefundSource,
  refundReceivableAccountId: Identifier,
});

export type SupplierRefundInput = typeof SupplierRefundInput.Type;

export const SupplierRefundPlan = Schema.Struct({
  allocatedMinor: MinorUnits,
  adoptedRef: Schema.NullOr(Identifier),
  journal: Schema.Array(
    Schema.Struct({
      sourceLineId: Schema.NullOr(Identifier),
      accountId: Identifier,
      debitMinor: MinorUnits,
      creditMinor: MinorUnits,
      description: Description,
    }),
  ),
});

export type SupplierRefundPlan = typeof SupplierRefundPlan.Type;

// A refund receipt settles the refund receivable in cash. It posts no
// expense reversal and no additional VAT credit.
export function prepareSupplierRefund(input: SupplierRefundInput): Checked<SupplierRefundPlan> {
  const due = BigInt(input.refundDueMinor);
  const refundAmount = BigInt(input.amountMinor);

  if (refundAmount <= 0n) {
    return fail("NonPositiveRefund", "A supplier refund needs a positive amount.");
  }

  const seen = new Set<string>();
  let allocated = 0n;

  for (const allocation of input.allocations) {
    if (seen.has(allocation.allocationId)) {
      return fail("RefundCapacityExceeded", `${allocation.allocationId} is allocated twice.`);
    }

    seen.add(allocation.allocationId);
    allocated += BigInt(allocation.amountMinor);
  }

  // No partial posting: the whole receipt must fit the refund due.
  if (allocated !== refundAmount || refundAmount > due) {
    return fail(
      "RefundCapacityExceeded",
      "Refund allocations must equal the refund amount within the refund due.",
    );
  }

  if (input.source.currency !== input.invoiceCurrency) {
    return fail(
      "UnsupportedRefundSource",
      "A refund source must be evidenced same-currency cash from the supplier.",
    );
  }

  if (input.source.kind === "posted_credit") {
    if (BigInt(input.source.unusedCapacityMinor) < refundAmount) {
      return fail(
        "UnsupportedRefundSource",
        "The referenced posted refund-control credit has no exact unused capacity.",
      );
    }

    return Result.succeed({
      allocatedMinor: amount(allocated),
      adoptedRef: input.source.creditRef,
      journal: [],
    });
  }

  return Result.succeed({
    allocatedMinor: amount(allocated),
    adoptedRef: null,
    journal: [
      {
        sourceLineId: null,
        accountId: input.source.bankAccountId,
        debitMinor: amount(refundAmount),
        creditMinor: "0",
        description: "Supplier refund cash receipt",
      },
      {
        sourceLineId: null,
        accountId: input.refundReceivableAccountId,
        debitMinor: "0",
        creditMinor: amount(refundAmount),
        description: "Settle supplier refund receivable",
      },
    ],
  });
}

// If a payment is reversed after a refund receivable or cash refund depends
// on it, the standalone reversal is rejected: an owned correction must
// restore the payment, credit and refund relationships together.
export function refuseConsumedHistoryReversal(input: PaidPositionInput): Checked<PaidPosition> {
  const position = derivePaidPosition(input);

  if (Result.isFailure(position)) {
    return fail(
      "UnsupportedConsumedHistory",
      "The reversal leaves a consumed payment, credit and refund history without an owning correction.",
    );
  }

  return position;
}

export const RefundReportCutoff = Schema.Struct({
  accountingOn: AccountingDate,
  recordedCutoff: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
});

export type RefundReportCutoff = typeof RefundReportCutoff.Type;
