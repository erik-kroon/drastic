import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure processor-clearing math for one Stripe account.
// NEXT-39 leaf: gross/fee/refund/payout clearing with exact journals that
// never net a payout as revenue. The application owns fetching, raw
// retention, provider profiles, dispute decisions, transit capacity and
// persistence; the existing customer owners keep sale, credit-liability
// and refund-capacity records, which arrive here as reviewed inputs.
// Stripe exposes integer gross, fee and net with net = amount - fee; the
// leaf rechecks that identity on every observation and refuses fractional
// or cross-currency shortcuts.

export const ClearingFailureCode = Schema.Literals([
  "ArithmeticMismatch",
  "UnsupportedObservationType",
  "UnsupportedCurrency",
  "MissingSaleRelationship",
  "RefundCapacityExceeded",
  "NonPositivePayout",
  "TransitCapacityExceeded",
  "PayoutFailureUnproven",
  "DuplicateSourceEffect",
  "IdempotencyConflict",
  "TestModeMismatch",
]);

export type ClearingFailureCode = typeof ClearingFailureCode.Type;

export const ClearingFailure = Schema.Struct({
  code: ClearingFailureCode,
  message: Description,
});

export type ClearingFailure = typeof ClearingFailure.Type;

export type Checked<A> = Result.Result<A, ClearingFailure>;

function fail(code: ClearingFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function amount(value: bigint) {
  return value.toString();
}

export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const ProcessorEventType = Schema.Literals([
  "charge",
  "payment",
  "refund",
  "payout",
  "fee_only",
  "dispute_hold",
  "dispute_won",
  "dispute_lost",
]);

export type ProcessorEventType = typeof ProcessorEventType.Type;

export const ProcessorObservation = Schema.Struct({
  accountId: Identifier,
  liveMode: Schema.Boolean,
  balanceTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  rawSourceRef: Identifier,
  eventType: ProcessorEventType,
  currency: CurrencyCode,
  currencySupported: Schema.Boolean,
  grossMinor: MinorUnits,
  feeMinor: MinorUnits,
  netMinor: MinorUnits,
  availableOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
});

export type ProcessorObservation = typeof ProcessorObservation.Type;

export const ClearingAccounts = Schema.Struct({
  processorControlAccountId: Identifier,
  feeCostAccountId: Identifier,
  receivableAccountId: Identifier,
  customerCreditLiabilityAccountId: Identifier,
  payoutTransitAccountId: Identifier,
  disputeReceivableAccountId: Identifier,
});

export type ClearingAccounts = typeof ClearingAccounts.Type;

export const ClearingJournalLine = Schema.Struct({
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
});

export type ClearingJournalLine = typeof ClearingJournalLine.Type;

export const ProcessorEffect = Schema.Struct({
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  ownedKind: Schema.Literals([
    "charge_clearing",
    "refund_clearing",
    "payout_transit",
    "fee_only",
    "dispute_hold",
    "dispute_release",
    "unclassified_difference",
  ]),
  journal: Schema.Array(ClearingJournalLine),
  consumedRefundCapacityMinor: MinorUnits,
  createsSaleOrTaxFact: Schema.Boolean,
});

export type ProcessorEffect = typeof ProcessorEffect.Type;

export const CompileEffectInput = Schema.Struct({
  observation: ProcessorObservation,
  accounts: ClearingAccounts,
  accountLiveMode: Schema.Boolean,
  recognizedSaleRelationship: Schema.Boolean,
  remainingRefundCapacityMinor: MinorUnits,
});

export type CompileEffectInput = typeof CompileEffectInput.Type;

function balanced(lines: Array<ClearingJournalLine>): Checked<Array<ClearingJournalLine>> {
  let net = 0n;

  for (const line of lines) {
    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);

    if ((debit === 0n && credit === 0n) || (debit !== 0n && credit !== 0n)) {
      return fail("ArithmeticMismatch", "Every clearing line needs exactly one positive side.");
    }

    net += debit - credit;
  }

  if (net !== 0n) {
    return fail("ArithmeticMismatch", "The clearing journal does not balance.");
  }

  return Result.succeed(lines);
}

// Compiles one balance transaction into its exact clearing effect. Charges
// allocate AR principal and create no sale or VAT; refunds consume the
// reviewed customer-credit capacity and create no second tax fact; payouts
// move to transit; unknown types stay visible as unclassified differences
// instead of being silently omitted or forced into revenue.
export function compileProcessorEffect(input: CompileEffectInput): Checked<ProcessorEffect> {
  const observation = input.observation;
  const gross = BigInt(observation.grossMinor);
  const fee = BigInt(observation.feeMinor);
  const net = BigInt(observation.netMinor);

  if (observation.liveMode !== input.accountLiveMode) {
    return fail(
      "TestModeMismatch",
      "A test-account object cannot clear through a live account identity.",
    );
  }

  if (!observation.currencySupported) {
    return fail("UnsupportedCurrency", "The observation currency has no qualified metadata.");
  }

  if (gross - fee !== net) {
    return fail(
      "ArithmeticMismatch",
      "The provider gross, fee and net do not satisfy net = gross - fee.",
    );
  }

  if (fee < 0n) {
    return fail("ArithmeticMismatch", "The provider fee cannot be negative.");
  }

  const source = `${observation.accountId}|${observation.balanceTransactionId}`;

  if (observation.eventType === "charge" || observation.eventType === "payment") {
    if (!input.recognizedSaleRelationship) {
      return fail(
        "MissingSaleRelationship",
        "A charge needs a recognized sale or authorized customer obligation, never fabricated revenue.",
      );
    }

    const lines: Array<ClearingJournalLine> = [
      {
        accountId: input.accounts.processorControlAccountId,
        debitMinor: amount(net),
        creditMinor: "0",
        description: "Processor control net",
      },
    ];

    if (fee !== 0n) {
      lines.push({
        accountId: input.accounts.feeCostAccountId,
        debitMinor: amount(fee),
        creditMinor: "0",
        description: "Qualified processor fee cost",
      });
    }

    lines.push({
      accountId: input.accounts.receivableAccountId,
      debitMinor: "0",
      creditMinor: amount(gross),
      description: "Customer AR principal allocation",
    });

    const journal = balanced(lines);

    if (Result.isFailure(journal)) return Result.fail(journal.failure);

    return Result.succeed({
      sourceIdentity: source,
      ownedKind: "charge_clearing",
      journal: journal.success,
      consumedRefundCapacityMinor: "0",
      createsSaleOrTaxFact: false,
    });
  }

  if (observation.eventType === "refund") {
    const refundPrincipal = -gross;

    if (refundPrincipal < 0n) {
      return fail("ArithmeticMismatch", "A refund needs a non-positive provider gross.");
    }

    if (refundPrincipal > BigInt(input.remainingRefundCapacityMinor)) {
      return fail(
        "RefundCapacityExceeded",
        "The refund exceeds the remaining customer-credit capacity.",
      );
    }

    const lines: Array<ClearingJournalLine> = [
      {
        accountId: input.accounts.customerCreditLiabilityAccountId,
        debitMinor: amount(refundPrincipal),
        creditMinor: "0",
        description: "Customer credit liability release",
      },
    ];

    if (fee !== 0n) {
      lines.push({
        accountId: input.accounts.feeCostAccountId,
        debitMinor: amount(fee),
        creditMinor: "0",
        description: "Qualified refund fee cost",
      });
    }

    lines.push({
      accountId: input.accounts.processorControlAccountId,
      debitMinor: "0",
      creditMinor: amount(refundPrincipal + fee),
      description: "Processor control clearing",
    });

    const journal = balanced(lines);

    if (Result.isFailure(journal)) return Result.fail(journal.failure);

    return Result.succeed({
      sourceIdentity: source,
      ownedKind: "refund_clearing",
      journal: journal.success,
      consumedRefundCapacityMinor: amount(refundPrincipal),
      createsSaleOrTaxFact: false,
    });
  }

  if (observation.eventType === "payout") {
    const payoutAmount = -net;

    if (payoutAmount <= 0n) {
      return fail("NonPositivePayout", "A payout needs a positive transfer amount.");
    }

    const journal = balanced([
      {
        accountId: input.accounts.payoutTransitAccountId,
        debitMinor: amount(payoutAmount),
        creditMinor: "0",
        description: "Payout in transit",
      },
      {
        accountId: input.accounts.processorControlAccountId,
        debitMinor: "0",
        creditMinor: amount(payoutAmount),
        description: "Processor control release",
      },
    ]);

    if (Result.isFailure(journal)) return Result.fail(journal.failure);

    return Result.succeed({
      sourceIdentity: source,
      ownedKind: "payout_transit",
      journal: journal.success,
      consumedRefundCapacityMinor: "0",
      createsSaleOrTaxFact: false,
    });
  }

  if (observation.eventType === "fee_only") {
    const feeCost = -net;

    if (feeCost <= 0n) {
      return fail("NonPositivePayout", "A fee-only observation needs a positive fee cost.");
    }

    const journal = balanced([
      {
        accountId: input.accounts.feeCostAccountId,
        debitMinor: amount(feeCost),
        creditMinor: "0",
        description: "Qualified processor fee cost",
      },
      {
        accountId: input.accounts.processorControlAccountId,
        debitMinor: "0",
        creditMinor: amount(feeCost),
        description: "Processor control clearing",
      },
    ]);

    if (Result.isFailure(journal)) return Result.fail(journal.failure);

    return Result.succeed({
      sourceIdentity: source,
      ownedKind: "fee_only",
      journal: journal.success,
      consumedRefundCapacityMinor: "0",
      createsSaleOrTaxFact: false,
    });
  }

  if (observation.eventType === "dispute_hold") {
    const hold = net;

    if (hold <= 0n) {
      return fail("NonPositivePayout", "A dispute hold needs a positive held amount.");
    }

    const journal = balanced([
      {
        accountId: input.accounts.disputeReceivableAccountId,
        debitMinor: amount(hold),
        creditMinor: "0",
        description: "Dispute hold receivable",
      },
      {
        accountId: input.accounts.processorControlAccountId,
        debitMinor: "0",
        creditMinor: amount(hold),
        description: "Processor control hold",
      },
    ]);

    if (Result.isFailure(journal)) return Result.fail(journal.failure);

    return Result.succeed({
      sourceIdentity: source,
      ownedKind: "dispute_hold",
      journal: journal.success,
      consumedRefundCapacityMinor: "0",
      createsSaleOrTaxFact: false,
    });
  }

  if (observation.eventType === "dispute_won") {
    const released = -net;

    if (released <= 0n) {
      return fail("NonPositivePayout", "A won dispute needs a positive released amount.");
    }

    const journal = balanced([
      {
        accountId: input.accounts.processorControlAccountId,
        debitMinor: amount(released),
        creditMinor: "0",
        description: "Processor control dispute release",
      },
      {
        accountId: input.accounts.disputeReceivableAccountId,
        debitMinor: "0",
        creditMinor: amount(released),
        description: "Clear dispute hold receivable",
      },
    ]);

    if (Result.isFailure(journal)) return Result.fail(journal.failure);

    return Result.succeed({
      sourceIdentity: source,
      ownedKind: "dispute_release",
      journal: journal.success,
      consumedRefundCapacityMinor: "0",
      createsSaleOrTaxFact: false,
    });
  }

  return Result.succeed({
    sourceIdentity: source,
    ownedKind: "unclassified_difference",
    journal: [],
    consumedRefundCapacityMinor: "0",
    createsSaleOrTaxFact: false,
  });
}

export const BankReceiptInput = Schema.Struct({
  payoutAmountMinor: MinorUnits,
  transitCapacityMinor: MinorUnits,
  currencyMatches: Schema.Boolean,
  providerBankRelationship: Schema.Boolean,
  adoptsExistingPosting: Schema.Boolean,
  bankAccountId: Identifier,
  payoutTransitAccountId: Identifier,
});

export type BankReceiptInput = typeof BankReceiptInput.Type;

// Records the bank leg of a payout: bank against transit, no revenue or
// expense again. An existing compatible cash posting can be adopted; a
// failure reverses transit only with evidence the cash never settled.
export function recordBankPayoutReceipt(input: BankReceiptInput): Checked<ProcessorEffect> {
  const payoutAmount = BigInt(input.payoutAmountMinor);

  if (payoutAmount <= 0n) {
    return fail("NonPositivePayout", "A bank payout receipt needs a positive amount.");
  }

  if (!input.currencyMatches || !input.providerBankRelationship) {
    return fail(
      "TransitCapacityExceeded",
      "The bank receipt needs the exact provider, bank and currency relationship.",
    );
  }

  if (payoutAmount > BigInt(input.transitCapacityMinor)) {
    return fail(
      "TransitCapacityExceeded",
      "The bank receipt exceeds the current payout-transit capacity.",
    );
  }

  if (input.adoptsExistingPosting) {
    return Result.succeed({
      sourceIdentity: `adopted|${input.payoutAmountMinor}`,
      ownedKind: "payout_transit",
      journal: [],
      consumedRefundCapacityMinor: "0",
      createsSaleOrTaxFact: false,
    });
  }

  const journal = balanced([
    {
      accountId: input.bankAccountId,
      debitMinor: amount(payoutAmount),
      creditMinor: "0",
      description: "Bank payout receipt",
    },
    {
      accountId: input.payoutTransitAccountId,
      debitMinor: "0",
      creditMinor: amount(payoutAmount),
      description: "Clear payout in transit",
    },
  ]);

  if (Result.isFailure(journal)) return Result.fail(journal.failure);

  return Result.succeed({
    sourceIdentity: `bank|${input.payoutAmountMinor}`,
    ownedKind: "payout_transit",
    journal: journal.success,
    consumedRefundCapacityMinor: "0",
    createsSaleOrTaxFact: false,
  });
}

export const PayoutFailureInput = Schema.Struct({
  payoutAmountMinor: MinorUnits,
  cashSettled: Schema.Boolean,
  transitAccountId: Identifier,
  processorControlAccountId: Identifier,
});

export type PayoutFailureInput = typeof PayoutFailureInput.Type;

// A payout failure reverses transit only with evidence the original cash
// did not settle. Settled-then-returned cash keeps both real events; a
// status flag never erases cash.
export function reverseFailedPayout(input: PayoutFailureInput): Checked<ProcessorEffect> {
  if (input.cashSettled) {
    return fail(
      "PayoutFailureUnproven",
      "Settled cash cannot be reversed from transit; retain both cash events.",
    );
  }

  const payoutAmount = BigInt(input.payoutAmountMinor);

  const journal = balanced([
    {
      accountId: input.processorControlAccountId,
      debitMinor: amount(payoutAmount),
      creditMinor: "0",
      description: "Return failed payout to processor control",
    },
    {
      accountId: input.transitAccountId,
      debitMinor: "0",
      creditMinor: amount(payoutAmount),
      description: "Reverse payout in transit",
    },
  ]);

  if (Result.isFailure(journal)) return Result.fail(journal.failure);

  return Result.succeed({
    sourceIdentity: `failed|${input.payoutAmountMinor}`,
    ownedKind: "payout_transit",
    journal: journal.success,
    consumedRefundCapacityMinor: "0",
    createsSaleOrTaxFact: false,
  });
}

export const ReplaySourceInput = Schema.Struct({
  existingSourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  sourceIdentity: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  existingEffect: ProcessorEffect,
});

export type ReplaySourceInput = typeof ReplaySourceInput.Type;

// The same source read under the payout and balance lists resolves to one
// effect: the same identity replays, anything else refuses.
export function replaySameSourceEffect(input: ReplaySourceInput): Checked<ProcessorEffect> {
  if (input.sourceIdentity !== input.existingSourceIdentity) {
    return fail(
      "DuplicateSourceEffect",
      "A different source identity cannot reuse a committed clearing effect.",
    );
  }

  return Result.succeed(input.existingEffect);
}

export const ClosingInput = Schema.Struct({
  reviewedOpeningMinor: MinorUnits,
  netEffectsMinor: Schema.Array(MinorUnits),
});

export type ClosingInput = typeof ClosingInput.Type;

// Independent control: processor closing equals the reviewed opening plus
// every supported net balance effect. Availability dates partition pending
// and available states without posting again.
export function processorClosing(input: ClosingInput): Checked<typeof MinorUnits.Type> {
  let closing = BigInt(input.reviewedOpeningMinor);

  for (const effect of input.netEffectsMinor) {
    closing += BigInt(effect);
  }

  return Result.succeed(closing.toString());
}

export const TransitClosingInput = Schema.Struct({
  payoutsMovedOutMinor: MinorUnits,
  bankReceiptsMinor: MinorUnits,
  supportedFailuresMinor: MinorUnits,
});

export type TransitClosingInput = typeof TransitClosingInput.Type;

export function payoutTransitClosing(input: TransitClosingInput): Checked<typeof MinorUnits.Type> {
  const closing =
    BigInt(input.payoutsMovedOutMinor) -
    BigInt(input.bankReceiptsMinor) -
    BigInt(input.supportedFailuresMinor);

  return Result.succeed(closing.toString());
}
