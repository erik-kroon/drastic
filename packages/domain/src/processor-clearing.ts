import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Identifier } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";
import { canonicalizeJson } from "./canonicalization";

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
  "DisputeCapacityExceeded",
  "InvalidSourceIdentity",
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

const ProviderOccurrenceId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

const ProviderSignedMinorUnits = SignedMinorUnits.check(Schema.isPattern(/^-?[0-9]{1,38}$/));

const ProcessorPartition = Schema.Struct({
  accountId: Identifier,
  liveMode: Schema.Boolean,
  currency: CurrencyCode,
});

export const PayoutReference = Schema.Struct({
  ...ProcessorPartition.fields,
  providerPayoutId: ProviderOccurrenceId,
});

// Covers the canonical object, including two maximally escaped provider IDs.
const SourceIdentity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));

function clearingSourceIdentity(
  partition: typeof ProcessorPartition.Type,
  kind: "balance_transaction" | "bank_receipt",
  occurrenceId: string,
  providerPayoutId: string | null,
): Checked<string> {
  const canonical = canonicalizeJson({
    version: 1,
    kind,
    accountId: partition.accountId,
    liveMode: partition.liveMode,
    currency: partition.currency,
    occurrenceId,
    providerPayoutId,
  });

  if (Result.isFailure(canonical)) {
    return fail("InvalidSourceIdentity", "Source identifiers need canonical Unicode text.");
  }

  return Result.succeed(canonical.success.json);
}

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
  ...ProcessorPartition.fields,
  balanceTransactionId: ProviderOccurrenceId,
  // The originating payout, not automatic-payout membership of a charge.
  providerPayoutId: Schema.NullOr(ProviderOccurrenceId),
  rawSourceRef: Identifier,
  eventType: ProcessorEventType,
  currencySupported: Schema.Boolean,
  grossMinor: ProviderSignedMinorUnits,
  feeMinor: MinorUnits,
  netMinor: ProviderSignedMinorUnits,
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
  sourceIdentity: SourceIdentity,
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
  // Reviewed recoverable principal, excluding fees; holds require a fresh
  // receivable, releases consume this linked dispute's remaining principal.
  dispute: Schema.NullOr(
    Schema.Struct({
      disputeId: ProviderOccurrenceId,
      remainingReceivableMinor: MinorUnits,
    }),
  ),
});

export type CompileEffectInput = typeof CompileEffectInput.Type;

function balanced(lines: Array<ClearingJournalLine>): Checked<Array<ClearingJournalLine>> {
  let net = 0n;
  const journal: Array<ClearingJournalLine> = [];

  for (const line of lines) {
    if (!Schema.is(ClearingJournalLine)(line)) {
      return fail("ArithmeticMismatch", "Clearing lines need bounded nonnegative minor units.");
    }

    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);

    if (debit === 0n && credit === 0n) continue;

    if (debit !== 0n && credit !== 0n) {
      return fail("ArithmeticMismatch", "Every clearing line needs exactly one positive side.");
    }

    net += debit - credit;
    journal.push(line);
  }

  if (net !== 0n) {
    return fail("ArithmeticMismatch", "The clearing journal does not balance.");
  }

  return Result.succeed(journal);
}

// Compiles one balance transaction into its exact clearing effect. Charges
// allocate AR principal and create no sale or VAT; refunds consume the
// reviewed customer-credit capacity and create no second tax fact. This journal
// already releases the liability: do not also post NEXT-30's refund journal.
// The application records that owner's capacity consumption in the same tx. Payouts
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

  if (observation.eventType !== "payout" && observation.providerPayoutId !== null) {
    return fail("UnsupportedObservationType", "Only a payout carries its originating payout ID.");
  }

  const identity = clearingSourceIdentity(
    observation,
    "balance_transaction",
    observation.balanceTransactionId,
    observation.providerPayoutId,
  );

  if (Result.isFailure(identity)) return Result.fail(identity.failure);

  const source = identity.success;

  if (observation.eventType === "charge" || observation.eventType === "payment") {
    if (gross <= 0n || net < 0n) {
      return fail(
        "UnsupportedObservationType",
        "A charge needs positive gross and nonnegative net.",
      );
    }

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
    if (fee !== 0n || observation.providerPayoutId === null) {
      return fail(
        "UnsupportedObservationType",
        "Only fee-free, payout-linked transfers are supported.",
      );
    }

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

  if (observation.eventType === "dispute_hold" || observation.eventType === "dispute_won") {
    return compileDisputeEffect(input, source);
  }

  return Result.succeed({
    sourceIdentity: source,
    ownedKind: "unclassified_difference",
    journal: [],
    consumedRefundCapacityMinor: "0",
    createsSaleOrTaxFact: false,
  });
}

function compileDisputeEffect(input: CompileEffectInput, source: string): Checked<ProcessorEffect> {
  const observation = input.observation;
  const gross = BigInt(observation.grossMinor);
  const fee = BigInt(observation.feeMinor);
  const net = BigInt(observation.netMinor);

  if (observation.eventType === "dispute_hold") {
    const hold = -gross;

    if (
      hold <= 0n ||
      input.dispute === null ||
      BigInt(input.dispute.remainingReceivableMinor) !== 0n
    ) {
      return fail(
        "UnsupportedObservationType",
        "A recoverable hold needs a linked new receivable and negative provider gross.",
      );
    }

    const journal = balanced([
      {
        accountId: input.accounts.disputeReceivableAccountId,
        debitMinor: amount(hold),
        creditMinor: "0",
        description: "Dispute hold receivable",
      },
      {
        accountId: input.accounts.feeCostAccountId,
        debitMinor: amount(fee),
        creditMinor: "0",
        description: "Qualified dispute fee cost",
      },
      {
        accountId: input.accounts.processorControlAccountId,
        debitMinor: "0",
        creditMinor: amount(-net),
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
    const released = gross;

    if (released <= 0n || fee !== 0n || input.dispute === null) {
      return fail(
        "UnsupportedObservationType",
        "A dispute release needs linked principal, positive gross and no fee adjustment.",
      );
    }

    if (released > BigInt(input.dispute.remainingReceivableMinor)) {
      return fail("DisputeCapacityExceeded", "The release exceeds the linked dispute receivable.");
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

  return fail("UnsupportedObservationType", "Only recoverable holds and releases are supported.");
}

export const BankReceiptInput = Schema.Struct({
  payout: PayoutReference,
  bankObservationId: Identifier,
  payoutAmountMinor: MinorUnits,
  transitCapacityMinor: MinorUnits,
  currencyMatches: Schema.Boolean,
  providerBankRelationship: Schema.Boolean,
  // The caller qualifies the exact compatible bank/transit posting.
  adoptedPostingRef: Schema.NullOr(Identifier),
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

  const identity = clearingSourceIdentity(
    input.payout,
    "bank_receipt",
    input.bankObservationId,
    input.payout.providerPayoutId,
  );

  if (Result.isFailure(identity)) return Result.fail(identity.failure);

  if (input.adoptedPostingRef !== null) {
    return Result.succeed({
      sourceIdentity: identity.success,
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
    sourceIdentity: identity.success,
    ownedKind: "payout_transit",
    journal: journal.success,
    consumedRefundCapacityMinor: "0",
    createsSaleOrTaxFact: false,
  });
}

export const PayoutFailureInput = Schema.Struct({
  payout: PayoutReference,
  failureBalanceTransactionId: ProviderOccurrenceId,
  nonSettlementEvidenceRef: Identifier,
  payoutAmountMinor: MinorUnits,
  transitCapacityMinor: MinorUnits,
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

  if (payoutAmount <= 0n) {
    return fail("NonPositivePayout", "A failed payout reversal needs a positive amount.");
  }

  if (payoutAmount > BigInt(input.transitCapacityMinor)) {
    return fail(
      "TransitCapacityExceeded",
      "The failure exceeds the linked payout-transit capacity.",
    );
  }

  const identity = clearingSourceIdentity(
    input.payout,
    "balance_transaction",
    input.failureBalanceTransactionId,
    input.payout.providerPayoutId,
  );

  if (Result.isFailure(identity)) return Result.fail(identity.failure);

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
    sourceIdentity: identity.success,
    ownedKind: "payout_transit",
    journal: journal.success,
    consumedRefundCapacityMinor: "0",
    createsSaleOrTaxFact: false,
  });
}

export const ReplaySourceInput = Schema.Struct({
  existingSourceIdentity: SourceIdentity,
  sourceIdentity: SourceIdentity,
  existingEffect: ProcessorEffect,
});

export type ReplaySourceInput = typeof ReplaySourceInput.Type;

// The same source read under the payout and balance lists resolves to one
// effect: the same identity replays, anything else refuses.
export function replaySameSourceEffect(input: ReplaySourceInput): Checked<ProcessorEffect> {
  if (
    input.sourceIdentity !== input.existingSourceIdentity ||
    input.existingEffect.sourceIdentity !== input.sourceIdentity
  ) {
    return fail(
      "DuplicateSourceEffect",
      "A different source identity cannot reuse a committed clearing effect.",
    );
  }

  return Result.succeed(input.existingEffect);
}

export const ClosingInput = Schema.Struct({
  reviewedOpeningMinor: SignedMinorUnits,
  netEffectsMinor: Schema.Array(SignedMinorUnits),
});

export type ClosingInput = typeof ClosingInput.Type;

// Arithmetic only. The caller proves complete unique membership, account/mode/
// currency partition and agreement with independent controls. Neither this sum
// nor an availability-date partition certifies reconciliation.
export function processorClosing(input: ClosingInput): Checked<typeof SignedMinorUnits.Type> {
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

// A negative total exposes over-resolution; it is not a reconciliation receipt.
export function payoutTransitClosing(
  input: TransitClosingInput,
): Checked<typeof SignedMinorUnits.Type> {
  const closing =
    BigInt(input.payoutsMovedOutMinor) -
    BigInt(input.bankReceiptsMinor) -
    BigInt(input.supportedFailuresMinor);

  return Result.succeed(closing.toString());
}
