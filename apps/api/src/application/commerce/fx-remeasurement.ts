import * as Contracts from "@open-erp/contracts/commerce-fx";
import * as Remeasurement from "@open-erp/domain/fx-remeasurement";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { failure } from "../failures";
import { commandReceipt, ensureEvent, makePlanAndPost, readItemState } from "./fx";
import * as FxDb from "../../db/commerce/fx";
import * as RemeasurementDb from "../../db/commerce/fx-remeasurement";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Db from "../../db/posting";
import { lockBookForUpdate } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";

// NEXT-18. The application owner of incremental open-item FX remeasurement.
//
// Four responsibilities and nothing else:
//   * preparation reads each named item's retained remaining and carrying,
//     verifies the named population is the complete eligible set, reads the
//     retained reporting-rate revision, and seals the target-less-current plan;
//   * approval authorizes exactly the sealed digest, by a different operator,
//     before it expires;
//   * execution re-checks the population, posts the balanced journal through
//     the shared posting path, and records the effect;
//   * a read returns the retained review.
//
// The pure rules are in @open-erp/domain/fx-remeasurement. This module owns the
// transaction, the mapping from a domain refusal to the public error family,
// and nothing about what a rate should be.
//
// Every amount, carrying, rate numerator and denominator below is read from a
// retained row. The caller names item ids, a rate revision, a cutoff and the
// posting witnesses; it states no amount and no carrying.

type Refusal = {
  readonly code: Remeasurement.RemeasurementFailureCode;
  readonly message: string;
};

type PublicFailureCode = typeof FailureCode.Type;

const refusals = {
  IncompletePopulation: "InvalidJournal",
  DuplicateItem: "InvalidJournal",
  UnsupportedLaterConsumption: "InvalidJournal",
  UnsupportedRate: "UnsupportedProfile",
  AmountOutOfRange: "InvalidJournal",
  UnbalancedJournal: "InvalidJournal",
  StalePopulation: "StaleDependency",
} satisfies Record<Remeasurement.RemeasurementFailureCode, PublicFailureCode>;

function refuse(outcome: Refusal): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: refusals[outcome.code], message: outcome.message }),
  );
}

const maximumValuationItems = 500;

// One eligible monetary item as the leaf needs it, assembled entirely from
// retained FX state plus the retained rate. A fully settled item has nothing
// left to remeasure, so it is not eligible; an item the caller named that is
// not eligible refuses rather than valuing a ghost.
function toValuationItem(
  state: {
    readonly id: string;
    readonly direction: string;
    readonly controlAccountId: string;
    readonly remainingOriginalMinor: string;
    readonly originalScale: number;
    readonly remainingCarryingMinor: string;
    readonly capacityVersion: string;
    readonly hasConsumptionAfterCutoff: boolean;
  },
  rate: { readonly revisionId: string; readonly numerator: string; readonly denominator: string },
  rounding: Remeasurement.ValuationItem["rounding"],
): Remeasurement.ValuationItem {
  return {
    itemId: state.id,
    direction: state.direction === "supplier" ? "payable" : "receivable",
    controlAccountId: state.controlAccountId,
    remainingOriginalMinor: state.remainingOriginalMinor,
    originalScale: state.originalScale,
    currentBookCarryingMinor: state.remainingCarryingMinor,
    capacityVersion: state.capacityVersion,
    consumedAfterCutoff: state.hasConsumptionAfterCutoff,
    rateRevisionId: rate.revisionId,
    rateNumerator: rate.numerator,
    rateDenominator: rate.denominator,
    rounding,
  };
}

function readRateRevision(
  transaction: Transaction,
  scope: Scope,
  observationId: string,
  digest: string,
  currency: string,
  bookCurrency: string,
  cutoff: string,
) {
  return Effect.gen(function* () {
    const rows = yield* FxDb.readCurrentRate(transaction, scope.bookId, observationId);
    const row = rows[0];

    if (row === undefined) return yield* failure("NotFound");

    const revision = yield* decode(Rates.ExchangeRateRevision, row.body);

    if ((yield* FxDb.readRateWithdrawal(transaction, scope.bookId, observationId)).length > 0) {
      return yield* failure("StaleDependency");
    }

    if (
      revision.digest !== digest ||
      revision.terms.fromCurrency !== currency ||
      revision.terms.toCurrency !== bookCurrency ||
      revision.terms.effectiveOn > cutoff
    ) {
      return yield* failure("InvalidJournal");
    }

    return revision;
  });
}

function readBookCurrency(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];

    if (book === undefined) return yield* failure("NotFound");

    return { currency: book.currency, scale: book.currencyScale };
  });
}

// The retained open population: every item with anything left to remeasure,
// proved by reading each item's retained remaining rather than by trusting the
// request. A population past the bound refuses instead of valuing a partial set.
function readEligibleIds(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const ids = yield* RemeasurementDb.listFxItemIds(
      transaction,
      scope.bookId,
      maximumValuationItems,
    );

    if (ids.length > maximumValuationItems) return yield* failure("UnsupportedProfile");

    const eligible: Array<string> = [];

    for (const row of ids) {
      const state = yield* readItemState(transaction, scope, row.id);

      if (
        BigInt(state.item.remainingOriginalMinor) > 0n ||
        BigInt(state.item.remainingCarryingMinor) !== 0n
      ) {
        eligible.push(row.id);
      }
    }

    return eligible;
  });
}

// One valuation item per named id, assembled entirely from retained FX state
// plus the retained rate. The caller names the item; every number comes from a
// retained row.
function buildValuationItems(
  transaction: Transaction,
  scope: Scope,
  itemIds: ReadonlyArray<string>,
  rate: {
    readonly revisionId: string;
    readonly numerator: string;
    readonly denominator: string;
  },
  rounding: Remeasurement.ValuationItem["rounding"],
  cutoff: string,
) {
  return Effect.gen(function* () {
    const items: Array<Remeasurement.ValuationItem> = [];

    for (const itemId of itemIds) {
      const state = yield* readItemState(transaction, scope, itemId);

      const dates = yield* RemeasurementDb.readSettlementVoucherDates(
        transaction,
        scope.bookId,
        itemId,
      );

      const control = state.item.accountBindings.find((binding) => binding.role === "control");

      if (control === undefined) return yield* failure("InvalidJournal");

      items.push(
        toValuationItem(
          {
            id: state.item.id,
            direction: state.item.direction,
            controlAccountId: control.accountId,
            remainingOriginalMinor: state.item.remainingOriginalMinor,
            originalScale: state.item.original.scale,
            remainingCarryingMinor: state.item.remainingCarryingMinor,
            capacityVersion: state.item.digest,
            hasConsumptionAfterCutoff: dates.some((row) => row.postingDate > cutoff),
          },
          rate,
          rounding,
        ),
      );
    }

    return items;
  });
}

// Preparation. The retained remaining, carrying and rate are read inside the
// transaction, the named population is proved complete against the retained
// eligible set, and the pure compiler seals the target-less-current plan. The
// currency is read from the items themselves, so a mixed-currency selection
// refuses rather than valuing across units.
export const prepareFxRemeasurement = Effect.fn("commerceFx.prepareRemeasurement")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Contracts.PrepareRemeasurement.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "prepare_fx_remeasurement";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.RemeasurementReview,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(
      transaction,
      [
        ...RemeasurementDb.remeasurementTables,
        "commerce_fx_items",
        "commerce_fx_settlements",
        "exchange_rate_revisions",
        "exchange_rate_withdrawals",
      ],
      true,
    );
    yield* lockBookForUpdate(transaction, command.scope);

    const book = yield* readBookCurrency(transaction, command.scope);

    if (command.input.bookScale !== book.scale) return yield* failure("InvalidJournal");

    const eligible = yield* readEligibleIds(transaction, command.scope);
    const named = [...command.input.itemIds].sort();
    const eligibleSorted = [...eligible].sort();

    if (
      named.length !== eligibleSorted.length ||
      named.some((id, index) => id !== eligibleSorted[index])
    ) {
      return yield* failure("InvalidJournal");
    }

    const states = new Map<string, { readonly item: typeof Contracts.MonetaryItem.Type }>();

    for (const itemId of named) {
      states.set(itemId, yield* readItemState(transaction, command.scope, itemId));
    }

    const currencies = new Set([...states.values()].map((state) => state.item.original.currency));

    if (currencies.size !== 1) return yield* failure("InvalidJournal");

    const [currency] = currencies;

    if (currency === undefined || currency === book.currency)
      return yield* failure("InvalidJournal");

    const rate = yield* readRateRevision(
      transaction,
      command.scope,
      command.input.rateObservationId,
      command.input.rateDigest,
      currency,
      book.currency,
      command.input.accountingCutoff,
    );

    const period = (yield* Db.readPeriod(
      transaction,
      command.scope.bookId,
      command.input.accountingPeriodId,
    ))[0];

    if (
      period === undefined ||
      period.locked ||
      period.fiscalYearId !== command.input.fiscalYearId ||
      command.input.accountingCutoff < period.startsOn ||
      command.input.accountingCutoff > period.endsOn
    ) {
      return yield* Effect.fail(
        new AccountingError({ code: "InvalidJournal", message: "STEP period" }),
      );
    }

    const gainLoss = yield* Db.readAccounts(transaction, command.scope.bookId, [
      command.input.unrealizedGainAccountId,
      command.input.unrealizedLossAccountId,
    ]);

    if (gainLoss.length !== 2)
      return yield* Effect.fail(
        new AccountingError({
          code: "InvalidJournal",
          message: `STEP accounts got=${gainLoss.length}`,
        }),
      );

    const items = yield* buildValuationItems(
      transaction,
      command.scope,
      named,
      {
        revisionId: `${command.input.rateObservationId}_r${rate.revision}`,
        numerator: rate.terms.rateNumerator,
        denominator: rate.terms.rateDenominator,
      },
      command.input.rounding,
      command.input.accountingCutoff,
    );

    const compiled = Remeasurement.prepareValuation({
      currency,
      accountingCutoff: command.input.accountingCutoff,
      recordedCutoff: yield* isoNow(transaction),
      complete: true,
      expectedItemCount: named.length,
      bookScale: command.input.bookScale,
      unrealizedGainAccountId: command.input.unrealizedGainAccountId,
      unrealizedLossAccountId: command.input.unrealizedLossAccountId,
      economicDecisionId: command.input.economicDecisionId,
      supersedesEffectId: null,
      items,
    });

    if (Result.isFailure(compiled)) return yield* refuse(compiled.failure);

    const reviewId = newId("fx_remeasurement_review");
    const now = yield* isoNow(transaction);

    const body = {
      id: reviewId,
      scope: command.scope,
      version: 1,
      actorId: principal.actorId,
      plan: compiled.success,
      rateEvidenceId: rate.terms.evidenceId,
    };

    const reviewDigest = yield* digest(body);

    if (
      (yield* RemeasurementDb.readReviewByDigest(transaction, command.scope.bookId, reviewDigest))
        .length > 0
    ) {
      return yield* failure("AlreadyPosted");
    }

    const review = yield* decode(
      Contracts.RemeasurementReview,
      yield* toJsonObject({
        ...body,
        digest: reviewDigest,
        posting: {
          fiscalYearId: command.input.fiscalYearId,
          accountingPeriodId: command.input.accountingPeriodId,
          series: command.input.series,
          bookCurrency: book.currency,
        },
        createdAt: now,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      }),
    );

    // The retained review is the full decoded contract, so a later read
    // decodes exactly what was sealed rather than a partial body.
    yield* RemeasurementDb.insertReview(transaction, {
      bookId: command.scope.bookId,
      id: reviewId,
      actorId: principal.actorId,
      body: yield* toJsonObject(review),
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(review),
    );

    return review;
  });
});

// Approval authorizes exactly the sealed digest, by a different operator,
// before it expires. The approver must still be an admitted operator when the
// approval is checked at execution.
export const approveFxRemeasurement = Effect.fn("commerceFx.approveRemeasurement")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly reviewId: string;
    readonly input: typeof Contracts.ApproveRemeasurement.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "approve_fx_remeasurement";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject({ reviewId: command.reviewId, input: command.input }),
      Contracts.RemeasurementApproval,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, [...RemeasurementDb.remeasurementTables], true);
    yield* lockBookForUpdate(transaction, command.scope);

    const row = (yield* RemeasurementDb.readReview(
      transaction,
      command.scope.bookId,
      command.reviewId,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    const review = yield* decode(Contracts.RemeasurementReview, row.body);

    if (command.input.version !== 1 || command.input.digest !== review.digest) {
      return yield* failure("StaleDependency");
    }

    if (review.actorId === principal.actorId) return yield* failure("ApprovalRequired");

    const now = yield* isoNow(transaction);
    const approvalId = newId("fx_remeasurement_approval");

    const body = {
      id: approvalId,
      scope: command.scope,
      reviewId: review.id,
      digest: review.digest,
      version: 1,
      actorId: principal.actorId,
      expiresAt: new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
    };

    const approval = yield* decode(Contracts.RemeasurementApproval, body);

    yield* RemeasurementDb.insertApproval(transaction, {
      bookId: command.scope.bookId,
      id: approvalId,
      reviewId: review.id,
      actorId: principal.actorId,
      digest: review.digest,
      expiresAt: approval.expiresAt,
      body: yield* toJsonObject(approval),
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(approval),
    );

    return approval;
  });
});

function currentApproval(
  transaction: Transaction,
  scope: Scope,
  reviewId: string,
  approvalId: string,
  reviewDigest: string,
) {
  return Effect.gen(function* () {
    const approval = (yield* RemeasurementDb.readApproval(
      transaction,
      scope.bookId,
      reviewId,
      approvalId,
    ))[0];

    if (approval === undefined || approval.digest !== reviewDigest) {
      return yield* failure("ApprovalRequired");
    }

    const now = yield* isoNow(transaction);

    if (Date.parse(approval.expiresAt) <= Date.parse(now))
      return yield* failure("ApprovalRequired");

    if (
      (yield* Db.readOperatorMembership(transaction, scope.bookId, approval.actorId)).length === 0
    ) {
      return yield* failure("ApprovalRequired");
    }

    if ((yield* Db.readActorAdmission(transaction, approval.actorId))[0]?.enabled === false) {
      return yield* failure("ApprovalRequired");
    }

    return { ...approval, bookId: scope.bookId };
  });
}

// Execution re-checks the population against the sealed membership, builds the
// posting action from the leaf's balanced journal, and posts through the shared
// path. A zero-delta plan retains its membership but consumes no voucher.
export const executeFxRemeasurement = Effect.fn("commerceFx.executeRemeasurement")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly reviewId: string;
    readonly input: typeof Contracts.ExecuteRemeasurement.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "execute_fx_remeasurement";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject({ reviewId: command.reviewId, input: command.input }),
      Contracts.RemeasurementExecuted,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(
      transaction,
      [...RemeasurementDb.remeasurementTables, "commerce_fx_items", "commerce_fx_settlements"],
      true,
    );
    yield* lockBookForUpdate(transaction, command.scope);

    const row = (yield* RemeasurementDb.readReview(
      transaction,
      command.scope.bookId,
      command.reviewId,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    const review = yield* decode(Contracts.RemeasurementReview, row.body);

    if (command.input.version !== 1 || command.input.digest !== review.digest) {
      return yield* failure("StaleDependency");
    }

    const approval = yield* currentApproval(
      transaction,
      command.scope,
      review.id,
      command.input.approvalId,
      review.digest,
    );

    if (approval.actorId === principal.actorId) return yield* failure("ApprovalRequired");

    const current = yield* readCurrentMembership(transaction, command.scope, review);

    const membership = Remeasurement.assertValuationMembership(review.plan, current);

    if (Result.isFailure(membership)) {
      return yield* failure("StaleDependency");
    }

    const now = yield* isoNow(transaction);

    if (!review.plan.consumesVoucher) {
      const executed = yield* decode(
        Contracts.RemeasurementExecuted,
        yield* toJsonObject({
          scope: command.scope,
          reviewId: review.id,
          digest: review.digest,
          approvalId: approval.id,
          voucherId: null,
          effectCount: review.plan.effects.length,
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
        yield* toJsonObject(executed),
      );

      return executed;
    }

    const eventId = yield* ensureEvent(
      transaction,
      command.scope,
      review.rateEvidenceId,
      `fx_remeasurement_${review.id}`,
    );

    const lines = review.plan.journal.map((line) => ({
      lineId: newId("line"),
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
    }));

    // The posting cites the reporting-rate evidence it was computed from,
    // read back from the retained evidence row rather than restated.
    const rateEvidence = (yield* Db.readEvidence(
      transaction,
      command.scope.bookId,
      review.rateEvidenceId,
    ))[0];

    if (rateEvidence === undefined) return yield* failure("NotFound");

    const posted = yield* makePlanAndPost(transaction, command.scope, principal, approval, {
      kind: "post_voucher",
      correctsVoucherId: null,
      eventId,
      postingPurpose: "adjustment",
      occurrenceKey: `commerce_fx_remeasurement_${review.id}`,
      fiscalYearId: review.posting.fiscalYearId,
      accountingPeriodId: review.posting.accountingPeriodId,
      postingDate: review.plan.accountingCutoff,
      series: review.posting.series,
      currency: review.posting.bookCurrency,
      evidenceRefs: [
        {
          evidenceId: review.rateEvidenceId,
          sha256: rateEvidence.sha256,
          locator: `fx_remeasurement_${review.id}`,
        },
      ],
      description: `Synthetic FX remeasurement as at ${review.plan.accountingCutoff}`,
      rationale: review.plan.economicDecisionId,
      taxAssessment: "not_applicable",
      lines,
    });

    const executed = yield* decode(
      Contracts.RemeasurementExecuted,
      yield* toJsonObject({
        scope: command.scope,
        reviewId: review.id,
        digest: review.digest,
        approvalId: approval.id,
        voucherId: posted.voucherId,
        effectCount: review.plan.effects.length,
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
      yield* toJsonObject(executed),
    );

    return executed;
  });
});

// The current membership is recomputed from retained state, so execution values
// the sealed population rather than whatever the population has become.
function readCurrentMembership(
  transaction: Transaction,
  scope: Scope,
  review: typeof Contracts.RemeasurementReview.Type,
) {
  return Effect.gen(function* () {
    const members: Array<Remeasurement.ValuationMembership> = [];

    for (const member of review.plan.membership) {
      const state = yield* readItemState(transaction, scope, member.itemId);

      members.push({ itemId: member.itemId, capacityVersion: state.item.digest });
    }

    return members;
  });
}

export const getFxRemeasurement = Effect.fn("commerceFx.getRemeasurement")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, [...RemeasurementDb.remeasurementTables], false);

    const row = (yield* RemeasurementDb.readReview(
      transaction,
      command.scope.bookId,
      command.id,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    return yield* decode(Contracts.RemeasurementReview, row.body);
  });
});
