import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Fx from "@open-erp/contracts/commerce-fx";
import * as Clearing from "@open-erp/domain/processor-clearing";
import * as Cash from "@open-erp/domain/foreign-cash";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import { cumulativeRelease } from "@open-erp/domain/purchasing";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Db from "../../db/banking/processor-clearing";
import * as CashDb from "../../db/banking/foreign-cash";
import * as BankDb from "../../db/banking/statements";
import * as FxDb from "../../db/commerce/fx";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, toJsonObject, type Scope } from "../commerce/support";
import {
  readProcessorReceivableCapacity,
  readProcessorRefundCapacity,
} from "../commerce/processor-settlements";
import { readItemState } from "../commerce/fx";
import { readSourceOccurrenceInTransaction } from "../source-retention";
import { digest } from "../posting";
import { failure } from "../failures";
import { readHolding } from "./foreign-cash";
import { readProcessorAccount } from "./processor-fetches";
import { readProcessorNativeCredit } from "./processor-native-credit";
import { arrayField, booleanField, objectField, textField } from "./shared";

type Input = typeof Contracts.Prepare.Type;

type Account = typeof Contracts.Account.Type;

type Observation = typeof Contracts.Observation.Type;

type Journal = Array<Clearing.ClearingJournalLine>;

type Custody = {
  readonly accountId: string;
  readonly nativeMinor: string;
  readonly carryingMinor: string;
  readonly capacityVersion: string;
};

type Position = {
  readonly nativeMinor: string;
  readonly carryingMinor: string;
  readonly version: string;
};

type Movement = { readonly nativeDeltaMinor: string; readonly carryingDeltaMinor: string };

type Snapshot = {
  account: Account;
  book: {
    readonly currency: string;
    readonly scale: number;
    readonly profileVersion: string;
    readonly writerEpoch: string;
  };
  periodVersion: string;
  accounts: ReadonlyArray<{ readonly id: string; readonly version: string }>;
  evidence: { readonly id: string; readonly sha256: string };
  processor: Custody;
  transit: Custody;
  observation?: Observation;
  source?: { readonly id: string; readonly sha256: string };
  capacity?: { readonly id: string; readonly version: string; readonly remainingMinor: string };
  fxItem?: typeof Fx.MonetaryItem.Type;
  rate?: typeof Rates.ExchangeRateRevision.Type;
  nativeCredit?: typeof Contracts.NativeCreditOrigin.Type;
  dispute?: Position;
  payout?: Position;
  bank?: Schema.JsonObject;
  bankRevisions?: ReadonlyArray<{
    readonly revisionId: string;
    readonly eligibilityVersion: string;
    readonly changeKind: string;
    readonly amountMinor: string | null;
  }>;
  adoptedAction?: Schema.JsonObject;
  nonSettlement?: Schema.JsonObject;
};

export type Compilation = {
  readonly account: Account;
  readonly sourceIdentity: string;
  readonly snapshot: Snapshot;
  readonly journal: Journal;
  readonly cashEffects: Array<typeof Contracts.CashEffect.Type>;
  readonly obligation: typeof Contracts.ObligationEffect.Type | null;
  readonly fiscalYearId: string;
  readonly bookCurrency: string;
  readonly payoutEffect?: Movement & {
    readonly payoutObservationId: string;
    readonly kind: "movement" | "receipt" | "failure";
  };
  readonly disputeEffect?: Movement & { readonly disputeId: string };
  readonly bankClaim?: {
    readonly statementId: string;
    readonly rowOrdinal: number;
    readonly accountId: string;
    readonly nativeMinor: string;
    readonly amountMinor: string;
    readonly adoptedVoucherId: string | null;
    readonly adoptedLineId: string | null;
  };
};

function checked<A>(
  result: Result.Result<A, { readonly message: string }>,
): Effect.Effect<A, ReturnType<typeof failure>> {
  return Result.isFailure(result)
    ? Effect.fail(failure("InvalidJournal", result.failure))
    : Effect.succeed(result.success);
}

function signed(
  accountId: string,
  amount: bigint,
  description: string,
): Clearing.ClearingJournalLine {
  return {
    accountId,
    debitMinor: (amount > 0n ? amount : 0n).toString(),
    creditMinor: (amount < 0n ? -amount : 0n).toString(),
    description,
  };
}

function cashEffect(
  custody: Custody,
  native: bigint,
  carrying: bigint,
): typeof Contracts.CashEffect.Type {
  return {
    accountId: custody.accountId,
    capacityVersion: custody.capacityVersion,
    nativeDeltaMinor: native.toString(),
    carryingDeltaMinor: carrying.toString(),
  };
}

export function readProcessorCustody(
  tx: Transaction,
  scope: Scope,
  account: Account,
  accountId: string,
  bookCurrency: string,
) {
  return Effect.gen(function* () {
    if (account.currency !== bookCurrency) return yield* readHolding(tx, scope, accountId);
    const effects = yield* Db.readCashEffects(tx, scope.bookId, accountId);
    const native = effects.reduce((sum, effect) => sum + BigInt(effect.nativeDeltaMinor), 0n);
    const carrying = effects.reduce((sum, effect) => sum + BigInt(effect.carryingDeltaMinor), 0n);

    return {
      accountId,
      nativeMinor: native.toString(),
      carryingMinor: carrying.toString(),
      capacityVersion: yield* digest(effects),
    };
  });
}

function release(custody: Custody, native: bigint, foreign: boolean) {
  if (native < 0n || native > BigInt(custody.nativeMinor))
    return Effect.fail(failure("InvalidJournal"));

  if (!foreign) return Effect.succeed(native);

  return checked(
    Cash.planCashWithdrawal(
      {
        originalNativeMinor: custody.nativeMinor,
        originalCarryingMinor: custody.carryingMinor,
        consumedNativeMinor: "0",
        releasedCarryingMinor: "0",
        capacityVersion: custody.capacityVersion,
      },
      native.toString(),
      "exact",
    ),
  ).pipe(Effect.map((value) => BigInt(value.carryingReleasedMinor)));
}

function position(rows: ReadonlyArray<Db.PositionRow>) {
  return Effect.gen(function* () {
    const native = rows.reduce((sum, row) => sum + BigInt(row.nativeDeltaMinor), 0n);
    const carrying = rows.reduce((sum, row) => sum + BigInt(row.carryingDeltaMinor), 0n);

    if (native < 0n || carrying < 0n || (native === 0n && carrying !== 0n))
      return yield* failure("StaleDependency");

    return {
      nativeMinor: native.toString(),
      carryingMinor: carrying.toString(),
      version: yield* digest(rows),
    };
  });
}

function readObservation(tx: Transaction, scope: Scope, account: Account, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readObservation(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");
    const observation = yield* decode(Contracts.Observation, row.body);

    if (observation.accountId !== account.id || observation.classification !== "supported")
      return yield* failure("UnsupportedProfile");

    return observation;
  });
}

function readBasis(tx: Transaction, scope: Scope, input: Input) {
  return Effect.gen(function* () {
    const account = yield* readProcessorAccount(tx, scope, input.accountId);
    const book = (yield* PostingDb.readBook(tx, scope))[0];
    const period = (yield* PostingDb.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];
    const evidence = (yield* PostingDb.readEvidence(tx, scope.bookId, input.evidenceId))[0];

    if (!book || book.authority !== "native" || book.profile !== "synthetic-core-v1")
      return yield* failure("UnsupportedProfile");

    if (!period || period.locked || input.date < period.startsOn || input.date > period.endsOn)
      return yield* failure("PeriodLocked");

    if (!evidence) return yield* failure("MissingEvidence");

    if (input.date < account.openedOn) return yield* failure("InvalidJournal");

    if (account.currency !== book.currency) {
      for (const id of [
        account.processorControlAccountId,
        account.payoutTransitAccountId,
        account.disputeReceivableAccountId,
      ]) {
        const latest = (yield* CashDb.readLatestPostingDate(tx, scope.bookId, id))[0]?.latestOn;

        if (latest && latest > input.date) return yield* failure("StaleDependency");
      }
    }

    const ids = [
      account.processorControlAccountId,
      account.payoutTransitAccountId,
      account.feeCostAccountId,
      account.disputeReceivableAccountId,
      account.disputeLossAccountId,
      account.bankAccountId,
      account.gainAccountId,
      account.lossAccountId,
    ];

    const accounts = yield* PostingDb.readAccounts(tx, scope.bookId, ids);

    if (accounts.length !== ids.length || accounts.some((row) => !row.active))
      return yield* failure("StaleDependency");

    const processor = yield* readProcessorCustody(
      tx,
      scope,
      account,
      account.processorControlAccountId,
      book.currency,
    );

    const transit = yield* readProcessorCustody(
      tx,
      scope,
      account,
      account.payoutTransitAccountId,
      book.currency,
    );

    const snapshot: Snapshot = {
      account,
      book: {
        currency: book.currency,
        scale: book.currencyScale,
        profileVersion: book.profileVersion.toString(),
        writerEpoch: book.writerEpoch.toString(),
      },
      periodVersion: period.version.toString(),
      accounts: accounts.map((row) => ({ id: row.id, version: row.version.toString() })),
      evidence: { id: evidence.id, sha256: evidence.sha256 },
      processor,
      transit,
    };

    return { account, book, period, snapshot };
  });
}

function sourceIdentity(account: Account, observation: Observation) {
  return checked(
    canonicalizeJson({
      version: 1,
      kind: "balance_transaction",
      accountId: account.providerAccountId,
      liveMode: account.liveMode,
      currency: account.currency,
      occurrenceId: observation.balanceTransactionId,
      providerPayoutId: observation.providerPayoutId,
    }),
  ).pipe(Effect.map((value) => value.json));
}

function compileLeaf(
  account: Account,
  observation: Observation,
  receivable: string,
  liability: string,
  remainingRefund: string,
  dispute: Position | undefined,
) {
  if (!Schema.is(Clearing.ProcessorEventType)(observation.type))
    return Effect.fail(failure("UnsupportedProfile"));

  return checked(
    Clearing.compileProcessorEffect({
      observation: {
        accountId: account.providerAccountId,
        liveMode: account.liveMode,
        currency: account.currency,
        balanceTransactionId: observation.balanceTransactionId,
        providerPayoutId: observation.providerPayoutId,
        rawSourceRef: observation.rawSourceRef,
        eventType: observation.type,
        currencySupported:
          observation.currency === account.currency &&
          observation.currencyScale === account.currencyScale,
        grossMinor: observation.grossMinor,
        feeMinor: observation.feeMinor,
        netMinor: observation.netMinor,
        availableOn: observation.availableOn,
      },
      accounts: {
        processorControlAccountId: account.processorControlAccountId,
        feeCostAccountId: account.feeCostAccountId,
        receivableAccountId: receivable,
        customerCreditLiabilityAccountId: liability,
        payoutTransitAccountId: account.payoutTransitAccountId,
        disputeReceivableAccountId: account.disputeReceivableAccountId,
      },
      accountLiveMode: account.liveMode,
      recognizedSaleRelationship: receivable !== account.processorControlAccountId,
      remainingRefundCapacityMinor: remainingRefund,
      dispute:
        observation.disputeId === null
          ? null
          : {
              disputeId: observation.disputeId,
              remainingReceivableMinor: dispute?.nativeMinor ?? "0",
            },
    }),
  );
}

function rateAmounts(
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "observation" }>,
  base: AwaitedBasis,
  observation: Observation,
) {
  return Effect.gen(function* () {
    if (!input.rateObservationId || !input.rateDigest) return yield* failure("MissingEvidence");
    const row = (yield* FxDb.readCurrentRate(tx, scope.bookId, input.rateObservationId))[0];

    if (
      !row ||
      (yield* FxDb.readRateWithdrawal(tx, scope.bookId, input.rateObservationId)).length > 0
    )
      return yield* failure("StaleDependency");
    const rate = yield* decode(Rates.ExchangeRateRevision, row.body);

    if (
      rate.digest !== input.rateDigest ||
      rate.terms.fromCurrency !== base.account.currency ||
      rate.terms.toCurrency !== base.book.currency ||
      rate.terms.effectiveOn > input.date
    )
      return yield* failure("StaleDependency");
    base.snapshot.rate = rate;

    const gross = yield* checked(
      Cash.valueCashHolding(
        observation.grossMinor,
        "0",
        rate.terms.rateNumerator,
        rate.terms.rateDenominator,
        false,
        base.account.currencyScale,
        base.book.currencyScale,
      ),
    );

    const fee = yield* checked(
      Cash.valueCashHolding(
        observation.feeMinor,
        "0",
        rate.terms.rateNumerator,
        rate.terms.rateDenominator,
        false,
        base.account.currencyScale,
        base.book.currencyScale,
      ),
    );

    return { gross: BigInt(gross.targetMinor), fee: BigInt(fee.targetMinor) };
  });
}

type AwaitedBasis = Effect.Success<ReturnType<typeof readBasis>>;

type EffectBody = Pick<
  Compilation,
  "journal" | "cashEffects" | "obligation" | "payoutEffect" | "disputeEffect"
>;

function compileCharge(
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "observation" }>,
  base: AwaitedBasis,
  observation: Observation,
): Effect.Effect<EffectBody, unknown> {
  return Effect.gen(function* () {
    const native = BigInt(observation.grossMinor);

    if (base.account.currency === base.book.currency) {
      if (!input.invoiceId || input.fxItemId || input.creditOriginId)
        return yield* failure("InvalidJournal");

      const capacity = yield* readProcessorReceivableCapacity(tx, scope, {
        invoiceId: input.invoiceId,
      });

      if (
        capacity.currency !== base.account.currency ||
        capacity.currencyScale !== base.account.currencyScale ||
        native > BigInt(capacity.remainingMinor)
      )
        return yield* failure("StaleDependency");
      base.snapshot.capacity = {
        id: capacity.invoiceId,
        version: capacity.version,
        remainingMinor: capacity.remainingMinor,
      };

      const leaf = yield* compileLeaf(
        base.account,
        observation,
        capacity.receivableAccountId,
        base.account.processorControlAccountId,
        "0",
        undefined,
      );

      return {
        journal: [...leaf.journal],
        cashEffects: [
          cashEffect(
            base.snapshot.processor,
            BigInt(observation.netMinor),
            BigInt(observation.netMinor),
          ),
        ],
        obligation: {
          kind: "receivable",
          sourceId: capacity.invoiceId,
          capacityVersion: capacity.version,
          nativeMinor: observation.grossMinor,
          carryingMinor: observation.grossMinor,
          accountId: capacity.receivableAccountId,
        },
      };
    }

    if (!input.fxItemId || input.invoiceId || input.creditOriginId)
      return yield* failure("InvalidJournal");
    const state = yield* readItemState(tx, scope, input.fxItemId);
    const item = yield* decode(Fx.MonetaryItem, yield* toJsonObject(state.item));
    const control = item.accountBindings.find((binding) => binding.role === "control");

    if (
      !control ||
      item.direction !== "customer" ||
      item.original.currency !== base.account.currency ||
      item.original.scale !== base.account.currencyScale ||
      native > BigInt(item.remainingOriginalMinor)
    )
      return yield* failure("StaleDependency");
    base.snapshot.fxItem = item;
    yield* compileLeaf(
      base.account,
      observation,
      control.accountId,
      base.account.processorControlAccountId,
      "0",
      undefined,
    );

    const released = yield* checked(
      cumulativeRelease(
        BigInt(item.initialCarryingMinor),
        BigInt(item.initialOriginalMinor),
        BigInt(item.initialOriginalMinor) - BigInt(item.remainingOriginalMinor),
        native,
        "half_up",
      ),
    );

    const spot = yield* rateAmounts(tx, scope, input, base, observation);
    const net = spot.gross - spot.fee;
    const result = spot.gross - released;

    const journal = [
      signed(base.account.processorControlAccountId, net, "Processor control net"),
      signed(base.account.feeCostAccountId, spot.fee, "Qualified processor fee cost"),
      signed(control.accountId, -released, "Customer AR principal allocation"),
    ];

    if (result !== 0n)
      journal.push(
        signed(
          result > 0n ? base.account.gainAccountId : base.account.lossAccountId,
          -result,
          "Processor realized FX result",
        ),
      );

    return {
      journal: journal.filter((line) => line.debitMinor !== "0" || line.creditMinor !== "0"),
      cashEffects: [cashEffect(base.snapshot.processor, BigInt(observation.netMinor), net)],
      obligation: {
        kind: "foreign_receivable",
        sourceId: item.id,
        capacityVersion: yield* digest(item),
        nativeMinor: observation.grossMinor,
        carryingMinor: released.toString(),
        accountId: control.accountId,
      },
    };
  });
}

function compileRefund(
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "observation" }>,
  base: AwaitedBasis,
  observation: Observation,
): Effect.Effect<EffectBody, unknown> {
  return Effect.gen(function* () {
    if (!input.creditOriginId || input.invoiceId || input.fxItemId)
      return yield* failure("InvalidJournal");

    const capacity = yield* readProcessorRefundCapacity(tx, scope, {
      originId: input.creditOriginId,
    });

    if (capacity.currency !== base.account.currency) return yield* failure("InvalidJournal");

    const leaf = yield* compileLeaf(
      base.account,
      observation,
      base.account.processorControlAccountId,
      capacity.liabilityAccountId,
      capacity.remainingMinor,
      undefined,
    );

    const principal = -BigInt(observation.grossMinor);
    const total = -BigInt(observation.netMinor);
    const foreign = base.account.currency !== base.book.currency;
    base.snapshot.capacity = {
      id: capacity.originId,
      version: capacity.version,
      remainingMinor: capacity.remainingMinor,
    };

    if (!foreign)
      return {
        journal: [...leaf.journal],
        cashEffects: [cashEffect(base.snapshot.processor, -total, -total)],
        obligation: {
          kind: "customer_credit",
          sourceId: capacity.originId,
          capacityVersion: capacity.version,
          nativeMinor: principal.toString(),
          carryingMinor: principal.toString(),
          accountId: capacity.liabilityAccountId,
        },
      };
    const credit = yield* readProcessorNativeCredit(tx, scope, capacity.originId);

    if (credit.witness.accountId !== base.account.id) return yield* failure("InvalidJournal");
    base.snapshot.nativeCredit = credit.witness;

    const carrying = yield* checked(
      cumulativeRelease(
        BigInt(credit.witness.originalCarryingMinor),
        BigInt(credit.witness.originalNativeMinor),
        BigInt(credit.witness.originalNativeMinor) - BigInt(credit.remainingNativeMinor),
        principal,
        "half_up",
      ),
    );

    const cash = yield* release(base.snapshot.processor, total, true);
    const cashPrincipal = yield* release(base.snapshot.processor, principal, true);
    const fee = cash - cashPrincipal;
    const result = carrying - cashPrincipal;

    const journal = [
      signed(capacity.liabilityAccountId, carrying, "Customer credit refund principal"),
      signed(base.account.feeCostAccountId, fee, "Qualified processor fee cost"),
      signed(base.account.processorControlAccountId, -cash, "Processor refund clearing"),
    ];

    if (result !== 0n)
      journal.push(
        signed(
          result > 0n ? base.account.gainAccountId : base.account.lossAccountId,
          -result,
          "Processor realized FX result",
        ),
      );

    return {
      journal: journal.filter((line) => line.debitMinor !== "0" || line.creditMinor !== "0"),
      cashEffects: [cashEffect(base.snapshot.processor, -total, -cash)],
      obligation: {
        kind: "native_customer_credit",
        sourceId: capacity.originId,
        capacityVersion: capacity.version,
        nativeMinor: principal.toString(),
        carryingMinor: carrying.toString(),
        accountId: capacity.liabilityAccountId,
      },
    };
  });
}

function compileSimple(
  base: AwaitedBasis,
  observation: Observation,
  dispute: Position | undefined,
): Effect.Effect<EffectBody, unknown> {
  return Effect.gen(function* () {
    const leaf = yield* compileLeaf(
      base.account,
      observation,
      base.account.processorControlAccountId,
      base.account.processorControlAccountId,
      "0",
      dispute,
    );

    const foreign = base.account.currency !== base.book.currency;
    const net = BigInt(observation.netMinor);

    if (observation.type === "dispute_won") {
      if (!dispute || observation.disputeId === null) return yield* failure("InvalidJournal");

      const carrying = yield* release(
        {
          accountId: base.account.disputeReceivableAccountId,
          ...dispute,
          capacityVersion: dispute.version,
        },
        net,
        foreign,
      );

      return {
        journal: [
          signed(
            base.account.processorControlAccountId,
            carrying,
            "Processor control dispute release",
          ),
          signed(
            base.account.disputeReceivableAccountId,
            -carrying,
            "Clear dispute hold receivable",
          ),
        ],
        cashEffects: [cashEffect(base.snapshot.processor, net, carrying)],
        obligation: null,
        disputeEffect: {
          disputeId: observation.disputeId,
          nativeDeltaMinor: (-net).toString(),
          carryingDeltaMinor: (-carrying).toString(),
        },
      };
    }

    const carrying = yield* release(base.snapshot.processor, -net, foreign);
    const cashEffects = [cashEffect(base.snapshot.processor, net, -carrying)];

    if (observation.type === "payout") {
      cashEffects.push(cashEffect(base.snapshot.transit, -net, carrying));

      return {
        journal: [
          signed(base.account.payoutTransitAccountId, carrying, "Move payout to transit"),
          signed(base.account.processorControlAccountId, -carrying, "Processor payout clearing"),
        ],
        cashEffects,
        obligation: null,
        payoutEffect: {
          payoutObservationId: observation.id,
          kind: "movement",
          nativeDeltaMinor: (-net).toString(),
          carryingDeltaMinor: carrying.toString(),
        },
      };
    }

    if (observation.type === "dispute_hold") {
      if (observation.disputeId === null) return yield* failure("InvalidJournal");
      const principal = -BigInt(observation.grossMinor);
      const principalCarrying = yield* release(base.snapshot.processor, principal, foreign);

      return {
        journal: [
          signed(
            base.account.disputeReceivableAccountId,
            principalCarrying,
            "Recoverable dispute principal",
          ),
          signed(
            base.account.feeCostAccountId,
            carrying - principalCarrying,
            "Qualified processor fee cost",
          ),
          signed(base.account.processorControlAccountId, -carrying, "Processor dispute clearing"),
        ].filter((line) => line.debitMinor !== "0" || line.creditMinor !== "0"),
        cashEffects,
        obligation: null,
        disputeEffect: {
          disputeId: observation.disputeId,
          nativeDeltaMinor: principal.toString(),
          carryingDeltaMinor: principalCarrying.toString(),
        },
      };
    }

    return {
      journal: foreign
        ? [
            signed(base.account.feeCostAccountId, carrying, "Qualified processor fee cost"),
            signed(base.account.processorControlAccountId, -carrying, "Processor control clearing"),
          ]
        : [...leaf.journal],
      cashEffects,
      obligation: null,
    };
  });
}

function compileObserved(
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "observation" | "dispute_loss" }>,
  base: AwaitedBasis,
) {
  return Effect.gen(function* () {
    const observation = yield* readObservation(tx, scope, base.account, input.observationId);

    if (input.date < observation.occurredOn) return yield* failure("InvalidJournal");
    const source = yield* readSourceOccurrenceInTransaction(tx, scope, observation.rawSourceRef);
    base.snapshot.observation = observation;
    base.snapshot.source = { id: source.id, sha256: source.sha256 };
    let dispute: Position | undefined;

    if (observation.disputeId !== null) {
      dispute = yield* position(
        yield* Db.readDisputeEffects(tx, scope.bookId, base.account.id, observation.disputeId),
      );
      base.snapshot.dispute = dispute;
    }

    const identity = yield* sourceIdentity(base.account, observation);
    let effect: EffectBody;

    if (input.kind === "dispute_loss") {
      if (
        observation.type !== "dispute_lost" ||
        observation.disputeId === null ||
        !dispute ||
        BigInt(dispute.nativeMinor) <= 0n ||
        observation.grossMinor !== "0" ||
        observation.feeMinor !== "0" ||
        observation.netMinor !== "0"
      )
        return yield* failure("UnsupportedProfile");
      effect = {
        journal: [
          signed(
            base.account.disputeLossAccountId,
            BigInt(dispute.carryingMinor),
            "Reviewed dispute loss",
          ),
          signed(
            base.account.disputeReceivableAccountId,
            -BigInt(dispute.carryingMinor),
            "Clear lost dispute receivable",
          ),
        ],
        cashEffects: [],
        obligation: null,
        disputeEffect: {
          disputeId: observation.disputeId,
          nativeDeltaMinor: (-BigInt(dispute.nativeMinor)).toString(),
          carryingDeltaMinor: (-BigInt(dispute.carryingMinor)).toString(),
        },
      };
    } else if (observation.type === "charge" || observation.type === "payment")
      effect = yield* compileCharge(tx, scope, input, base, observation);
    else if (observation.type === "refund")
      effect = yield* compileRefund(tx, scope, input, base, observation);
    else effect = yield* compileSimple(base, observation, dispute);

    return { ...effect, sourceIdentity: identity };
  });
}

function payoutBasis(tx: Transaction, scope: Scope, account: Account, observationId: string) {
  return Effect.gen(function* () {
    const observation = yield* readObservation(tx, scope, account, observationId);

    if (
      observation.type !== "payout" ||
      observation.providerPayoutId === null ||
      (yield* Db.readObservationEffect(tx, scope.bookId, observation.id)).length === 0
    )
      return yield* failure("StaleDependency");

    const remaining = yield* position(
      yield* Db.readPayoutEffects(tx, scope.bookId, observation.id),
    );

    if (BigInt(remaining.nativeMinor) <= 0n) return yield* failure("StaleDependency");

    return {
      observation,
      remaining,
      reference: {
        accountId: account.providerAccountId,
        liveMode: account.liveMode,
        currency: account.currency,
        providerPayoutId: observation.providerPayoutId,
      },
    };
  });
}

function compileBankReceipt(
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "bank_receipt" }>,
  base: AwaitedBasis,
) {
  return Effect.gen(function* () {
    const payout = yield* payoutBasis(tx, scope, base.account, input.payoutObservationId);

    const bank = (yield* BankDb.readObservation(
      tx,
      scope.bookId,
      input.bankObservation.statementId,
      input.bankObservation.rowOrdinal,
    ))[0];

    const statement = (yield* BankDb.readStatement(
      tx,
      scope.bookId,
      input.bankObservation.statementId,
    ))[0];

    if (!bank || !statement) return yield* failure("NotFound");

    if (
      bank.accountId !== base.account.bankAccountId ||
      bank.providerId !== payout.observation.providerPayoutId ||
      bank.sourceBankAccountId !== payout.observation.destinationBankAccountId ||
      bank.amountMinor !== payout.remaining.nativeMinor ||
      bank.observedOn !== input.date ||
      textField(statement.importInput, "currency") !== base.account.currency
    )
      return yield* failure("InvalidJournal");

    if ((yield* Db.readBankClaim(tx, scope.bookId, bank.statementId, bank.rowOrdinal)).length > 0)
      return yield* failure("IdempotencyConflict");

    const revisions = yield* CashDb.readNativeSourceRevisions(
      tx,
      scope.bookId,
      bank.statementId,
      bank.rowOrdinal,
    );

    if (
      revisions.some((row) => row.changeKind === "removed" || row.amountMinor !== bank.amountMinor)
    )
      return yield* failure("StaleDependency");
    base.snapshot.bank = yield* toJsonObject(bank);
    base.snapshot.bankRevisions = revisions;
    base.snapshot.observation = payout.observation;
    base.snapshot.payout = payout.remaining;
    const foreign = base.account.currency !== base.book.currency;
    const carrying = BigInt(payout.remaining.carryingMinor);
    let adoptedVoucherId: string | null = null;
    let adoptedLineId: string | null = null;

    if (input.adoptedVoucherId || input.adoptedBankLineId) {
      if (foreign || !input.adoptedVoucherId || !input.adoptedBankLineId)
        return yield* failure("UnsupportedProfile");
      const voucher = (yield* PostingDb.readVoucher(tx, scope.bookId, input.adoptedVoucherId))[0];

      if (
        !voucher ||
        (yield* PostingDb.readVoucherByReversal(tx, scope.bookId, voucher.id)).length > 0 ||
        (yield* Db.readOwnedVoucher(tx, scope.bookId, voucher.id)).length > 0
      )
        return yield* failure("StaleDependency");
      const lines = arrayField(voucher.action, "lines");
      const bankLine = lines.find((line) => textField(line, "lineId") === input.adoptedBankLineId);

      if (
        lines.length !== 2 ||
        !bankLine ||
        textField(bankLine, "accountId") !== base.account.bankAccountId ||
        textField(bankLine, "debitMinor") !== carrying.toString() ||
        textField(bankLine, "creditMinor") !== "0" ||
        !lines.some(
          (line) =>
            textField(line, "accountId") === base.account.payoutTransitAccountId &&
            textField(line, "creditMinor") === carrying.toString() &&
            textField(line, "debitMinor") === "0",
        )
      )
        return yield* failure("InvalidJournal");
      base.snapshot.adoptedAction = voucher.action;
      adoptedVoucherId = voucher.id;
      adoptedLineId = input.adoptedBankLineId;
    }

    const leaf = yield* checked(
      Clearing.recordBankPayoutReceipt({
        payout: payout.reference,
        bankObservationId: `${bank.statementId}:${bank.rowOrdinal}`,
        payoutAmountMinor: bank.amountMinor,
        transitCapacityMinor: payout.remaining.nativeMinor,
        currencyMatches: true,
        providerBankRelationship: true,
        adoptedPostingRef: adoptedVoucherId,
        bankAccountId: base.account.bankAccountId,
        payoutTransitAccountId: base.account.payoutTransitAccountId,
      }),
    );

    const cashEffects = [cashEffect(base.snapshot.transit, -BigInt(bank.amountMinor), -carrying)];

    if (foreign) {
      const holding = yield* readHolding(tx, scope, base.account.bankAccountId);

      if (
        holding.nativeCurrency !== base.account.currency ||
        holding.nativeScale !== base.account.currencyScale
      )
        return yield* failure("InvalidJournal");
      cashEffects.push(cashEffect(holding, BigInt(bank.amountMinor), carrying));
    }

    return {
      sourceIdentity: leaf.sourceIdentity,
      journal: adoptedVoucherId
        ? []
        : [
            signed(base.account.bankAccountId, carrying, "Bank payout receipt"),
            signed(base.account.payoutTransitAccountId, -carrying, "Clear payout in transit"),
          ],
      cashEffects,
      obligation: null,
      payoutEffect: {
        payoutObservationId: payout.observation.id,
        kind: "receipt" as const,
        nativeDeltaMinor: (-BigInt(bank.amountMinor)).toString(),
        carryingDeltaMinor: (-carrying).toString(),
      },
      bankClaim: {
        statementId: bank.statementId,
        rowOrdinal: bank.rowOrdinal,
        accountId: bank.accountId,
        nativeMinor: bank.amountMinor,
        amountMinor: carrying.toString(),
        adoptedVoucherId,
        adoptedLineId,
      },
    };
  });
}

function compileFailure(
  tx: Transaction,
  scope: Scope,
  input: Extract<Input, { kind: "payout_failure" }>,
  base: AwaitedBasis,
) {
  return Effect.gen(function* () {
    const payout = yield* payoutBasis(tx, scope, base.account, input.payoutObservationId);
    const returned = yield* readObservation(tx, scope, base.account, input.failureObservationId);

    if (
      returned.type !== "payout_failure" ||
      returned.providerPayoutId !== payout.observation.providerPayoutId ||
      returned.netMinor !== payout.remaining.nativeMinor ||
      returned.grossMinor !== returned.netMinor ||
      returned.feeMinor !== "0" ||
      input.date < returned.occurredOn
    )
      return yield* failure("InvalidJournal");

    const evidence = (yield* PostingDb.readEvidence(
      tx,
      scope.bookId,
      input.nonSettlementEvidenceId,
    ))[0];

    if (!evidence || evidence.mediaType !== "application/json")
      return yield* failure("MissingEvidence");

    const proof = yield* Schema.decodeEffect(
      Schema.fromJsonString(Contracts.NonSettlementEvidence),
    )(evidence.content, { onExcessProperty: "error" }).pipe(
      Effect.mapError(() => failure("MissingEvidence")),
    );

    const statement = (yield* BankDb.readStatement(tx, scope.bookId, proof.statementId))[0];

    if (
      !statement ||
      statement.accountId !== base.account.bankAccountId ||
      proof.providerAccountId !== base.account.providerAccountId ||
      proof.providerPayoutId !== payout.observation.providerPayoutId ||
      proof.failureBalanceTransactionId !== returned.balanceTransactionId ||
      proof.bankAccountId !== base.account.bankAccountId ||
      proof.startsOn > payout.observation.occurredOn ||
      proof.endsOn < returned.occurredOn ||
      statement.startsOn !== proof.startsOn ||
      statement.endsOn !== proof.endsOn
    )
      return yield* failure("InvalidJournal");
    const completeness = objectField(statement.importInput, "completeness");

    if (
      !completeness ||
      !booleanField(completeness, "declaredComplete") ||
      arrayField(statement.importInput, "rows").length !== 0 ||
      textField(statement.importInput, "currency") !== base.account.currency ||
      textField(statement.importInput, "closingMinor") !==
        textField(statement.importInput, "openingMinor")
    )
      return yield* failure("UnsupportedProfile");

    if (
      (yield* Db.readPayoutBankReceipts(
        tx,
        scope.bookId,
        base.account.bankAccountId,
        proof.providerPayoutId,
      )).length > 0
    )
      return yield* failure("InvalidJournal");
    base.snapshot.nonSettlement = yield* toJsonObject({
      proof,
      statement,
      evidence: { id: evidence.id, sha256: evidence.sha256 },
    });
    base.snapshot.observation = returned;
    base.snapshot.payout = payout.remaining;

    const leaf = yield* checked(
      Clearing.reverseFailedPayout({
        payout: payout.reference,
        failureBalanceTransactionId: returned.balanceTransactionId,
        nonSettlementEvidenceRef: evidence.id,
        payoutAmountMinor: returned.netMinor,
        transitCapacityMinor: payout.remaining.nativeMinor,
        cashSettled: false,
        transitAccountId: base.account.payoutTransitAccountId,
        processorControlAccountId: base.account.processorControlAccountId,
      }),
    );

    const carrying = BigInt(payout.remaining.carryingMinor);

    return {
      sourceIdentity: leaf.sourceIdentity,
      journal: [
        signed(
          base.account.processorControlAccountId,
          carrying,
          "Return failed payout to processor control",
        ),
        signed(base.account.payoutTransitAccountId, -carrying, "Reverse payout in transit"),
      ],
      cashEffects: [
        cashEffect(base.snapshot.processor, BigInt(returned.netMinor), carrying),
        cashEffect(base.snapshot.transit, -BigInt(returned.netMinor), -carrying),
      ],
      obligation: null,
      payoutEffect: {
        payoutObservationId: payout.observation.id,
        kind: "failure" as const,
        nativeDeltaMinor: (-BigInt(returned.netMinor)).toString(),
        carryingDeltaMinor: (-carrying).toString(),
      },
    };
  });
}

export function compileProcessorReview(
  tx: Transaction,
  scope: Scope,
  input: Input,
): Effect.Effect<Compilation, unknown> {
  return Effect.gen(function* () {
    const base = yield* readBasis(tx, scope, input);

    const effect = yield* Match.value(input).pipe(
      Match.discriminator("kind")("bank_receipt", (receipt) =>
        compileBankReceipt(tx, scope, receipt, base),
      ),
      Match.discriminator("kind")("payout_failure", (failed) =>
        compileFailure(tx, scope, failed, base),
      ),
      Match.orElse((observed) => compileObserved(tx, scope, observed, base)),
    );

    if ((yield* Db.readSourceEffect(tx, scope.bookId, effect.sourceIdentity)).length > 0)
      return yield* failure("AlreadyPosted");

    const total = effect.journal.reduce(
      (sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor),
      0n,
    );

    if (total !== 0n) return yield* failure("InvalidJournal");

    return {
      account: base.account,
      ...effect,
      snapshot: base.snapshot,
      fiscalYearId: base.period.fiscalYearId,
      bookCurrency: base.book.currency,
    };
  });
}
