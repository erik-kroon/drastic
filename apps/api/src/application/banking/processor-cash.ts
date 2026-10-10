import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as Cash from "@open-erp/contracts/foreign-cash";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as CashDb from "../../db/banking/foreign-cash";
import { assertUniqueJsonKeys } from "../../adapters/json-keys";
import * as ProcessorDb from "../../db/banking/processor-clearing";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { readSourceBytesInTransaction } from "../source-retention";
import { decode, requireTableAccess, toJsonObject, type Scope } from "../commerce/support";
import { digest } from "../json";
import { failure } from "../failures";

export function registerProcessorCashHolding(
  tx: Transaction,
  scope: Scope,
  account: typeof Contracts.Account.Type,
  rawSourceRef: string,
) {
  return Effect.gen(function* () {
    const book = (yield* PostingDb.readBook(tx, scope))[0];

    if (!book || book.authority !== "native" || book.profile !== "synthetic-core-v1")
      return yield* failure("UnsupportedProfile");

    if (book.currency === account.currency) return;
    yield* requireTableAccess(tx, CashDb.tables, true);
    const owner = (yield* ProcessorDb.readAccount(tx, scope.bookId, account.id))[0];

    if (!owner || (yield* digest(owner.body)) !== (yield* digest(account)))
      return yield* failure("StaleDependency");
    const retained = yield* readSourceBytesInTransaction(tx, scope, rawSourceRef);
    const occurrence = retained.occurrence;

    const text = yield* Effect.try({
      try: () => {
        assertUniqueJsonKeys(retained.bytes);

        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(retained.bytes);
      },
      catch: () => failure("InvalidJournal"),
    });

    const page = yield* Schema.decodeEffect(Schema.fromJsonString(Contracts.ProviderPage))(text, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError(() => failure("InvalidJournal")));

    if (
      occurrence.sourceSystem !== account.profile ||
      occurrence.sourceAccountId !== account.providerAccountId ||
      page.profile !== account.profile ||
      page.accountId !== account.providerAccountId ||
      page.liveMode !== account.liveMode ||
      page.currency !== account.currency ||
      page.currencyScale !== account.currencyScale ||
      page.startsOn < account.openedOn
    )
      return yield* failure("InvalidJournal");

    const custody = [
      {
        accountId: account.processorControlAccountId,
        nativeMinor: page.openingMinor,
      },
      { accountId: account.payoutTransitAccountId, nativeMinor: "0" },
    ];

    for (const selection of custody) {
      const existing = (yield* CashDb.readAccount(tx, scope.bookId, selection.accountId))[0];

      if (existing) {
        const holding = yield* decode(Cash.Holding, existing.body);

        if (
          holding.nativeCurrency !== account.currency ||
          holding.nativeScale !== account.currencyScale
        )
          return yield* failure("StaleDependency");
        continue;
      }

      if (page.startsOn !== account.openedOn) return yield* failure("InvalidJournal");

      const current = (yield* PostingDb.readAccounts(tx, scope.bookId, [selection.accountId]))[0];

      if (!current?.active) return yield* failure("InvalidJournal");

      const latest = (yield* CashDb.readLatestPostingDate(tx, scope.bookId, selection.accountId))[0]
        ?.latestOn;

      if (latest && latest > page.startsOn) return yield* failure("StaleDependency");

      const lines = yield* CashDb.readOpeningLines(
        tx,
        scope.bookId,
        selection.accountId,
        page.startsOn,
      );

      const carrying = lines.reduce((sum, line) => sum + BigInt(line.signedMinor), 0n);

      if (
        BigInt(selection.nativeMinor) < 0n ||
        carrying < 0n ||
        (selection.nativeMinor === "0" && carrying !== 0n)
      )
        return yield* failure("InvalidJournal");

      const body = {
        accountId: selection.accountId,
        nativeCurrency: account.currency,
        nativeScale: account.currencyScale,
        openedOn: page.startsOn,
        nativeMinor: selection.nativeMinor,
        carryingMinor: carrying.toString(),
        capacityVersion: yield* digest({
          owner: account.id,
          source: occurrence,
          current: { id: current.id, version: current.version.toString() },
          lines,
          selection,
        }),
      };

      const holding = yield* decode(Cash.Holding, body);
      yield* CashDb.insertAccount(tx, {
        bookId: scope.bookId,
        ...holding,
        body: yield* toJsonObject(holding),
      });

      for (const line of lines)
        yield* CashDb.insertOpeningLine(tx, {
          bookId: scope.bookId,
          accountId: selection.accountId,
          voucherId: line.voucherId,
          lineId: line.lineId,
          body: yield* toJsonObject({ ownerId: account.id, source: occurrence, line }),
        });
    }
  });
}
