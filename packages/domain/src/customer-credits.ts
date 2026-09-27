import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";
import { CurrencyCode } from "./exchange-rates";

// Pure customer-side surplus and paid-credit lifecycle for same-currency
// accrual sales. NEXT-30 leaf: unapplied cash, paid credits beyond unpaid
// AR, credit application to another invoice and cash refunds against the
// customer-credit liability.
//
// NEXT-15 stops at unpaid customer credit principal; NEXT-07 handles
// suppliers. The existing supplier refund math is a calculation reference,
// not a shared register: signs, roles and capacities are stated here.
//
// No database and no runtime. Line-level net/tax compilation stays with the
// legal-credit owner; this leaf takes reviewed per-line credit amounts with
// their original-line capacity bounds and checks them. Money received before
// an identified supply is never silently treated as unapplied cash: without
// a qualified refundable/unapplied classification it refuses toward the
// advance owner. Cash-method sales and foreign-currency credit liabilities
// need their own profiles and refuse here.

export const CustomerCreditFailureCode = Schema.Literals([
  "CreditExceedsOriginal",
  "PaymentExceedsOriginal",
  "RefundExceedsPrincipal",
  "AllocationExceedsCash",
  "AllocationExceedsInvoice",
  "CounterpartyMismatch",
  "UnclassifiedSurplus",
  "InsufficientClearingCapacity",
  "InsufficientLineCapacity",
  "DuplicateCreditIdentity",
  "UnbalancedJournal",
  "NonPositiveAmount",
  "CreditCapacityExceeded",
  "UnsupportedRefundSource",
  "UnsupportedConsumedHistory",
  "UnsupportedProfile",
]);

export type CustomerCreditFailureCode = typeof CustomerCreditFailureCode.Type;

export const CustomerCreditFailure = Schema.Struct({
  code: CustomerCreditFailureCode,
  message: Description,
});

export type CustomerCreditFailure = typeof CustomerCreditFailure.Type;

export type Checked<A> = Result.Result<A, CustomerCreditFailure>;

function fail(code: CustomerCreditFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

// G = original gross, K = effective credits, P = payments applied,
// Q = credit liability already refunded or applied elsewhere.
export const CustomerPositionInput = Schema.Struct({
  originalGrossMinor: MinorUnits,
  creditedMinor: MinorUnits,
  paidMinor: MinorUnits,
  consumedMinor: MinorUnits,
});

export type CustomerPositionInput = typeof CustomerPositionInput.Type;

export const CustomerPosition = Schema.Struct({
  unpaidARMinor: MinorUnits,
  creditPrincipalMinor: MinorUnits,
  remainingCreditMinor: MinorUnits,
});

export type CustomerPosition = typeof CustomerPosition.Type;

export function deriveCustomerPosition(input: CustomerPositionInput): Checked<CustomerPosition> {
  const g = BigInt(input.originalGrossMinor);
  const k = BigInt(input.creditedMinor);
  const p = BigInt(input.paidMinor);
  const q = BigInt(input.consumedMinor);

  if (k < 0n || k > g) {
    return fail(
      "CreditExceedsOriginal",
      "Effective credits must stay within the original gross sale.",
    );
  }

  if (p < 0n || p > g) {
    return fail(
      "PaymentExceedsOriginal",
      "Applied payments must stay within the original gross sale.",
    );
  }

  const netOwed = g - k;
  const creditPrincipal = p > netOwed ? p - netOwed : 0n;
  const unpaid = p >= netOwed ? 0n : netOwed - p;

  if (q < 0n || q > creditPrincipal) {
    return fail("RefundExceedsPrincipal", "Consumed credit must stay within the credit principal.");
  }

  return Result.succeed({
    unpaidARMinor: amount(unpaid),
    creditPrincipalMinor: amount(creditPrincipal),
    remainingCreditMinor: amount(creditPrincipal - q),
  });
}

export const ReceiptLeg = Schema.Struct({
  invoiceId: Identifier,
  amountMinor: MinorUnits,
  invoiceRemainingMinor: MinorUnits,
});

export type ReceiptLeg = typeof ReceiptLeg.Type;

export const SurplusClassification = Schema.Literals(["refundable_overpayment", "unapplied_cash"]);

export type SurplusClassification = typeof SurplusClassification.Type;

export const CustomerReceiptSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("new_cash"),
    bankAccountId: Identifier,
    evidenceId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("adopted_clearing"),
    clearingRef: Identifier,
    unusedCapacityMinor: MinorUnits,
  }),
]);

export type CustomerReceiptSource = typeof CustomerReceiptSource.Type;

export const CustomerReceiptInput = Schema.Struct({
  customerId: Identifier,
  currency: CurrencyCode,
  cashMinor: MinorUnits,
  legs: Schema.Array(ReceiptLeg).check(Schema.isMaxLength(50)),
  surplusClassification: Schema.NullOr(SurplusClassification),
  source: CustomerReceiptSource,
  receivableControlAccountId: Identifier,
  creditLiabilityAccountId: Identifier,
});

export type CustomerReceiptInput = typeof CustomerReceiptInput.Type;

export const CustomerJournalLine = Schema.Struct({
  sourceLineId: Schema.NullOr(Identifier),
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type CustomerJournalLine = typeof CustomerJournalLine.Type;

export const CustomerJournalLines = Schema.Array(CustomerJournalLine);

export type CustomerJournalLines = typeof CustomerJournalLines.Type;

export const CustomerReceiptPlan = Schema.Struct({
  allocatedMinor: MinorUnits,
  creditOriginMinor: MinorUnits,
  adoptedRef: Schema.NullOr(Identifier),
  journal: CustomerJournalLines,
});

export type CustomerReceiptPlan = typeof CustomerReceiptPlan.Type;

type JournalLine = CustomerJournalLine;

function debit(lines: Array<JournalLine>, accountId: string, value: bigint, description: string) {
  if (value === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId,
    debitMinor: amount(value),
    creditMinor: "0",
    description,
  });
}

function credit(lines: Array<JournalLine>, accountId: string, value: bigint, description: string) {
  if (value === 0n) return;

  lines.push({
    sourceLineId: null,
    accountId,
    debitMinor: "0",
    creditMinor: amount(value),
    description,
  });
}

// An incoming customer receipt with explicit invoice legs. The unallocated
// remainder becomes a customer-credit liability only with a qualified
// classification; an unreviewed taxable advance refuses toward its owner.
export function compileCustomerReceipt(input: CustomerReceiptInput): Checked<CustomerReceiptPlan> {
  const g = BigInt(input.cashMinor);

  if (g <= 0n) {
    return fail("NonPositiveAmount", "A customer receipt needs a positive cash amount.");
  }

  const seen = new Set<string>();
  let allocated = 0n;

  for (const leg of input.legs) {
    if (seen.has(leg.invoiceId)) {
      return fail("AllocationExceedsInvoice", `${leg.invoiceId} is allocated twice.`);
    }

    seen.add(leg.invoiceId);

    const legAmount = BigInt(leg.amountMinor);

    if (legAmount <= 0n || legAmount > BigInt(leg.invoiceRemainingMinor)) {
      return fail(
        "AllocationExceedsInvoice",
        `Allocation to ${leg.invoiceId} exceeds its remaining principal.`,
      );
    }

    allocated += legAmount;
  }

  if (allocated > g) {
    return fail("AllocationExceedsCash", "Invoice allocations exceed the incoming cash.");
  }

  const surplus = g - allocated;

  if (surplus > 0n && input.surplusClassification === null) {
    return fail(
      "UnclassifiedSurplus",
      "An unallocated remainder without a qualified classification is a possible advance, not unapplied cash.",
    );
  }

  let adoptedRef: string | null = null;
  const journal: Array<JournalLine> = [];

  if (input.source.kind === "adopted_clearing") {
    if (BigInt(input.source.unusedCapacityMinor) < g) {
      return fail(
        "InsufficientClearingCapacity",
        "The clearing entry has no exact unused capacity for this receipt.",
      );
    }

    adoptedRef = input.source.clearingRef;
  } else {
    debit(journal, input.source.bankAccountId, g, "Customer cash receipt");
  }

  for (const leg of input.legs) {
    credit(
      journal,
      input.receivableControlAccountId,
      BigInt(leg.amountMinor),
      `Settle receivable ${leg.invoiceId}`,
    );
  }

  credit(journal, input.creditLiabilityAccountId, surplus, "Customer credit liability");

  const balance = journal.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  // An adopted clearing receipt carries no new cash debit by construction, so
  // its journal only settles receivables against the liability.
  if (input.source.kind === "new_cash" && balance !== 0n) {
    return fail("UnbalancedJournal", "Receipt lines must balance exactly.");
  }

  return Result.succeed({
    allocatedMinor: amount(allocated),
    creditOriginMinor: amount(surplus),
    adoptedRef,
    journal,
  });
}

export const CreditNoteIdentity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);

export const PaidCreditLine = Schema.Struct({
  sourceLineId: Identifier,
  netMinor: MinorUnits,
  outputTaxMinor: MinorUnits,
  remainingNetMinor: MinorUnits,
  remainingTaxMinor: MinorUnits,
});

export type PaidCreditLine = typeof PaidCreditLine.Type;

export const PaidCustomerCreditInput = Schema.Struct({
  customerId: Identifier,
  currency: CurrencyCode,
  position: CustomerPositionInput,
  lines: Schema.Array(PaidCreditLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  revenueAccountId: Identifier,
  outputVatAccountId: Identifier,
  receivableControlAccountId: Identifier,
  creditLiabilityAccountId: Identifier,
  creditNoteIdentity: CreditNoteIdentity,
  knownCreditNoteIdentities: Schema.Array(CreditNoteIdentity),
});

export type PaidCustomerCreditInput = typeof PaidCustomerCreditInput.Type;

export const PaidCustomerCreditPlan = Schema.Struct({
  creditGrossMinor: MinorUnits,
  arReductionMinor: MinorUnits,
  liabilityIncreaseMinor: MinorUnits,
  journal: CustomerJournalLines,
  positionAfter: CustomerPosition,
});

export type PaidCustomerCreditPlan = typeof PaidCustomerCreditPlan.Type;

// A credit after payment: the unpaid part reduces AR and the remainder
// raises the customer-credit liability. Revenue and output VAT reverse
// exactly once; reducing revenue is not evidence cash was refunded.
export function compilePaidCustomerCredit(
  input: PaidCustomerCreditInput,
): Checked<PaidCustomerCreditPlan> {
  if (input.knownCreditNoteIdentities.includes(input.creditNoteIdentity)) {
    return fail(
      "DuplicateCreditIdentity",
      "A new key for the same credit note is already applied, not another liability.",
    );
  }

  const seen = new Set<string>();
  let gross = 0n;
  let revenue = 0n;
  let outputTax = 0n;

  for (const line of input.lines) {
    if (seen.has(line.sourceLineId)) {
      return fail("InsufficientLineCapacity", `${line.sourceLineId} is credited twice.`);
    }

    seen.add(line.sourceLineId);

    const net = BigInt(line.netMinor);
    const tax = BigInt(line.outputTaxMinor);

    if (net < 0n || tax < 0n || (net === 0n && tax === 0n)) {
      return fail("NonPositiveAmount", `Credit line ${line.sourceLineId} releases nothing.`);
    }

    if (net > BigInt(line.remainingNetMinor) || tax > BigInt(line.remainingTaxMinor)) {
      return fail(
        "InsufficientLineCapacity",
        `Credit line ${line.sourceLineId} exceeds its original capacity.`,
      );
    }

    gross += net + tax;
    revenue += net;
    outputTax += tax;
  }

  if (gross <= 0n) {
    return fail("NonPositiveAmount", "A customer credit needs a positive gross amount.");
  }

  const before = deriveCustomerPosition(input.position);

  if (Result.isFailure(before)) {
    return Result.fail(before.failure);
  }

  const unpaid = BigInt(before.success.unpaidARMinor);
  const principal = BigInt(before.success.creditPrincipalMinor);
  const arReduction = gross < unpaid ? gross : unpaid;
  const liabilityIncrease = gross - arReduction;

  const k = BigInt(input.position.creditedMinor);
  const p = BigInt(input.position.paidMinor);
  const gg = BigInt(input.position.originalGrossMinor);
  const implied = p - (gg - (k + gross));

  if (principal + liabilityIncrease !== (implied > 0n ? implied : 0n)) {
    return fail(
      "UnbalancedJournal",
      "The liability increase does not conserve the customer position.",
    );
  }

  const journal: Array<JournalLine> = [];

  debit(journal, input.revenueAccountId, revenue, "Reverse credited revenue");
  debit(journal, input.outputVatAccountId, outputTax, "Reverse output VAT");
  credit(journal, input.receivableControlAccountId, arReduction, "Reduce customer AR");
  credit(journal, input.creditLiabilityAccountId, liabilityIncrease, "Customer credit liability");

  const balance = journal.reduce(
    (total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor),
    0n,
  );

  if (balance !== 0n) {
    return fail("UnbalancedJournal", "Credit lines must balance exactly.");
  }

  const after = deriveCustomerPosition({
    originalGrossMinor: input.position.originalGrossMinor,
    creditedMinor: amount(k + gross),
    paidMinor: input.position.paidMinor,
    consumedMinor: input.position.consumedMinor,
  });

  if (Result.isFailure(after)) {
    return Result.fail(after.failure);
  }

  return Result.succeed({
    creditGrossMinor: amount(gross),
    arReductionMinor: amount(arReduction),
    liabilityIncreaseMinor: amount(liabilityIncrease),
    journal,
    positionAfter: after.success,
  });
}

export const CreditApplicationInput = Schema.Struct({
  customerId: Identifier,
  currency: CurrencyCode,
  remainingCreditMinor: MinorUnits,
  destinationInvoiceId: Identifier,
  destinationRemainingMinor: MinorUnits,
  amountMinor: MinorUnits,
  creditLiabilityAccountId: Identifier,
  receivableControlAccountId: Identifier,
});

export type CreditApplicationInput = typeof CreditApplicationInput.Type;

// Applying credit to another invoice moves the liability against AR. It
// creates no bank movement and no new VAT fact.
export function applyCustomerCredit(
  input: CreditApplicationInput,
): Checked<{ readonly appliedMinor: string; readonly journal: CustomerJournalLines }> {
  const credit = BigInt(input.remainingCreditMinor);
  const invoice = BigInt(input.destinationRemainingMinor);
  const value = BigInt(input.amountMinor);

  if (value <= 0n) {
    return fail("NonPositiveAmount", "A credit application needs a positive amount.");
  }

  if (value > credit || value > invoice) {
    return fail(
      "CreditCapacityExceeded",
      "The application exceeds the remaining credit or the invoice residual.",
    );
  }

  return Result.succeed({
    appliedMinor: amount(value),
    journal: [
      {
        sourceLineId: null,
        accountId: input.creditLiabilityAccountId,
        debitMinor: amount(value),
        creditMinor: "0",
        description: `Apply credit to ${input.destinationInvoiceId}`,
      },
      {
        sourceLineId: null,
        accountId: input.receivableControlAccountId,
        debitMinor: "0",
        creditMinor: amount(value),
        description: `Settle receivable ${input.destinationInvoiceId}`,
      },
    ],
  });
}

export const CustomerRefundSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("new_payment"),
    bankAccountId: Identifier,
    evidenceId: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal("adopted_clearing"),
    clearingRef: Identifier,
    unusedCapacityMinor: MinorUnits,
  }),
]);

export type CustomerRefundSource = typeof CustomerRefundSource.Type;

export const CustomerRefundInput = Schema.Struct({
  customerId: Identifier,
  currency: CurrencyCode,
  remainingCreditMinor: MinorUnits,
  amountMinor: MinorUnits,
  source: CustomerRefundSource,
  sourceCurrency: CurrencyCode,
  creditLiabilityAccountId: Identifier,
});

export type CustomerRefundInput = typeof CustomerRefundInput.Type;

// A cash refund settles the credit liability. External initiation is
// separately approved and outcome-tracked; an API response alone never posts.
export function recordCustomerRefund(
  input: CustomerRefundInput,
): Checked<{ readonly refundedMinor: string; readonly journal: CustomerJournalLines }> {
  const due = BigInt(input.remainingCreditMinor);
  const value = BigInt(input.amountMinor);

  if (value <= 0n) {
    return fail("NonPositiveAmount", "A customer refund needs a positive amount.");
  }

  if (value > due) {
    return fail("CreditCapacityExceeded", "The refund exceeds the remaining credit.");
  }

  if (input.sourceCurrency !== input.currency) {
    return fail("UnsupportedRefundSource", "A refund needs the same-currency evidence.");
  }

  if (input.source.kind === "adopted_clearing") {
    if (BigInt(input.source.unusedCapacityMinor) < value) {
      return fail(
        "UnsupportedRefundSource",
        "The clearing entry has no exact unused capacity for this refund.",
      );
    }

    return Result.succeed({ refundedMinor: amount(value), journal: [] });
  }

  return Result.succeed({
    refundedMinor: amount(value),
    journal: [
      {
        sourceLineId: null,
        accountId: input.creditLiabilityAccountId,
        debitMinor: amount(value),
        creditMinor: "0",
        description: "Settle customer credit liability",
      },
      {
        sourceLineId: null,
        accountId: input.source.bankAccountId,
        debitMinor: "0",
        creditMinor: amount(value),
        description: "Customer refund cash payment",
      },
    ],
  });
}

// A standalone reversal of an invoice payment that generated subsequently
// consumed credit is refused: the correction must restore the related
// credit, application and refund consequences atomically.
export function refuseConsumedHistoryReversal(
  input: CustomerPositionInput,
): Checked<CustomerPosition> {
  const position = deriveCustomerPosition(input);

  if (Result.isFailure(position)) {
    return fail(
      "UnsupportedConsumedHistory",
      "The reversal leaves a consumed payment, credit and refund history without an owning correction.",
    );
  }

  return position;
}
