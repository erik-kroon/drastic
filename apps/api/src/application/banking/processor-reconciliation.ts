import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as NativeCash from "@open-erp/contracts/foreign-cash";
import * as Clearing from "@open-erp/domain/processor-clearing";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/banking/processor-clearing";
import * as CashDb from "../../db/banking/foreign-cash";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readProcessorAccount } from "./processor-fetches";

function custodyAt(
  tx: Transaction,
  scope: Scope,
  account: typeof Contracts.Account.Type,
  accountId: string,
  bookCurrency: string,
  cutoff: string,
) {
  return Effect.gen(function* () {
    const childEffects = yield* Db.readCashEffects(tx, scope.bookId, accountId);
    let native = 0n;
    let carrying = 0n;

    if (account.currency !== bookCurrency) {
      const row = (yield* CashDb.readAccount(tx, scope.bookId, accountId))[0];

      if (!row) return yield* failure("StaleDependency");
      const opening = yield* decode(NativeCash.Holding, row.body);
      native = BigInt(opening.nativeMinor);
      carrying = BigInt(opening.carryingMinor);

      for (const effect of yield* CashDb.readEffects(tx, scope.bookId, accountId)) {
        if (effect.actualOn <= cutoff) {
          native += BigInt(effect.nativeDeltaMinor);
          carrying += BigInt(effect.carryingDeltaMinor);
        }
      }
    }

    for (const effect of childEffects) {
      if (effect.actualOn <= cutoff) {
        native += BigInt(effect.nativeDeltaMinor);
        carrying += BigInt(effect.carryingDeltaMinor);
      }
    }

    return { native, carrying };
  });
}

function manifestBlockers(
  tx: Transaction,
  scope: Scope,
  fetched: typeof Contracts.Fetch.Type,
  known: ReadonlyArray<typeof Contracts.Observation.Type>,
) {
  return Effect.gen(function* () {
    const blockers = new Set<string>();
    const manifest = new Set(fetched.observations.map((observation) => observation.id));

    for (const observation of known) {
      if (
        observation.occurredOn < fetched.selection.startsOn ||
        observation.occurredOn > fetched.selection.endsOn
      )
        continue;

      if (!manifest.has(observation.id)) blockers.add("known_observation_missing_from_manifest");

      if (observation.classification === "requires_classification")
        blockers.add("unclassified_observation");

      if ((yield* Db.readObservationEffect(tx, scope.bookId, observation.id)).length === 0)
        blockers.add("unconsumed_observation");
    }

    return [...blockers];
  });
}

export const reconcileProcessorClearing = Effect.fn("processor.reconcile")(function* (
  token: string,
  scope: Scope,
  accountId: string,
  fetchId: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    const account = yield* readProcessorAccount(tx, scope, accountId);
    const row = (yield* Db.readFetch(tx, scope.bookId, fetchId))[0];
    const book = (yield* PostingDb.readBook(tx, scope))[0];

    if (!row || !book) return yield* failure("NotFound");
    const fetched = yield* decode(Contracts.Fetch, row.body);

    if (fetched.accountId !== account.id || fetched.profileDigest !== account.digest)
      return yield* failure("StaleDependency");
    const blockers = new Set<string>();

    if (!fetched.providerComplete || fetched.selection.view !== "balance")
      blockers.add("provider_history_not_complete");

    const sourceClosing = Clearing.processorClosing({
      reviewedOpeningMinor: fetched.openingMinor,
      netEffectsMinor: fetched.observations.map((observation) => observation.netMinor),
    });

    if (Result.isFailure(sourceClosing) || sourceClosing.success !== fetched.closingMinor)
      blockers.add("provider_control_mismatch");
    const known: Array<typeof Contracts.Observation.Type> = [];

    for (const observationRow of yield* Db.readObservations(tx, scope.bookId, account.id))
      known.push(yield* decode(Contracts.Observation, observationRow.body));

    for (const blocker of yield* manifestBlockers(tx, scope, fetched, known)) blockers.add(blocker);

    const processor = yield* custodyAt(
      tx,
      scope,
      account,
      account.processorControlAccountId,
      book.currency,
      fetched.selection.endsOn,
    );

    const transit = yield* custodyAt(
      tx,
      scope,
      account,
      account.payoutTransitAccountId,
      book.currency,
      fetched.selection.endsOn,
    );

    const processorLedger = (yield* CashDb.readLedger(
      tx,
      scope.bookId,
      account.processorControlAccountId,
      fetched.selection.endsOn,
    ))[0]?.carryingMinor;

    const transitLedger = (yield* CashDb.readLedger(
      tx,
      scope.bookId,
      account.payoutTransitAccountId,
      fetched.selection.endsOn,
    ))[0]?.carryingMinor;

    if (processorLedger === undefined || transitLedger === undefined)
      return yield* failure("InternalError");
    const nativeDifference = processor.native - BigInt(fetched.closingMinor);
    const bookDifference = BigInt(processorLedger) - processor.carrying;
    const transitDifference = BigInt(transitLedger) - transit.carrying;

    if (nativeDifference !== 0n) blockers.add("processor_native_difference");

    if (bookDifference !== 0n) blockers.add("processor_book_difference");

    if (transitDifference !== 0n) blockers.add("transit_book_difference");

    const payouts: Array<{
      payoutObservationId: string;
      nativeMinor: string;
      carryingMinor: string;
    }> = [];

    for (const observation of known) {
      if (observation.type !== "payout" || observation.occurredOn > fetched.selection.endsOn)
        continue;
      const effects = yield* Db.readPayoutEffects(tx, scope.bookId, observation.id);
      let native = 0n;
      let carrying = 0n;

      for (const effect of effects) {
        const review = (yield* Db.readReview(tx, scope.bookId, effect.reviewId))[0];

        if (!review) return yield* failure("InternalError");
        const action = yield* decode(Contracts.Review, review.body);

        if (action.input.date <= fetched.selection.endsOn) {
          native += BigInt(effect.nativeDeltaMinor);
          carrying += BigInt(effect.carryingDeltaMinor);
        }
      }

      payouts.push({
        payoutObservationId: observation.id,
        nativeMinor: native.toString(),
        carryingMinor: carrying.toString(),
      });

      if (native !== 0n || carrying !== 0n) blockers.add("unsettled_payout");
    }

    return yield* decode(Contracts.Reconciliation, {
      accountId,
      fetchId,
      processorNativeMinor: processor.native.toString(),
      processorLedgerMinor: processorLedger,
      providerClosingMinor: fetched.closingMinor,
      processorNativeDifferenceMinor: nativeDifference.toString(),
      processorBookDifferenceMinor: bookDifference.toString(),
      transitNativeMinor: transit.native.toString(),
      transitLedgerMinor: transitLedger,
      transitBookDifferenceMinor: transitDifference.toString(),
      payouts,
      blockers: [...blockers].sort(),
      complete: blockers.size === 0,
    });
  });
});
