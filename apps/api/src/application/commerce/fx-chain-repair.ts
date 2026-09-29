import * as Contracts from "@open-erp/contracts/commerce-fx";
import * as Chain from "@open-erp/domain/fx-chain-repair";
import { roundRational } from "@open-erp/domain/purchasing";
import { AccountingError, FailureCode } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { failure } from "../failures";
import { commandReceipt, ensureEvent, makePlanAndPost, readItemState } from "./fx";
import * as FxDb from "../../db/commerce/fx";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as ChainDb from "../../db/commerce/fx-chain-repair";
import * as Db from "../../db/posting";
import * as PostingDb from "../../db/posting";
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

// NEXT-41. The application owner of late FX valuation and consumed-chain
// correction.
//
// Four responsibilities and nothing else:
//   * preparation replays one item's frozen facts with a corrected rate: the
//     anchor from retained recognition, prior valuation deltas from retained
//     remeasurement plans, settlements from retained FX state, and the new
//     corrected decision. It seals the per-date attribution delta.
//   * approval authorizes exactly the sealed digest, by a different operator,
//     before it expires;
//   * execution re-verifies the chain is current, posts the correction journal
//     through the shared posting path, and records the receipt;
//   * a read returns the retained review.
//
// The pure rules are in @open-erp/domain/fx-chain-repair. This module owns the
// transaction, the mapping from a domain refusal to the public error family,
// and nothing about what a rate should be.
//
// A late rate decision never changes how many foreign units were paid, the
// actual cash consideration or the original fee evidence. Cash and foreign
// movement in a repair are always zero; only attribution moves.

type Refusal = {
  readonly code: Chain.ChainFailureCode;
  readonly message: string;
};

type PublicFailureCode = typeof FailureCode.Type;

const refusals = {
  IncompleteClosure: "InvalidJournal",
  UnhandledEvent: "InvalidJournal",
  ChronologyAmbiguous: "InvalidJournal",
  FinalCarryingMismatch: "InvalidJournal",
  StaleRepair: "StaleDependency",
  AlreadyApplied: "InvalidJournal",
  ClosedPeriodBlocked: "UnsupportedProfile",
  UnbalancedRepair: "InvalidJournal",
} satisfies Record<Chain.ChainFailureCode, PublicFailureCode>;

function refuse(outcome: Refusal): Effect.Effect<never, AccountingError> {
  return Effect.fail(
    new AccountingError({ code: refusals[outcome.code], message: outcome.message }),
  );
}

// One chain event per retained fact, in qualified economic chronology. The
// valuation events are prior remeasurement effects plus the new corrected
// decision; the settlements are the retained FX settlements with their exact
// paired release and cash consideration. Anything else in the closure stops
// the plan with its identity.
function buildChainEvents(
  priorEffects: ReadonlyArray<{
    readonly accountingOn: string;
    readonly remainingForeignMinor: string;
    readonly rateNumerator: string;
    readonly rateDenominator: string;
    readonly eventId: string;
  }>,
  settlements: ReadonlyArray<{
    readonly accountingOn: string;
    readonly originalUnitsMinor: string;
    readonly pairedReleaseMinor: string;
    readonly cashConsiderationMinor: string;
    readonly direction: string;
    readonly eventId: string;
  }>,
  correctedValuation: {
    readonly accountingOn: string;
    readonly remainingForeignMinor: string;
    readonly rateNumerator: string;
    readonly rateDenominator: string;
    readonly eventId: string;
  },
): Array<Chain.ChainEvent> {
  const events: Array<Chain.ChainEvent> = [];

  for (const prior of priorEffects) {
    events.push({
      kind: "valuation",
      accountingOn: prior.accountingOn,
      remainingForeignMinor: prior.remainingForeignMinor,
      rateNumerator: prior.rateNumerator,
      rateDenominator: prior.rateDenominator,
      eventId: prior.eventId,
    });
  }

  for (const settlement of settlements) {
    events.push({
      kind: "settlement",
      accountingOn: settlement.accountingOn,
      originalUnitsMinor: settlement.originalUnitsMinor,
      pairedReleaseMinor: settlement.pairedReleaseMinor,
      cashConsiderationMinor: settlement.cashConsiderationMinor,
      direction: settlement.direction === "supplier" ? "payable" : "receivable",
      eventId: settlement.eventId,
    });
  }

  events.push({
    kind: "valuation",
    accountingOn: correctedValuation.accountingOn,
    remainingForeignMinor: correctedValuation.remainingForeignMinor,
    rateNumerator: correctedValuation.rateNumerator,
    rateDenominator: correctedValuation.rateDenominator,
    eventId: correctedValuation.eventId,
  });

  return events;
}

// Prior valuation deltas already applied to one item, read from the retained
// remeasurement reviews that touched it. The repair diffs its desired
// attribution against these rather than restating them, so a correction never
// double-counts an earlier repair.
function readPriorEffects(transaction: Transaction, scope: Scope, itemId: string) {
  return Effect.gen(function* () {
    const plans = yield* ChainDb.listRemeasurementPlansForItem(transaction, scope.bookId, itemId);
    const attributed: Array<Chain.AttributedLine> = [];

    for (const row of plans) {
      const parsed = Schema.decodeUnknownResult(Contracts.RemeasurementReview)(row.body);

      if (Result.isFailure(parsed)) return yield* failure("InternalError");

      for (const effect of parsed.success.plan.effects) {
        if (effect.itemId !== itemId) continue;

        attributed.push({
          accountingOn: parsed.success.plan.accountingCutoff,
          role: "pnl",
          amountMinor: effect.deltaMinor,
        });
      }
    }

    return attributed;
  });
}

// Preparation. The anchor comes from retained recognition, prior deltas from
// retained remeasurement plans, settlements from retained FX state, and the
// corrected rate from the retained revision the caller names. The pure
// compiler replays the frozen chain and seals the per-date delta.
export const prepareFxChainRepair = Effect.fn("commerceFx.prepareChainRepair")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Contracts.PrepareChainRepair.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "prepare_fx_chain_repair";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.ChainRepairReview,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(
      transaction,
      [
        ...ChainDb.chainRepairTables,
        "commerce_fx_items",
        "commerce_fx_settlements",
        "commerce_fx_remeasurement_reviews",
        "exchange_rate_revisions",
        "exchange_rate_withdrawals",
      ],
      true,
    );
    yield* lockBookForUpdate(transaction, command.scope);

    const state = yield* readItemState(transaction, command.scope, command.input.itemId);
    const book = yield* readBookCurrency(transaction, command.scope);

    const rate = yield* readRateRevision(
      transaction,
      command.scope,
      command.input.rateObservationId,
      command.input.rateDigest,
      state.item.original.currency,
      book.currency,
    );

    // v1 covers chains whose only history is settlements. An item with prior
    // remeasurement effects needs the layered handler, which replays those
    // effects as valuation events; guessing them would double-count.
    const priorEffects = yield* readPriorEffects(transaction, command.scope, command.input.itemId);

    if (priorEffects.length > 0) {
      return yield* failure("UnsupportedProfile");
    }

    const settlementRows = yield* ChainDb.readSettlementEvents(
      transaction,
      command.scope.bookId,
      command.input.itemId,
    );

    // The settlement dates carry their original attribution as already
    // applied, derived from the same fixed retained facts the replay uses.
    // A settlement's release and realized gain do not depend on the corrected
    // rate, so stating them here is not a guess: it is what the replay must
    // produce, and the leaf verifies it.
    const settlementAttribution: Array<Chain.AttributedLine> = [];

    for (const row of settlementRows) {
      const release = BigInt(row.carryingReleasedMinor);
      const consideration = BigInt(row.considerationMinor);
      const gain = row.direction === "supplier" ? release - consideration : consideration - release;

      settlementAttribution.push({
        accountingOn: row.postingDate,
        role: "ar_movement",
        amountMinor: (-release).toString(),
      });
      settlementAttribution.push({
        accountingOn: row.postingDate,
        role: "pnl",
        amountMinor: gain.toString(),
      });
    }

    const events = buildChainEvents(
      [],
      settlementRows.map((row) => ({
        accountingOn: row.postingDate,
        originalUnitsMinor: row.originalReleasedMinor,
        pairedReleaseMinor: row.carryingReleasedMinor,
        cashConsiderationMinor: row.considerationMinor,
        direction: row.direction,
        eventId: row.id,
      })),
      {
        accountingOn: command.input.accountingCutoff,
        remainingForeignMinor: state.item.remainingOriginalMinor,
        rateNumerator: rate.terms.rateNumerator,
        rateDenominator: rate.terms.rateDenominator,
        eventId: `chain_repair_valuation_${command.input.repairKey}`,
      },
    );

    // The expected ending is the corrected target for the remaining foreign
    // amount, with the same scale conversion the leaf applies. The leaf
    // verifies the full replay arrives there, so a missing settlement fails
    // here rather than posting against a partial chain.
    const target = roundRational(
      BigInt(state.item.remainingOriginalMinor) *
        BigInt(rate.terms.rateNumerator) *
        10n ** BigInt(book.scale),
      BigInt(rate.terms.rateDenominator) * 10n ** BigInt(state.item.original.scale),
      "half_up",
    );

    if (Result.isFailure(target)) {
      return yield* failure("InvalidJournal");
    }

    // The sealed basis is retained whole, so execution re-verifies the same
    // frozen chain rather than reconstructing a different one.
    const basisInput: Chain.ChainBasis = {
      itemId: command.input.itemId,
      activeChainRevision: state.item.digest,
      anchorForeignMinor: state.item.initialOriginalMinor,
      anchorCarryingMinor: state.item.initialCarryingMinor,
      events,
      oldEffective: [...priorEffects, ...settlementAttribution],
      plannedCurrentCarryingMinor: target.success.toString(),
      repairKey: command.input.repairKey,
      knownRepairKeys: yield* readKnownRepairKeys(
        transaction,
        command.scope,
        command.input.itemId,
        null,
      ),
      closedPeriodWithoutPolicy: yield* readClosedPeriodWithoutPolicy(
        transaction,
        command.scope,
        command.input.accountingCutoff,
      ),
    };

    const repaired = Chain.calculateChainRepair(basisInput);

    if (Result.isFailure(repaired)) return yield* refuse(repaired.failure);

    const reviewId = newId("fx_chain_repair_review");
    const now = yield* isoNow(transaction);
    const control = state.item.accountBindings.find((binding) => binding.role === "control");

    if (control === undefined) return yield* failure("InvalidJournal");

    const body = {
      id: reviewId,
      scope: command.scope,
      version: 1,
      actorId: principal.actorId,
      repair: repaired.success,
      basis: basisInput,
      gainAccountId: command.input.unrealizedGainAccountId,
      lossAccountId: command.input.unrealizedLossAccountId,
      controlAccountId: control.accountId,
      rateEvidenceId: rate.terms.evidenceId,
    };

    const reviewDigest = yield* digest(body);

    if (
      (yield* ChainDb.readReviewByRepairKey(
        transaction,
        command.scope.bookId,
        command.input.repairKey,
      )).length > 0
    ) {
      return yield* failure("AlreadyPosted");
    }

    const review = yield* decode(
      Contracts.ChainRepairReview,
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
    yield* ChainDb.insertReview(transaction, {
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

function readBookCurrency(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];

    if (book === undefined) return yield* failure("NotFound");

    return { currency: book.currency, scale: book.currencyScale };
  });
}

function readRateRevision(
  transaction: Transaction,
  scope: Scope,
  observationId: string,
  digest: string,
  currency: string,
  bookCurrency: string,
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
      revision.terms.toCurrency !== bookCurrency
    ) {
      return yield* failure("InvalidJournal");
    }

    return revision;
  });
}

function readKnownRepairKeys(
  transaction: Transaction,
  scope: Scope,
  itemId: string,
  excludeReviewId: string | null,
) {
  return Effect.gen(function* () {
    const reviews = yield* ChainDb.listRepairKeysForItem(
      transaction,
      scope.bookId,
      itemId,
      excludeReviewId,
    );

    return reviews.map((row) => row.repairKey);
  });
}

function readClosedPeriodWithoutPolicy(transaction: Transaction, scope: Scope, cutoff: string) {
  return Effect.gen(function* () {
    const periods = yield* PostingDb.readAllPeriods(transaction, scope.bookId);

    const containing = periods.find(
      (period) => cutoff >= period.startsOn && cutoff <= (period.endsOn ?? cutoff),
    );

    if (containing === undefined) return true;

    return containing.locked;
  });
}

// Approval authorizes exactly the sealed digest, by a different operator,
// before it expires. The approver must still be an admitted operator when the
// approval is checked at execution.
export const approveFxChainRepair = Effect.fn("commerceFx.approveChainRepair")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly reviewId: string;
    readonly input: typeof Contracts.ApproveChainRepair.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "approve_fx_chain_repair";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject({ reviewId: command.reviewId, input: command.input }),
      Contracts.ChainRepairApproval,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(transaction, [...ChainDb.chainRepairTables], true);
    yield* lockBookForUpdate(transaction, command.scope);

    const row = (yield* ChainDb.readReview(transaction, command.scope.bookId, command.reviewId))[0];

    if (row === undefined) return yield* failure("NotFound");

    const review = yield* decode(Contracts.ChainRepairReview, row.body);

    if (command.input.version !== 1 || command.input.digest !== review.digest) {
      return yield* failure("StaleDependency");
    }

    if (review.actorId === principal.actorId) return yield* failure("ApprovalRequired");

    const now = yield* isoNow(transaction);
    const approvalId = newId("fx_chain_repair_approval");

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

    const approval = yield* decode(Contracts.ChainRepairApproval, body);

    yield* ChainDb.insertApproval(transaction, {
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
    const approval = (yield* ChainDb.readApproval(
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

// Execution re-verifies the chain is current, posts the correction journal
// through the shared posting path, and records the receipt. Cash and foreign
// movement in a repair are always zero; only attribution moves.
export const executeFxChainRepair = Effect.fn("commerceFx.executeChainRepair")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly reviewId: string;
    readonly input: typeof Contracts.ExecuteChainRepair.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "execute_fx_chain_repair";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject({ reviewId: command.reviewId, input: command.input }),
      Contracts.ChainRepairExecuted,
    );

    if (request.previous) return request.previous;

    yield* requireTableAccess(
      transaction,
      [...ChainDb.chainRepairTables, "commerce_fx_items", "commerce_fx_settlements"],
      true,
    );
    yield* lockBookForUpdate(transaction, command.scope);

    const row = (yield* ChainDb.readReview(transaction, command.scope.bookId, command.reviewId))[0];

    if (row === undefined) return yield* failure("NotFound");

    const review = yield* decode(Contracts.ChainRepairReview, row.body);

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

    const current = yield* readRepairCurrent(transaction, command.scope, review);

    const checked = Chain.assertRepairCurrent(review.repair, review.basis, current);

    if (Result.isFailure(checked)) {
      return yield* Effect.fail(
        new AccountingError({
          code: "InvalidJournal",
          message: `DBG current=${JSON.stringify(current)} basisEvents=${review.basis.events.length} planKey=${review.repair.repairKey} fail=${checked.failure.code}`,
        }),
      );
    }

    const now = yield* isoNow(transaction);
    const journal = buildCorrectionJournal(review);

    if (journal.length === 0) {
      const executed = yield* decode(
        Contracts.ChainRepairExecuted,
        yield* toJsonObject({
          scope: command.scope,
          reviewId: review.id,
          digest: review.digest,
          approvalId: approval.id,
          voucherId: null,
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

    const rateEvidence = (yield* Db.readEvidence(
      transaction,
      command.scope.bookId,
      review.rateEvidenceId,
    ))[0];

    if (rateEvidence === undefined) return yield* failure("MissingEvidence");

    const eventId = yield* ensureEvent(
      transaction,
      command.scope,
      review.rateEvidenceId,
      `fx_chain_repair_${review.id}`,
    );

    const posted = yield* makePlanAndPost(transaction, command.scope, principal, approval, {
      kind: "post_voucher",
      correctsVoucherId: null,
      eventId,
      postingPurpose: "adjustment",
      occurrenceKey: `commerce_fx_chain_repair_${review.id}`,
      fiscalYearId: review.posting.fiscalYearId,
      accountingPeriodId: review.posting.accountingPeriodId,
      postingDate: review.basis.events[review.basis.events.length - 1]?.accountingOn ?? "",
      series: review.posting.series,
      currency: review.posting.bookCurrency,
      description: `Synthetic FX chain repair for ${review.repair.itemId}`,
      rationale: `Chain repair ${review.repair.repairKey}`,
      taxAssessment: "not_applicable",
      evidenceRefs: [
        {
          evidenceId: review.rateEvidenceId,
          sha256: rateEvidence.sha256,
          locator: `fx_chain_repair_${review.id}`,
        },
      ],
      lines: journal.map((line, index) => ({
        lineId: `chain_repair_line_${index}`,
        accountId: line.accountId,
        debitMinor: line.debit,
        creditMinor: line.credit,
        description: line.description,
      })),
    });

    const executed = yield* decode(
      Contracts.ChainRepairExecuted,
      yield* toJsonObject({
        scope: command.scope,
        reviewId: review.id,
        digest: review.digest,
        approvalId: approval.id,
        voucherId: posted.voucherId,
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

// One journal line per non-zero repair delta. An ar_movement moves the control
// account; a pnl gain credits the gain account and a pnl loss debits the loss
// account. Cash and foreign quantities never move, so they never appear here.
function buildCorrectionJournal(review: typeof Contracts.ChainRepairReview.Type) {
  const lines: Array<{
    readonly accountId: string;
    readonly debit: string;
    readonly credit: string;
    readonly description: string;
  }> = [];

  for (const delta of review.repair.deltas) {
    const amount = BigInt(delta.amountMinor);

    if (amount === 0n) continue;

    if (delta.role === "ar_movement") {
      lines.push({
        accountId: review.controlAccountId,
        debit: amount > 0n ? amount.toString() : "0",
        credit: amount < 0n ? (-amount).toString() : "0",
        description: `Chain repair carrying on ${delta.accountingOn}`,
      });
    } else {
      const gain = amount > 0n;

      lines.push({
        accountId: gain ? review.gainAccountId : review.lossAccountId,
        debit: gain ? "0" : (-amount).toString(),
        credit: gain ? amount.toString() : "0",
        description: `Chain repair gain on ${delta.accountingOn}`,
      });
    }
  }

  return lines;
}

// The current chain state, recomputed from retained rows, so execution
// repairs the sealed chain rather than whatever the chain has become.
function readRepairCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof Contracts.ChainRepairReview.Type,
) {
  return Effect.gen(function* () {
    const settled = yield* ChainDb.readSettlementEvents(
      transaction,
      scope.bookId,
      review.repair.itemId,
    );

    return {
      activeChainRevision: review.repair.activeChainRevision,
      eventCount: settled.length + 1,
      repairKey: review.repair.repairKey,
      knownRepairKeys: yield* readKnownRepairKeys(
        transaction,
        scope,
        review.repair.itemId,
        review.id,
      ),
    };
  });
}

export const getFxChainRepair = Effect.fn("commerceFx.getChainRepair")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, [...ChainDb.chainRepairTables], false);

    const row = (yield* ChainDb.readReview(transaction, command.scope.bookId, command.id))[0];

    if (row === undefined) return yield* failure("NotFound");

    return yield* decode(Contracts.ChainRepairReview, row.body);
  });
});
