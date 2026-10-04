import * as Contracts from "@open-erp/contracts/foreign-cash";
import * as Rates from "@open-erp/contracts/exchange-rates";
import * as Cash from "@open-erp/domain/foreign-cash";
import { cumulativeRelease } from "@open-erp/domain/purchasing";
import { AccountingError } from "@open-erp/domain/errors";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as CashDb from "../../db/banking/foreign-cash";
import * as BankDb from "../../db/banking/statements";
import * as FxDb from "../../db/commerce/fx";
import * as Db from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { ensureEvent, postOwnedJournal, readItemState } from "../commerce/fx";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { addMatch } from "./matches";
import { arrayField, booleanField, isJsonObject, objectField, textField } from "./shared";

type Input = typeof Contracts.Prepare.Type;

type Holding = typeof Contracts.Holding.Type;

function checked<A>(outcome: Result.Result<A, { readonly message: string }>) {
  return Result.isFailure(outcome)
    ? Effect.fail(new AccountingError({ code: "InvalidJournal", message: outcome.failure.message }))
    : Effect.succeed(outcome.success);
}

function signedLine(
  accountId: string,
  signed: bigint,
  description: string,
): typeof Cash.ForeignCashJournalLine.Type {
  return {
    sourceLineId: null,
    accountId,
    debitMinor: (signed > 0n ? signed : 0n).toString(),
    creditMinor: (signed < 0n ? -signed : 0n).toString(),
    description,
  };
}

export function readHolding(transaction: Transaction, scope: Scope, accountId: string) {
  return Effect.gen(function* () {
    const row = (yield* CashDb.readAccount(transaction, scope.bookId, accountId))[0];

    if (!row) return yield* failure("NotFound");
    const opening = yield* decode(Contracts.Holding, row.body);
    const effects = yield* CashDb.readEffects(transaction, scope.bookId, accountId);

    const native = effects.reduce(
      (total, effect) => total + BigInt(effect.nativeDeltaMinor),
      BigInt(opening.nativeMinor),
    );

    const carrying = effects.reduce(
      (total, effect) => total + BigInt(effect.carryingDeltaMinor),
      BigInt(opening.carryingMinor),
    );

    if (native < 0n || carrying < 0n || (native === 0n && carrying !== 0n))
      return yield* failure("StaleDependency");
    const capacityVersion = yield* digest({ opening, effects });

    return yield* decode(Contracts.Holding, {
      ...opening,
      nativeMinor: native.toString(),
      carryingMinor: carrying.toString(),
      capacityVersion,
    });
  });
}

function readRate(
  transaction: Transaction,
  scope: Scope,
  input: Extract<Input, { readonly rateObservationId: string }>,
  holding: Holding,
  bookCurrency: string,
) {
  return Effect.gen(function* () {
    const row = (yield* FxDb.readCurrentRate(
      transaction,
      scope.bookId,
      input.rateObservationId,
    ))[0];

    if (!row) return yield* failure("NotFound");
    const rate = yield* decode(Rates.ExchangeRateRevision, row.body);

    if (
      (yield* FxDb.readRateWithdrawal(transaction, scope.bookId, input.rateObservationId)).length >
        0 ||
      rate.digest !== input.rateDigest
    )
      return yield* failure("StaleDependency");

    if (
      rate.terms.fromCurrency !== holding.nativeCurrency ||
      rate.terms.toCurrency !== bookCurrency ||
      rate.terms.effectiveOn > input.date
    )
      return yield* failure("InvalidJournal");

    return rate;
  });
}

function withdrawal(holding: Holding, nativeMinor: string) {
  return checked(
    Cash.planCashWithdrawal(
      {
        originalNativeMinor: holding.nativeMinor,
        originalCarryingMinor: holding.carryingMinor,
        consumedNativeMinor: "0",
        releasedCarryingMinor: "0",
        capacityVersion: holding.capacityVersion,
      },
      nativeMinor,
      "exact",
    ),
  );
}

function sourceIdentity(input: Input, accountId = input.accountId) {
  if (input.kind === "transfer" && accountId === input.receiverAccountId)
    return `bank:${input.receiverObservation.statementId}:${input.receiverObservation.rowOrdinal}`;

  return "nativeObservation" in input
    ? `bank:${input.nativeObservation.statementId}:${input.nativeObservation.rowOrdinal}`
    : input.sourceIdentity;
}

type CashSnapshot = {
  book: { currency: string; scale: number; profileVersion: string; writerEpoch: string };
  periodVersion: string;
  accounts: ReadonlyArray<{ id: string; version: string }>;
  evidence: { id: string; sha256: string };
  opening?: Holding;
  openingLines?: ReadonlyArray<{
    voucherId: string;
    lineId: string;
    postingDate: string;
    signedMinor: string;
  }>;
  holding?: Holding;
  receiver?: Holding;
  rate?: Schema.JsonObject;
  item?: Schema.JsonObject;
  nativeObservation?: Schema.JsonObject;
  sourceRevisions?: ReadonlyArray<{
    revisionId: string;
    eligibilityVersion: string;
    changeKind: string;
    amountMinor: string | null;
  }>;
  bookObservation?: Schema.JsonObject;
  bookSourceRevisions?: ReadonlyArray<{
    revisionId: string;
    eligibilityVersion: string;
    changeKind: string;
    amountMinor: string | null;
  }>;
  receiverObservation?: Schema.JsonObject;
  receiverSourceRevisions?: CashSnapshot["sourceRevisions"];
  feeEvidence?: Schema.JsonObject;
};

type CashCompilation = {
  snapshot: CashSnapshot;
  effects: Array<typeof Contracts.HoldingEffect.Type>;
  obligation: typeof Contracts.ObligationConsumption.Type | null;
  journal: typeof Cash.ForeignCashJournalLines.Type;
};

type CashBook = { readonly currency: string; readonly currencyScale: number };

function readCashBasis(transaction: Transaction, scope: Scope, input: Input) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];
    const period = (yield* Db.readPeriod(transaction, scope.bookId, input.accountingPeriodId))[0];

    if (!book || book.authority !== "native" || book.profile !== "synthetic-core-v1")
      return yield* failure("UnsupportedProfile");

    if (!period || period.locked || input.date < period.startsOn || input.date > period.endsOn)
      return yield* failure("PeriodLocked");
    const evidence = (yield* Db.readEvidence(transaction, scope.bookId, input.evidenceId))[0];

    if (!evidence) return yield* failure("NotFound");
    const accountIds = new Set([input.accountId]);

    if ("receiverAccountId" in input) accountIds.add(input.receiverAccountId);

    if ("gainAccountId" in input) {
      accountIds.add(input.gainAccountId);
      accountIds.add(input.lossAccountId);
    }

    if (input.kind === "exchange") accountIds.add(input.feeAccountId);

    if ("gainAccountId" in input) {
      const cashAccounts = [
        input.accountId,
        ...("receiverAccountId" in input ? [input.receiverAccountId] : []),
      ];

      if (
        input.gainAccountId === input.lossAccountId ||
        cashAccounts.includes(input.gainAccountId) ||
        cashAccounts.includes(input.lossAccountId)
      )
        return yield* failure("InvalidJournal");

      if (
        input.kind === "exchange" &&
        [
          input.accountId,
          input.receiverAccountId,
          input.gainAccountId,
          input.lossAccountId,
        ].includes(input.feeAccountId)
      )
        return yield* failure("InvalidJournal");
    }

    const accounts = yield* Db.readAccounts(transaction, scope.bookId, [...accountIds]);

    if (accounts.length !== accountIds.size || accounts.some((account) => !account.active))
      return yield* failure("InvalidJournal");

    if ((yield* FxDb.readBankAccount(transaction, scope.bookId, input.accountId)).length === 0)
      return yield* failure("InvalidJournal");

    if (
      (yield* CashDb.readSourceIdentity(
        transaction,
        scope.bookId,
        input.accountId,
        sourceIdentity(input),
      )).length > 0
    )
      return yield* failure("IdempotencyConflict");

    const snapshot: CashSnapshot = {
      book: {
        currency: book.currency,
        scale: book.currencyScale,
        profileVersion: book.profileVersion.toString(),
        writerEpoch: book.writerEpoch.toString(),
      },
      periodVersion: period.version.toString(),
      accounts: accounts.map((account) => ({
        id: account.id,
        version: account.version.toString(),
      })),
      evidence: { id: evidence.id, sha256: evidence.sha256 },
    };

    return { book, period, snapshot };
  });
}

function compileOpening(
  transaction: Transaction,
  scope: Scope,
  input: Extract<Input, { readonly kind: "open" }>,
  book: CashBook,
  compilation: CashCompilation,
) {
  return Effect.gen(function* () {
    if (
      input.nativeCurrency === book.currency ||
      (yield* CashDb.readAccount(transaction, scope.bookId, input.accountId)).length > 0
    )
      return yield* failure("InvalidJournal");

    const latestOn = (yield* CashDb.readLatestPostingDate(
      transaction,
      scope.bookId,
      input.accountId,
    ))[0]?.latestOn;

    if (latestOn !== null && latestOn !== undefined && latestOn > input.date)
      return yield* failure("StaleDependency");

    const carrying = (yield* CashDb.readLedger(
      transaction,
      scope.bookId,
      input.accountId,
      input.date,
    ))[0]?.carryingMinor;

    if (
      carrying === undefined ||
      BigInt(carrying) < 0n ||
      (input.openingNativeMinor === "0" && carrying !== "0")
    )
      return yield* failure("InvalidJournal");
    compilation.snapshot.openingLines = yield* CashDb.readOpeningLines(
      transaction,
      scope.bookId,
      input.accountId,
      input.date,
    );
    compilation.snapshot.opening = {
      accountId: input.accountId,
      nativeCurrency: input.nativeCurrency,
      nativeScale: input.nativeScale,
      openedOn: input.date,
      nativeMinor: input.openingNativeMinor,
      carryingMinor: carrying,
      capacityVersion: yield* digest({
        accountId: input.accountId,
        nativeMinor: input.openingNativeMinor,
        carryingMinor: carrying,
      }),
    };
  });
}

function readNativeWitness(
  transaction: Transaction,
  scope: Scope,
  reference: typeof Contracts.NativeObservation.Type,
  holding: Holding,
  date: string,
  expectedNative: string,
) {
  return Effect.gen(function* () {
    const observation = (yield* BankDb.readObservation(
      transaction,
      scope.bookId,
      reference.statementId,
      reference.rowOrdinal,
    ))[0];

    const statement = (yield* BankDb.readStatement(
      transaction,
      scope.bookId,
      reference.statementId,
    ))[0];

    if (
      !observation ||
      !statement ||
      observation.accountId !== holding.accountId ||
      observation.observedOn !== date ||
      observation.amountMinor !== expectedNative ||
      statement.source.currency !== holding.nativeCurrency
    )
      return yield* failure("InvalidJournal");

    if (
      (yield* CashDb.readNativeConsumption(
        transaction,
        scope.bookId,
        reference.statementId,
        reference.rowOrdinal,
      )).length > 0 ||
      (yield* CashDb.readNativeSourceCapacity(
        transaction,
        scope.bookId,
        reference.statementId,
        reference.rowOrdinal,
      ))[0]?.consumed !== false
    )
      return yield* failure("IdempotencyConflict");

    const sourceRevisions = yield* CashDb.readNativeSourceRevisions(
      transaction,
      scope.bookId,
      reference.statementId,
      reference.rowOrdinal,
    );

    if (
      sourceRevisions.some(
        (revision) =>
          revision.changeKind === "removed" || revision.amountMinor !== observation.amountMinor,
      )
    )
      return yield* failure("StaleDependency");

    return {
      sourceRevisions,
      observation: yield* toJsonObject({ ...observation, currency: statement.source.currency }),
    };
  });
}

function readCashSource(
  transaction: Transaction,
  scope: Scope,
  input: Exclude<Input, { readonly kind: "open" }>,
  compilation: CashCompilation,
) {
  return Effect.gen(function* () {
    const holding = yield* readHolding(transaction, scope, input.accountId);
    const history = yield* CashDb.readEffects(transaction, scope.bookId, input.accountId);

    if (input.date < holding.openedOn || history.some((effect) => effect.actualOn > input.date))
      return yield* failure("StaleDependency");
    compilation.snapshot.holding = holding;

    if ("nativeObservation" in input) {
      const witness = yield* readNativeWitness(
        transaction,
        scope,
        input.nativeObservation,
        holding,
        input.date,
        input.kind === "receipt" ? input.nativeMinor : `-${input.nativeMinor}`,
      );

      compilation.snapshot.sourceRevisions = witness.sourceRevisions;
      compilation.snapshot.nativeObservation = witness.observation;
    }

    return holding;
  });
}

function compileTransfer(
  transaction: Transaction,
  scope: Scope,
  input: Extract<Input, { readonly kind: "transfer" }>,
  holding: Holding,
  compilation: CashCompilation,
) {
  return Effect.gen(function* () {
    const receiver = yield* readHolding(transaction, scope, input.receiverAccountId);

    if (
      receiver.accountId === holding.accountId ||
      receiver.nativeCurrency !== holding.nativeCurrency ||
      receiver.nativeScale !== holding.nativeScale ||
      input.date < receiver.openedOn
    )
      return yield* failure("InvalidJournal");

    const receiverHistory = yield* CashDb.readEffects(
      transaction,
      scope.bookId,
      receiver.accountId,
    );

    if (receiverHistory.some((effect) => effect.actualOn > input.date))
      return yield* failure("StaleDependency");

    const witness = yield* readNativeWitness(
      transaction,
      scope,
      input.receiverObservation,
      receiver,
      input.date,
      input.nativeMinor,
    );

    compilation.snapshot.receiverObservation = witness.observation;
    compilation.snapshot.receiverSourceRevisions = witness.sourceRevisions;
    compilation.snapshot.receiver = receiver;
    const released = yield* withdrawal(holding, input.nativeMinor);
    compilation.journal = yield* checked(
      Cash.transferForeignCash(
        holding.accountId,
        receiver.accountId,
        input.nativeMinor,
        released.carryingReleasedMinor,
      ),
    );
    compilation.effects.push(
      {
        accountId: holding.accountId,
        nativeDeltaMinor: `-${input.nativeMinor}`,
        carryingDeltaMinor: (-BigInt(released.carryingReleasedMinor)).toString(),
      },
      {
        accountId: receiver.accountId,
        nativeDeltaMinor: input.nativeMinor,
        carryingDeltaMinor: released.carryingReleasedMinor,
      },
    );
  });
}

function compileValuation(
  transaction: Transaction,
  scope: Scope,
  input: Extract<Input, { readonly kind: "valuation" }>,
  holding: Holding,
  book: CashBook,
  compilation: CashCompilation,
) {
  return Effect.gen(function* () {
    const rate = yield* readRate(transaction, scope, input, holding, book.currency);
    compilation.snapshot.rate = yield* toJsonObject(rate);

    const valuation = yield* checked(
      Cash.valueCashHolding(
        holding.nativeMinor,
        holding.carryingMinor,
        rate.terms.rateNumerator,
        rate.terms.rateDenominator,
        false,
        holding.nativeScale,
        book.currencyScale,
      ),
    );

    const delta = BigInt(valuation.deltaMinor);
    compilation.journal =
      delta === 0n
        ? []
        : [
            signedLine(holding.accountId, delta, "Foreign cash valuation"),
            signedLine(
              delta > 0n ? input.gainAccountId : input.lossAccountId,
              -delta,
              "Unrealized FX result",
            ),
          ];
    compilation.effects.push({
      accountId: holding.accountId,
      nativeDeltaMinor: "0",
      carryingDeltaMinor: valuation.deltaMinor,
    });
  });
}

function compileExchange(
  transaction: Transaction,
  scope: Scope,
  input: Extract<Input, { readonly kind: "exchange" }>,
  holding: Holding,
  book: CashBook,
  compilation: CashCompilation,
) {
  return Effect.gen(function* () {
    if (
      input.receiverAccountId === holding.accountId ||
      (yield* CashDb.readAccount(transaction, scope.bookId, input.receiverAccountId)).length > 0 ||
      (yield* FxDb.readBankAccount(transaction, scope.bookId, input.receiverAccountId)).length === 0
    )
      return yield* failure("UnsupportedProfile");

    const observation = (yield* BankDb.readObservation(
      transaction,
      scope.bookId,
      input.bookObservation.statementId,
      input.bookObservation.rowOrdinal,
    ))[0];

    const statement = (yield* BankDb.readStatement(
      transaction,
      scope.bookId,
      input.bookObservation.statementId,
    ))[0];

    if (
      !observation ||
      !statement ||
      observation.accountId !== input.receiverAccountId ||
      observation.observedOn !== input.date ||
      statement.source.currency !== book.currency ||
      BigInt(observation.amountMinor) <= 0n
    )
      return yield* failure("InvalidJournal");

    if (
      (yield* CashDb.readBookConsumption(
        transaction,
        scope.bookId,
        input.bookObservation.statementId,
        input.bookObservation.rowOrdinal,
      )).length > 0 ||
      (yield* CashDb.readNativeSourceCapacity(
        transaction,
        scope.bookId,
        input.bookObservation.statementId,
        input.bookObservation.rowOrdinal,
      ))[0]?.consumed !== false
    )
      return yield* failure("IdempotencyConflict");

    const revisions = yield* CashDb.readNativeSourceRevisions(
      transaction,
      scope.bookId,
      input.bookObservation.statementId,
      input.bookObservation.rowOrdinal,
    );

    if (
      revisions.some(
        (revision) =>
          revision.changeKind === "removed" || revision.amountMinor !== observation.amountMinor,
      )
    )
      return yield* failure("StaleDependency");
    const feeEvidence = (yield* Db.readEvidence(transaction, scope.bookId, input.feeEvidenceId))[0];

    if (!feeEvidence || feeEvidence.mediaType !== "application/json")
      return yield* failure("MissingEvidence");

    const fee = yield* Schema.decodeEffect(Schema.fromJsonString(Contracts.ExchangeFee))(
      feeEvidence.content,
    ).pipe(Effect.mapError(() => failure("MissingEvidence")));

    if (fee.currency !== book.currency) return yield* failure("InvalidJournal");
    compilation.snapshot.bookObservation = yield* toJsonObject(observation);
    compilation.snapshot.bookSourceRevisions = revisions;
    compilation.snapshot.feeEvidence = {
      id: feeEvidence.id,
      sha256: feeEvidence.sha256,
      currency: fee.currency,
      feeMinor: fee.feeMinor,
    };
    const gross = (BigInt(observation.amountMinor) + BigInt(fee.feeMinor)).toString();
    const released = yield* withdrawal(holding, input.nativeMinor);
    compilation.journal = yield* checked(
      Cash.exchangeToBookCash(
        holding.accountId,
        input.receiverAccountId,
        input.feeAccountId,
        input.gainAccountId,
        input.lossAccountId,
        released.carryingReleasedMinor,
        gross,
        fee.feeMinor,
        true,
      ),
    );
    compilation.effects.push({
      accountId: holding.accountId,
      nativeDeltaMinor: `-${input.nativeMinor}`,
      carryingDeltaMinor: (-BigInt(released.carryingReleasedMinor)).toString(),
    });
  });
}

function compileObligation(
  transaction: Transaction,
  scope: Scope,
  input: Extract<Input, { readonly kind: "payable" | "receipt" }>,
  holding: Holding,
  book: CashBook,
  compilation: CashCompilation,
) {
  return Effect.gen(function* () {
    const state = yield* readItemState(transaction, scope, input.itemId);
    const item = state.item;
    const control = item.accountBindings.find((binding) => binding.role === "control");

    if (
      !control ||
      item.original.currency !== holding.nativeCurrency ||
      item.original.scale !== holding.nativeScale ||
      input.date < item.source.recognitionDate ||
      item.direction !== (input.kind === "payable" ? "supplier" : "customer")
    )
      return yield* failure("InvalidJournal");

    if ([holding.accountId, input.gainAccountId, input.lossAccountId].includes(control.accountId))
      return yield* failure("InvalidJournal");
    compilation.snapshot.item = yield* toJsonObject(item);

    const released = yield* checked(
      cumulativeRelease(
        BigInt(item.remainingCarryingMinor),
        BigInt(item.remainingOriginalMinor),
        0n,
        BigInt(input.nativeMinor),
        "exact",
      ),
    );

    compilation.obligation = {
      itemId: item.id,
      itemDigest: yield* digest(item),
      nativeMinor: input.nativeMinor,
      carryingMinor: released.toString(),
    };

    if (input.kind === "payable") {
      const cashRelease = yield* withdrawal(holding, input.nativeMinor);
      compilation.journal = yield* checked(
        Cash.compilePayableFromForeignCash(
          control.accountId,
          holding.accountId,
          input.gainAccountId,
          input.lossAccountId,
          released.toString(),
          cashRelease.carryingReleasedMinor,
        ),
      );
      compilation.effects.push({
        accountId: holding.accountId,
        nativeDeltaMinor: `-${input.nativeMinor}`,
        carryingDeltaMinor: (-BigInt(cashRelease.carryingReleasedMinor)).toString(),
      });
    } else {
      const rate = yield* readRate(transaction, scope, input, holding, book.currency);
      compilation.snapshot.rate = yield* toJsonObject(rate);

      const receipt = yield* checked(
        Cash.valueCashHolding(
          input.nativeMinor,
          "0",
          rate.terms.rateNumerator,
          rate.terms.rateDenominator,
          false,
          holding.nativeScale,
          book.currencyScale,
        ),
      );

      compilation.journal = yield* checked(
        Cash.receiveForeignCash(
          holding.accountId,
          control.accountId,
          input.gainAccountId,
          input.lossAccountId,
          receipt.targetMinor,
          released.toString(),
        ),
      );
      compilation.effects.push({
        accountId: holding.accountId,
        nativeDeltaMinor: input.nativeMinor,
        carryingDeltaMinor: receipt.targetMinor,
      });
    }
  });
}

function validateHoldingEffects(
  transaction: Transaction,
  scope: Scope,
  input: Input,
  effects: ReadonlyArray<typeof Contracts.HoldingEffect.Type>,
) {
  return Effect.gen(function* () {
    for (const effect of effects) {
      if (
        (yield* CashDb.readSourceIdentity(
          transaction,
          scope.bookId,
          effect.accountId,
          sourceIdentity(input, effect.accountId),
        )).length > 0
      )
        return yield* failure("IdempotencyConflict");
      const holding = yield* readHolding(transaction, scope, effect.accountId);
      const native = BigInt(holding.nativeMinor) + BigInt(effect.nativeDeltaMinor);
      const carrying = BigInt(holding.carryingMinor) + BigInt(effect.carryingDeltaMinor);

      if (native < 0n || carrying < 0n || (native === 0n && carrying !== 0n))
        return yield* failure("InvalidJournal");
      yield* decode(Contracts.Holding, {
        ...holding,
        nativeMinor: native.toString(),
        carryingMinor: carrying.toString(),
      });
    }
  });
}

function build(transaction: Transaction, scope: Scope, input: Input) {
  return Effect.gen(function* () {
    const basis = yield* readCashBasis(transaction, scope, input);

    const compilation: CashCompilation = {
      snapshot: basis.snapshot,
      effects: [],
      obligation: null,
      journal: [],
    };

    if (input.kind === "open") {
      yield* compileOpening(transaction, scope, input, basis.book, compilation);
    } else {
      const holding = yield* readCashSource(transaction, scope, input, compilation);

      if (input.kind === "transfer")
        yield* compileTransfer(transaction, scope, input, holding, compilation);
      else if (input.kind === "valuation")
        yield* compileValuation(transaction, scope, input, holding, basis.book, compilation);
      else if (input.kind === "exchange")
        yield* compileExchange(transaction, scope, input, holding, basis.book, compilation);
      else yield* compileObligation(transaction, scope, input, holding, basis.book, compilation);
    }

    yield* validateHoldingEffects(transaction, scope, input, compilation.effects);

    return {
      ...compilation,
      fiscalYearId: basis.period.fiscalYearId,
      bookCurrency: basis.book.currency,
    };
  });
}

export const prepareForeignCash = Effect.fn("foreignCash.prepare")(function* (
  token: string,
  command: { readonly scope: Scope; readonly idempotencyKey: string; readonly input: Input },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    const operation = "prepare_foreign_cash";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command.input),
      Contracts.Review,
    );

    if (request.previous) return request.previous;
    yield* requireTableAccess(transaction, CashDb.tables, true);
    yield* Db.lockBookForUpdate(transaction, command.scope);
    const compiled = yield* build(transaction, command.scope, command.input);
    const reviewId = newId("cash_review");
    let postingAction: Schema.JsonObject | null = null;

    if (compiled.journal.length > 0) {
      const eventId = yield* ensureEvent(
        transaction,
        command.scope,
        command.input.evidenceId,
        `cash_${reviewId}`,
      );

      const evidence = (yield* Db.readEvidence(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      ))[0];

      if (!evidence) return yield* failure("NotFound");
      postingAction = yield* toJsonObject({
        kind: "post_voucher",
        correctsVoucherId: null,
        fiscalYearId: compiled.fiscalYearId,
        accountingPeriodId: command.input.accountingPeriodId,
        series: command.input.series,
        postingDate: command.input.date,
        eventId,
        postingPurpose: "adjustment",
        occurrenceKey: reviewId,
        description: command.input.reason,
        currency: compiled.bookCurrency,
        rationale: command.input.reason,
        taxAssessment: "not_applicable",
        evidenceRefs: [
          {
            evidenceId: evidence.id,
            sha256: evidence.sha256,
            locator: command.input.sourceIdentity,
          },
        ],
        lines: compiled.journal.map((line) => ({ ...line, lineId: newId("line") })),
      });
    }

    const body = {
      id: reviewId,
      postingAction,
      scope: command.scope,
      actorId: principal.actorId,
      version: 1 as const,
      input: command.input,
      ...compiled,
      createdAt: yield* isoNow(transaction),
    };

    const review = yield* decode(Contracts.Review, { ...body, digest: yield* digest(body) });
    yield* CashDb.insertReview(transaction, {
      bookId: command.scope.bookId,
      id: review.id,
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

export const approveForeignCash = Effect.fn("foreignCash.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly reviewId: string;
    readonly input: typeof Contracts.Approve.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "approve_foreign_cash";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Approval,
    );

    if (request.previous) return request.previous;
    yield* Db.lockBookForUpdate(transaction, command.scope);
    const review = yield* getReview(transaction, command.scope, command.reviewId);

    if (command.input.digest !== review.digest) return yield* failure("StaleDependency");

    if (review.actorId === principal.actorId) return yield* failure("ApprovalRequired");
    yield* requireCurrentReview(transaction, command.scope, review);

    const approval = yield* decode(Contracts.Approval, {
      id: newId("cash_approval"),
      reviewId: review.id,
      actorId: principal.actorId,
      digest: review.digest,
      expiresAt: new Date(Date.parse(yield* isoNow(transaction)) + 3_600_000).toISOString(),
    });

    yield* CashDb.insertApproval(transaction, {
      bookId: command.scope.bookId,
      ...approval,
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

function getReview(transaction: Transaction, scope: Scope, reviewId: string) {
  return Effect.gen(function* () {
    const row = (yield* CashDb.readReview(transaction, scope.bookId, reviewId))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Review, row.body);
  });
}

function requireCurrentReview(
  transaction: Transaction,
  scope: Scope,
  review: typeof Contracts.Review.Type,
) {
  return Effect.gen(function* () {
    const compiled = yield* build(transaction, scope, review.input);

    if (
      (yield* digest(compiled)) !==
      (yield* digest({
        snapshot: review.snapshot,
        effects: review.effects,
        obligation: review.obligation,
        journal: review.journal,
        fiscalYearId: review.fiscalYearId,
        bookCurrency: review.bookCurrency,
      }))
    )
      return yield* failure("StaleDependency");
  });
}

function nativeClaims(input: Input) {
  if (!("nativeObservation" in input)) return [];

  const claims = [
    {
      observation: input.nativeObservation,
      accountId: input.accountId,
      nativeMinor: input.kind === "receipt" ? input.nativeMinor : `-${input.nativeMinor}`,
    },
  ];

  if (input.kind === "transfer")
    claims.push({
      observation: input.receiverObservation,
      accountId: input.receiverAccountId,
      nativeMinor: input.nativeMinor,
    });

  return claims;
}

function retainCashSourceConsumptions(
  transaction: Transaction,
  scope: Scope,
  review: typeof Contracts.Review.Type,
  voucherId: string | null,
  actorId: string,
) {
  return Effect.gen(function* () {
    for (const claim of nativeClaims(review.input)) {
      const cashLine = arrayField(review.postingAction, "lines").find(
        (line) => isJsonObject(line) && textField(line, "accountId") === claim.accountId,
      );

      const lineId = textField(cashLine, "lineId") ?? null;
      yield* CashDb.insertNativeConsumption(transaction, {
        bookId: scope.bookId,
        ...claim.observation,
        reviewId: review.id,
        accountId: claim.accountId,
        nativeMinor: claim.nativeMinor,
        voucherId,
        lineId,
        body: yield* toJsonObject({ reviewId: review.id, ...claim.observation, voucherId, lineId }),
      });
    }

    if (review.input.kind === "exchange") {
      const receiverAccountId = review.input.receiverAccountId;

      const bookLine = arrayField(review.postingAction, "lines").find(
        (line) => isJsonObject(line) && textField(line, "accountId") === receiverAccountId,
      );

      const lineId = textField(bookLine, "lineId");
      const amountMinor = textField(review.snapshot.bookObservation, "amountMinor");

      if (!voucherId || !lineId || !amountMinor) return yield* failure("InternalError");
      yield* CashDb.insertBookConsumption(transaction, {
        bookId: scope.bookId,
        ...review.input.bookObservation,
        reviewId: review.id,
        accountId: review.input.receiverAccountId,
        nativeMinor: amountMinor,
        voucherId,
        lineId,
        body: yield* toJsonObject({
          reviewId: review.id,
          ...review.input.bookObservation,
          voucherId,
          lineId,
        }),
      });
      yield* addMatch(
        transaction,
        scope.bookId,
        actorId,
        { ...review.input.bookObservation, voucherId, lineId },
        "explicit",
        review.id,
      );
    }
  });
}

export const executeForeignCash = Effect.fn("foreignCash.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly reviewId: string;
    readonly input: typeof Contracts.Execute.Type;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    const operation = "execute_foreign_cash";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Execution,
    );

    if (request.previous) return request.previous;
    yield* Db.lockBookForUpdate(transaction, command.scope);
    const review = yield* getReview(transaction, command.scope, command.reviewId);

    if (review.digest !== command.input.digest) return yield* failure("StaleDependency");

    if ((yield* CashDb.readExecution(transaction, command.scope.bookId, review.id)).length > 0)
      return yield* failure("AlreadyPosted");

    const row = (yield* CashDb.readApproval(
      transaction,
      command.scope.bookId,
      review.id,
      command.input.approvalId,
    ))[0];

    if (!row) return yield* failure("ApprovalRequired");
    const approval = yield* decode(Contracts.Approval, row.body);

    if (
      approval.digest !== review.digest ||
      approval.actorId === review.actorId ||
      Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(transaction)) ||
      (yield* Db.readOperatorMembership(transaction, command.scope.bookId, approval.actorId))
        .length === 0 ||
      (yield* Db.readActorAdmission(transaction, approval.actorId))[0]?.enabled === false
    )
      return yield* failure("ApprovalRequired");
    yield* requireCurrentReview(transaction, command.scope, review);
    let voucherId: string | null = null;

    if (review.journal.length > 0) {
      if (review.postingAction === null) return yield* failure("InternalError");

      const posted = yield* postOwnedJournal(
        transaction,
        command.scope,
        principal,
        { ...approval, bookId: command.scope.bookId, body: yield* toJsonObject(approval) },
        review.postingAction,
        { kind: "foreign_cash", id: review.id },
      );

      voucherId = posted.voucherId;
    }

    if (review.input.kind === "open") {
      const opening = review.snapshot.opening;

      if (!isJsonObject(opening)) return yield* failure("InternalError");
      const holding = yield* decode(Contracts.Holding, opening);
      yield* CashDb.insertAccount(transaction, {
        bookId: command.scope.bookId,
        accountId: holding.accountId,
        nativeCurrency: holding.nativeCurrency,
        nativeScale: holding.nativeScale,
        openedOn: holding.openedOn,
        body: yield* toJsonObject(holding),
      });

      for (const line of arrayField(review.snapshot, "openingLines")) {
        const openingVoucherId = textField(line, "voucherId");
        const openingLineId = textField(line, "lineId");

        if (!openingVoucherId || !openingLineId || !isJsonObject(line))
          return yield* failure("InternalError");
        yield* CashDb.insertOpeningLine(transaction, {
          bookId: command.scope.bookId,
          accountId: holding.accountId,
          voucherId: openingVoucherId,
          lineId: openingLineId,
          body: line,
        });
      }

      yield* CashDb.insertEffect(transaction, {
        bookId: command.scope.bookId,
        id: newId("cash_effect"),
        reviewId: review.id,
        accountId: holding.accountId,
        sourceIdentity: sourceIdentity(review.input),
        nativeDeltaMinor: "0",
        carryingDeltaMinor: "0",
        actualOn: review.input.date,
        voucherId,
        body: yield* toJsonObject(holding),
      });
    }

    for (const effect of review.effects)
      yield* CashDb.insertEffect(transaction, {
        bookId: command.scope.bookId,
        id: newId("cash_effect"),
        reviewId: review.id,
        sourceIdentity: sourceIdentity(review.input, effect.accountId),
        actualOn: review.input.date,
        voucherId,
        ...effect,
        body: yield* toJsonObject(effect),
      });

    const execution = yield* decode(Contracts.Execution, {
      reviewId: review.id,
      digest: review.digest,
      voucherId,
      effects: review.effects,
      obligation: review.obligation,
    });

    yield* CashDb.insertExecution(
      transaction,
      command.scope.bookId,
      review.id,
      yield* toJsonObject(execution),
    );

    if (review.obligation)
      yield* CashDb.insertObligationConsumption(transaction, {
        bookId: command.scope.bookId,
        id: review.id,
        ...review.obligation,
        body: yield* toJsonObject({ ...review.obligation, date: review.input.date, voucherId }),
      });

    yield* retainCashSourceConsumptions(
      transaction,
      command.scope,
      review,
      voucherId,
      principal.actorId,
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(execution),
    );

    return execution;
  });
});

export const getForeignCashHolding = Effect.fn("foreignCash.holding")(function* (
  token: string,
  command: { readonly scope: Scope; readonly accountId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    return yield* readHolding(transaction, command.scope, command.accountId);
  });
});

export const getForeignCashReview = Effect.fn("foreignCash.review")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reviewId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    return yield* getReview(transaction, command.scope, command.reviewId);
  });
});

export const reconcileForeignCash = Effect.fn("foreignCash.reconcile")(function* (
  token: string,
  command: { readonly scope: Scope; readonly accountId: string; readonly statementId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    const holding = yield* readHolding(transaction, command.scope, command.accountId);

    const statement = (yield* BankDb.readStatement(
      transaction,
      command.scope.bookId,
      command.statementId,
    ))[0];

    if (!statement) return yield* failure("NotFound");

    if (
      statement.accountId !== holding.accountId ||
      statement.source.currency !== holding.nativeCurrency ||
      typeof statement.source.closingMinor !== "string"
    )
      return yield* failure("InvalidJournal");
    const effects = yield* CashDb.readEffects(transaction, command.scope.bookId, command.accountId);

    if (effects.some((effect) => effect.actualOn > statement.endsOn))
      return yield* failure("StaleDependency");

    const ledger = (yield* CashDb.readLedger(
      transaction,
      command.scope.bookId,
      command.accountId,
      statement.endsOn,
    ))[0]?.carryingMinor;

    if (ledger === undefined) return yield* failure("InternalError");

    const sourceComplete =
      booleanField(objectField(statement.source, "completeness"), "declaredComplete") === true;

    const sourceConsumptionComplete =
      (yield* CashDb.readNativeStatementCoverage(
        transaction,
        command.scope.bookId,
        statement.id,
      ))[0]?.complete === true;

    const nativeDifferenceMinor = (
      BigInt(statement.source.closingMinor) - BigInt(holding.nativeMinor)
    ).toString();

    const bookDifferenceMinor = (BigInt(ledger) - BigInt(holding.carryingMinor)).toString();

    return yield* decode(Contracts.Reconciliation, {
      holding,
      statementId: statement.id,
      nativeStatementMinor: statement.source.closingMinor,
      nativeDifferenceMinor,
      ledgerCarryingMinor: ledger,
      bookDifferenceMinor,
      sourceComplete,
      sourceConsumptionComplete,
      nativeReconciled:
        sourceComplete && sourceConsumptionComplete && nativeDifferenceMinor === "0",
      bookReconciled: bookDifferenceMinor === "0",
    });
  });
});
