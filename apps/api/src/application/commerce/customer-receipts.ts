import * as Contracts from "@open-erp/contracts/customer-credit-notes";
import * as Receipts from "@open-erp/domain/customer-credits";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as InvoiceDb from "../../db/commerce/invoices";
import { failure } from "../failures";
import * as PostingDb from "../../db/posting";
import * as ReceiptDb from "../../db/commerce/customer-receipts";
import type { Transaction } from "../../db/transaction";
import type { VerifiedPrincipal } from "../../db/identity";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  sealActionInTransaction,
} from "../posting";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { digest } from "../json";

// NEXT-30. The application owner of customer unapplied cash, paid credits and
// refunds.
//
// Four responsibilities and nothing else:
//   * preparation reads each named invoice's retained remaining, builds the
//     receipt legs from those remainings, and seals the receipt preview;
//   * execution re-derives the preview, requires it to match, posts through
//     the shared kernel and retains the credit origin;
//   * application and refund read the retained origin and its retained
//     remaining capacity, run the leaf against those numbers, post and append
//     the effect;
//   * a read returns the retained origin with its computed remaining.
//
// The pure rules are in @open-erp/domain/customer-credits. This module owns the
// transaction, the mapping from a domain refusal to the public error family,
// and nothing about what a customer owes.
//
// The shared posting kernel approves and executes by the calling operator,
// which is this lane's established pattern. A surplus becomes a liability only
// with a qualified classification; an unreviewed taxable advance refuses
// toward its owner rather than becoming unapplied cash.

type Refusal = {
  readonly code: Receipts.CustomerCreditFailureCode;
  readonly message: string;
};

type PublicFailureCode = typeof FailureCode.Type;

const refusals = {
  CreditExceedsOriginal: "InvalidJournal",
  PaymentExceedsOriginal: "InvalidJournal",
  RefundExceedsPrincipal: "InvalidJournal",
  AllocationExceedsCash: "InvalidJournal",
  AllocationExceedsInvoice: "InvalidJournal",
  CounterpartyMismatch: "InvalidJournal",
  UnclassifiedSurplus: "UnsupportedProfile",
  InsufficientClearingCapacity: "InvalidJournal",
  InsufficientLineCapacity: "InvalidJournal",
  DuplicateCreditIdentity: "InvalidJournal",
  UnbalancedJournal: "InvalidJournal",
  NonPositiveAmount: "InvalidJournal",
  CreditCapacityExceeded: "InvalidJournal",
  UnsupportedRefundSource: "UnsupportedProfile",
  UnsupportedConsumedHistory: "InvalidJournal",
  UnsupportedProfile: "UnsupportedProfile",
} satisfies Record<Receipts.CustomerCreditFailureCode, PublicFailureCode>;

function refuse(outcome: Refusal): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: refusals[outcome.code], message: outcome.message }),
  );
}

function notFound(): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: "NotFound", message: "The retained record is absent." }),
  );
}

// One receipt leg per named invoice, with the remaining read from the retained
// live invoice projection. A leg naming an unknown invoice, another customer's
// invoice, another currency, or more than remains refuses here rather than
// entering the compiler on asserted numbers.
function buildReceiptLegs(
  transaction: Transaction,
  scope: Scope,
  customerId: string,
  currency: string,
  legs: ReadonlyArray<{ readonly invoiceId: string; readonly amountMinor: string }>,
) {
  return Effect.gen(function* () {
    const compiled: Array<Receipts.ReceiptLeg> = [];

    for (const leg of legs) {
      const identity = (yield* ReceiptDb.readInvoiceIdentity(
        transaction,
        scope.bookId,
        leg.invoiceId,
      ))[0];

      if (identity === undefined) return yield* notFound();

      if (identity.customerId !== customerId) {
        return yield* refuse({
          code: "CounterpartyMismatch",
          message: `Invoice ${leg.invoiceId} belongs to another customer.`,
        });
      }

      if (identity.currency !== currency) {
        return yield* refuse({
          code: "CounterpartyMismatch",
          message: `Invoice ${leg.invoiceId} is in another currency.`,
        });
      }

      const live = (yield* InvoiceDb.readLiveInvoice(transaction, scope.bookId, leg.invoiceId))[0];

      if (live === undefined || live.outstandingMinor === null) {
        return yield* refuse({
          code: "AllocationExceedsInvoice",
          message: `Invoice ${leg.invoiceId} has no retained remaining.`,
        });
      }

      compiled.push({
        invoiceId: leg.invoiceId,
        amountMinor: leg.amountMinor,
        invoiceRemainingMinor: live.outstandingMinor,
      });
    }

    return compiled;
  });
}

// The remaining credit of one origin: its original less every effective
// application and refund the retained effects record.
function remainingOf(origin: ReceiptDb.OriginRow, effects: ReadonlyArray<ReceiptDb.EffectRow>) {
  return (
    BigInt(origin.originalMinor) -
    effects.reduce((carry, effect) => carry + BigInt(effect.signedConsumedMinor), 0n)
  ).toString();
}

function readOriginWithEffects(transaction: Transaction, scope: Scope, originId: string) {
  return Effect.gen(function* () {
    const origin = (yield* ReceiptDb.readOrigin(transaction, scope.bookId, originId))[0];

    if (origin === undefined) return yield* notFound();

    const effects = yield* ReceiptDb.readEffectsForOrigin(transaction, scope.bookId, originId);

    return { origin, effects, remaining: remainingOf(origin, effects) };
  });
}

// Ensure the posting event exists, creating it from retained evidence when
// absent. An event is the identity a voucher posts under, so it must exist
// before admission rather than being asserted by the request.
function ensureEvent(transaction: Transaction, scope: Scope, evidenceId: string, eventKey: string) {
  return Effect.gen(function* () {
    const rows = yield* PostingDb.readEvent(transaction, scope.bookId, evidenceId, eventKey);

    if (rows.length > 0 && rows[0] !== undefined) return rows[0].id;

    const eventId = newId("event");

    yield* PostingDb.insertEvent(transaction, scope.bookId, eventId, evidenceId, eventKey);

    return eventId;
  });
}

// Post one leaf journal through the shared kernel. The kernel approves and
// executes by the calling operator, which is this lane's established pattern.
function postJournal(
  transaction: Transaction,
  scope: Scope,
  principal: VerifiedPrincipal,
  journal: ReadonlyArray<Receipts.CustomerJournalLine>,
  posting: {
    readonly fiscalYearId: string;
    readonly accountingPeriodId: string;
    readonly postingDate: string;
    readonly series: string;
    readonly currency: string;
    readonly description: string;
    readonly rationale: string;
    readonly eventKey: string;
    readonly evidenceId: string;
  },
) {
  return Effect.gen(function* () {
    // The evidence reference carries the retained content hash, so admission
    // verifies the exact bytes rather than a bare id.
    const evidence = (yield* PostingDb.readEvidence(
      transaction,
      scope.bookId,
      posting.evidenceId,
    ))[0];

    if (evidence === undefined) return yield* failure("MissingEvidence");

    const eventId = yield* ensureEvent(transaction, scope, posting.evidenceId, posting.eventKey);

    const plan = yield* sealActionInTransaction(
      transaction,
      principal,
      scope,
      {
        kind: "post_voucher",
        correctsVoucherId: null,
        eventId,
        postingPurpose: "adjustment",
        occurrenceKey: posting.eventKey,
        fiscalYearId: posting.fiscalYearId,
        accountingPeriodId: posting.accountingPeriodId,
        postingDate: posting.postingDate,
        series: posting.series,
        currency: posting.currency,
        description: posting.description,
        rationale: posting.rationale,
        taxAssessment: "not_applicable",
        evidenceRefs: [
          {
            evidenceId: posting.evidenceId,
            sha256: evidence.sha256,
            locator: posting.eventKey,
          },
        ],
        lines: journal.map((line, index) => ({
          lineId: `receipt_line_${index}`,
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          description: line.description,
        })),
      },
      true,
    );

    const approved = yield* approveChangeInTransaction(transaction, principal, {
      scope,
      changeSetId: plan.id,
      idempotencyKey: newId("customer_receipt_approve"),
      input: { version: 1, planDigest: plan.planDigest },
      owner: { kind: "customer_receipt", id: plan.id },
    });

    return yield* executeChangeInTransaction(transaction, principal, {
      scope,
      changeSetId: plan.id,
      idempotencyKey: newId("customer_receipt_post"),
      input: { version: 1, planDigest: plan.planDigest, approvalId: approved.id },
      owner: { kind: "customer_receipt", id: plan.id },
    });
  });
}

// Preparation. The retained invoice remainings become the legs, the pure
// compiler splits cash from surplus, and the preview is returned. Nothing is
// posted and no origin exists yet.
export const prepareCustomerReceipt = Effect.fn("commerce.prepareCustomerReceipt")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Contracts.PrepareCustomerReceipt.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "prepare_customer_receipt";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.CustomerReceiptView,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, [...ReceiptDb.receiptTables, "commerce_invoices"], true);

    const legs = yield* buildReceiptLegs(
      transaction,
      command.scope,
      command.input.customerId,
      command.input.currency,
      command.input.legs,
    );

    const compiled = Receipts.compileCustomerReceipt({
      customerId: command.input.customerId,
      currency: command.input.currency,
      cashMinor: command.input.cashMinor,
      legs,
      surplusClassification: command.input.surplusClassification,
      source: {
        kind: "new_cash",
        bankAccountId: command.input.bankAccountId,
        evidenceId: command.input.evidenceId,
      },
      receivableControlAccountId: command.input.receivableControlAccountId,
      creditLiabilityAccountId: command.input.creditLiabilityAccountId,
    });

    if (Result.isFailure(compiled)) return yield* refuse(compiled.failure);

    const now = yield* isoNow(transaction);
    const receiptId = newId("customer_receipt");
    // The digest covers the input and the plan, never the fresh receipt id,
    // so execution can reproduce it from retained rows and prove the preview
    // did not go stale.

    const previewDigest = yield* digest({
      input: command.input,
      plan: compiled.success,
    });

    const view = yield* decode(
      Contracts.CustomerReceiptView,
      yield* toJsonObject({
        scope: command.scope,
        id: receiptId,
        originId: null,
        digest: previewDigest,
        allocatedMinor: compiled.success.allocatedMinor,
        creditOriginMinor: compiled.success.creditOriginMinor,
        journal: compiled.success.journal,
        createdAt: now,
      }),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject({ ...view, plan: compiled.success }),
    );

    return view;
  });
});

// Execution re-derives the preview from retained rows and requires it to
// match, then posts through the shared kernel and retains the credit origin.
// A changed invoice remaining between preview and execution refuses rather
// than posting a stale split.
export const executeCustomerReceipt = Effect.fn("commerce.executeCustomerReceipt")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Contracts.ExecuteCustomerReceipt.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "execute_customer_receipt";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.CustomerReceiptView,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, [...ReceiptDb.receiptTables, "commerce_invoices"], true);

    const prepare = command.input.prepare;

    const legs = yield* buildReceiptLegs(
      transaction,
      command.scope,
      prepare.customerId,
      prepare.currency,
      prepare.legs,
    );

    const compiled = Receipts.compileCustomerReceipt({
      customerId: prepare.customerId,
      currency: prepare.currency,
      cashMinor: prepare.cashMinor,
      legs,
      surplusClassification: prepare.surplusClassification,
      source: {
        kind: "new_cash",
        bankAccountId: prepare.bankAccountId,
        evidenceId: prepare.evidenceId,
      },
      receivableControlAccountId: prepare.receivableControlAccountId,
      creditLiabilityAccountId: prepare.creditLiabilityAccountId,
    });

    if (Result.isFailure(compiled)) return yield* refuse(compiled.failure);

    const now = yield* isoNow(transaction);
    const receiptId = newId("customer_receipt");

    if (command.input.digest !== (yield* digest({ input: prepare, plan: compiled.success }))) {
      return yield* failure("StaleDependency");
    }

    const postingReceipt = yield* postJournal(
      transaction,
      command.scope,
      principal,
      compiled.success.journal,
      {
        fiscalYearId: prepare.fiscalYearId,
        accountingPeriodId: prepare.accountingPeriodId,
        postingDate: yield* currentPostingDate(
          transaction,
          command.scope,
          prepare.accountingPeriodId,
        ),
        series: prepare.series,
        currency: prepare.currency,
        description: `Customer receipt ${receiptId}`,
        rationale: prepare.reason,
        eventKey: `customer_receipt_${receiptId}`,
        evidenceId: prepare.evidenceId,
      },
    );

    const originId = newId("customer_credit_origin");

    const originDigest = yield* digest({
      id: originId,
      customerId: prepare.customerId,
      currency: prepare.currency,
      originalMinor: compiled.success.creditOriginMinor,
      receiptId: postingReceipt.voucherId,
    });

    if (BigInt(compiled.success.creditOriginMinor) > 0n) {
      yield* ReceiptDb.insertOrigin(transaction, {
        bookId: command.scope.bookId,
        id: originId,
        customerId: prepare.customerId,
        currency: prepare.currency,
        originalMinor: compiled.success.creditOriginMinor,
        sourceKind: "new_cash",
        sourceRef: prepare.bankAccountId,
        creditLiabilityAccountId: prepare.creditLiabilityAccountId,
        receivableControlAccountId: prepare.receivableControlAccountId,
        receiptId: postingReceipt.voucherId,
        digest: originDigest,
      });
    }

    const view = yield* decode(
      Contracts.CustomerReceiptView,
      yield* toJsonObject({
        scope: command.scope,
        id: receiptId,
        originId: BigInt(compiled.success.creditOriginMinor) > 0n ? originId : null,
        digest: originDigest,
        allocatedMinor: compiled.success.allocatedMinor,
        creditOriginMinor: compiled.success.creditOriginMinor,
        journal: compiled.success.journal,
        createdAt: now,
      }),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(view),
    );

    return view;
  });
});

// The posting date is today, proved inside the named unlocked period. A
// period that ended, or that never contained today, refuses rather than
// backdating a receipt.
function currentPostingDate(transaction: Transaction, scope: Scope, periodId: string) {
  return Effect.gen(function* () {
    const now = yield* isoNow(transaction);
    const today = now.slice(0, 10);
    const period = (yield* PostingDb.readPeriod(transaction, scope.bookId, periodId))[0];

    if (period === undefined || period.locked || today < period.startsOn || today > period.endsOn) {
      return yield* failure("InvalidJournal");
    }

    return today;
  });
}

// Application. The retained origin and its retained remaining capacity are
// read, the leaf applies no more than either the credit or the invoice
// residual, and the shared kernel posts the liability-to-receivable movement.
// No bank moves and no VAT fact is created.
export const applyCustomerCredit = Effect.fn("commerce.applyCustomerCredit")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly originId: string;
    readonly input: typeof Contracts.ApplyCustomerCredit.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "apply_customer_credit";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject({ originId: command.originId, input: command.input }),
      Contracts.CustomerCreditEffectView,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, [...ReceiptDb.receiptTables, "commerce_invoices"], true);

    const { origin, remaining } = yield* readOriginWithEffects(
      transaction,
      command.scope,
      command.originId,
    );

    const live = (yield* InvoiceDb.readLiveInvoice(
      transaction,
      command.scope.bookId,
      command.input.invoiceId,
    ))[0];

    if (live === undefined || live.outstandingMinor === null) {
      return yield* refuse({
        code: "AllocationExceedsInvoice",
        message: `Invoice ${command.input.invoiceId} has no retained remaining.`,
      });
    }

    const destination = (yield* InvoiceDb.readLiveInvoice(
      transaction,
      command.scope.bookId,
      command.input.invoiceId,
    ))[0];

    if (destination === undefined || destination.outstandingMinor === null) {
      return yield* refuse({
        code: "AllocationExceedsInvoice",
        message: `Invoice ${command.input.invoiceId} has no retained remaining.`,
      });
    }

    const applied = Receipts.applyCustomerCredit({
      customerId: origin.customerId,
      currency: origin.currency,
      remainingCreditMinor: remaining,
      destinationInvoiceId: command.input.invoiceId,
      destinationRemainingMinor: destination.outstandingMinor,
      amountMinor: command.input.amountMinor,
      creditLiabilityAccountId: origin.creditLiabilityAccountId,
      receivableControlAccountId: origin.receivableControlAccountId,
    });

    if (Result.isFailure(applied)) return yield* refuse(applied.failure);

    const now = yield* isoNow(transaction);
    const effectId = newId("customer_credit_effect");

    const postingReceipt = yield* postJournal(
      transaction,
      command.scope,
      principal,
      applied.success.journal,
      {
        fiscalYearId: command.input.fiscalYearId,
        accountingPeriodId: command.input.accountingPeriodId,
        postingDate: yield* currentPostingDate(
          transaction,
          command.scope,
          command.input.accountingPeriodId,
        ),
        series: command.input.series,
        currency: origin.currency,
        description: `Apply customer credit ${origin.id}`,
        rationale: command.input.reason,
        eventKey: `customer_credit_apply_${effectId}`,
        evidenceId: command.input.evidenceId,
      },
    );

    const effectDigest = yield* digest({
      id: effectId,
      originId: origin.id,
      consumedMinor: applied.success.appliedMinor,
      receiptId: postingReceipt.voucherId,
    });

    yield* ReceiptDb.insertEffect(transaction, {
      bookId: command.scope.bookId,
      id: effectId,
      originId: origin.id,
      kind: "apply_to_invoice",
      signedConsumedMinor: applied.success.appliedMinor,
      destinationIdentity: command.input.invoiceId,
      receiptId: postingReceipt.voucherId,
      digest: effectDigest,
    });

    const view = yield* decode(
      Contracts.CustomerCreditEffectView,
      yield* toJsonObject({
        scope: command.scope,
        id: effectId,
        originId: origin.id,
        digest: effectDigest,
        consumedMinor: applied.success.appliedMinor,
        journal: applied.success.journal,
        createdAt: now,
      }),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(view),
    );

    return view;
  });
});

// Refund. The retained origin and its retained remaining capacity are read,
// the leaf refuses more than remains, and the shared kernel posts the
// liability-to-cash movement. External initiation is separately approved and
// outcome-tracked; this operation records an approved refund.
export const refundCustomerCredit = Effect.fn("commerce.refundCustomerCredit")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly originId: string;
    readonly input: typeof Contracts.RefundCustomerCredit.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "refund_customer_credit";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject({ originId: command.originId, input: command.input }),
      Contracts.CustomerCreditEffectView,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, [...ReceiptDb.receiptTables, "commerce_invoices"], true);

    const { origin, remaining } = yield* readOriginWithEffects(
      transaction,
      command.scope,
      command.originId,
    );

    const refunded = Receipts.recordCustomerRefund({
      customerId: origin.customerId,
      currency: origin.currency,
      remainingCreditMinor: remaining,
      amountMinor: command.input.amountMinor,
      source: {
        kind: "new_payment",
        bankAccountId: command.input.cashAccountId,
        evidenceId: command.input.evidenceId,
      },
      sourceCurrency: origin.currency,
      creditLiabilityAccountId: origin.creditLiabilityAccountId,
    });

    if (Result.isFailure(refunded)) return yield* refuse(refunded.failure);

    const now = yield* isoNow(transaction);
    const effectId = newId("customer_credit_effect");

    const postingReceipt = yield* postJournal(
      transaction,
      command.scope,
      principal,
      refunded.success.journal,
      {
        fiscalYearId: command.input.fiscalYearId,
        accountingPeriodId: command.input.accountingPeriodId,
        postingDate: yield* currentPostingDate(
          transaction,
          command.scope,
          command.input.accountingPeriodId,
        ),
        series: command.input.series,
        currency: origin.currency,
        description: `Refund customer credit ${origin.id}`,
        rationale: command.input.reason,
        eventKey: `customer_credit_refund_${effectId}`,
        evidenceId: command.input.evidenceId,
      },
    );

    const effectDigest = yield* digest({
      id: effectId,
      originId: origin.id,
      consumedMinor: refunded.success.refundedMinor,
      receiptId: postingReceipt.voucherId,
    });

    yield* ReceiptDb.insertEffect(transaction, {
      bookId: command.scope.bookId,
      id: effectId,
      originId: origin.id,
      kind: "cash_refund",
      signedConsumedMinor: refunded.success.refundedMinor,
      destinationIdentity: command.input.cashAccountId,
      receiptId: postingReceipt.voucherId,
      digest: effectDigest,
    });

    const view = yield* decode(
      Contracts.CustomerCreditEffectView,
      yield* toJsonObject({
        scope: command.scope,
        id: effectId,
        originId: origin.id,
        digest: effectDigest,
        consumedMinor: refunded.success.refundedMinor,
        journal: refunded.success.journal,
        createdAt: now,
      }),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(view),
    );

    return view;
  });
});

// The retained origin with its computed remaining. Reading it proves, after
// the fact, what is still available to apply or refund.
export const getCustomerCreditOrigin = Effect.fn("commerce.getCustomerCreditOrigin")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, [...ReceiptDb.receiptTables], false);

    const { origin, remaining } = yield* readOriginWithEffects(
      transaction,
      command.scope,
      command.id,
    );

    return yield* decode(
      Contracts.CustomerReceiptView,
      yield* toJsonObject({
        scope: command.scope,
        id: origin.id,
        originId: origin.id,
        digest: origin.digest,
        allocatedMinor: origin.originalMinor,
        creditOriginMinor: remaining,
        journal: [],
        createdAt: yield* isoNow(transaction),
      }),
    );
  });
});
