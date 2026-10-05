import * as Contracts from "@open-erp/contracts/processor-clearing";
import * as Clearing from "@open-erp/domain/processor-clearing";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Buffer } from "node:buffer";
import * as Db from "../../db/banking/processor-clearing";
import * as Posting from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import {
  configuredProcessorFeed,
  type ProcessorFeed,
} from "../../adapters/processor/local-fixture";
import { assertUniqueJsonKeys } from "../../adapters/json-keys";
import { RequestEnvironment } from "../../runtime/environment";
import { retainSource } from "../source-retention";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { digest, newId, replay, saveCommand } from "../posting";
import { failure, logFailure } from "../failures";
import { registerProcessorCashHolding } from "./processor-cash";

type Account = typeof Contracts.Account.Type;

type Selection = typeof Contracts.FetchSelection.Type;

type Page = typeof Contracts.ProviderPage.Type;

type RetainedPage = { readonly page: Page; readonly rawSourceRef: string };

export function readProcessorAccount(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readAccount(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Account, row.body);
  });
}

function checkPage(account: Account, selection: Selection, cursor: string | null, page: Page) {
  if (
    page.profile !== account.profile ||
    page.accountId !== account.providerAccountId ||
    page.liveMode !== account.liveMode ||
    page.currency !== account.currency ||
    page.currencyScale !== account.currencyScale ||
    page.startsOn !== selection.startsOn ||
    page.endsOn !== selection.endsOn ||
    page.cursor !== cursor ||
    page.view !== selection.view ||
    page.providerPayoutId !==
      (selection.view === "automatic_payout" ? selection.providerPayoutId : null)
  )
    return failure("InvalidJournal");

  if (
    page.rows.some(
      (row) => row.occurredOn < selection.startsOn || row.occurredOn > selection.endsOn,
    )
  )
    return failure("InvalidJournal");

  if (
    selection.view === "automatic_payout" &&
    page.rows.some((row) => row.payoutMethod === "manual")
  )
    return failure("UnsupportedProfile");

  return Effect.void;
}

function blocker(account: Account, row: typeof Contracts.ProviderRow.Type) {
  if (row.currency !== account.currency || row.currencyScale !== account.currencyScale)
    return "unsupported_currency_or_scale";

  if (BigInt(row.grossMinor) - BigInt(row.feeMinor) !== BigInt(row.netMinor))
    return "gross_fee_net_mismatch";

  if (BigInt(row.feeMinor) < 0n) return "refunded_fee_requires_qualified_variant";

  if (row.type === "payout_failure") return null;

  if (!Schema.is(Clearing.ProcessorEventType)(row.type))
    return `unsupported_provider_type:${row.type}`;

  if (row.type !== "payout" && row.providerPayoutId !== null)
    return "unexpected_originating_payout";

  if (
    row.type === "payout" &&
    (row.providerPayoutId === null || BigInt(row.netMinor) >= 0n || row.feeMinor !== "0")
  )
    return "unsupported_payout_shape";

  return null;
}

function normalize(tx: Transaction, scope: Scope, account: Account, retained: RetainedPage) {
  return Effect.gen(function* () {
    const observations: Array<typeof Contracts.Observation.Type> = [];

    for (const row of retained.page.rows) {
      const semanticDigest = yield* digest({
        accountId: account.id,
        liveMode: account.liveMode,
        ...row,
      });

      const existing = (yield* Db.readOccurrence(tx, scope.bookId, account.id, row.id))[0];

      if (existing) {
        if (existing.semanticDigest !== semanticDigest)
          return yield* failure("IdempotencyConflict");
        observations.push(yield* decode(Contracts.Observation, existing.body));
        continue;
      }

      const reason = blocker(account, row);

      const observation = yield* decode(Contracts.Observation, {
        ...row,
        id: newId("processor_observation"),
        balanceTransactionId: row.id,
        accountId: account.id,
        rawSourceRef: retained.rawSourceRef,
        semanticDigest,
        classification: reason === null ? "supported" : "requires_classification",
        blocker: reason,
      });

      yield* Db.insertObservation(tx, {
        bookId: scope.bookId,
        ...observation,
        body: yield* toJsonObject(observation),
      });
      observations.push(observation);
    }

    return observations;
  });
}

function obtainPage(
  token: string,
  scope: Scope,
  account: Account,
  selection: Selection,
  fetchId: string,
  cursor: string | null,
  feed: ProcessorFeed,
) {
  return Effect.gen(function* () {
    const cursorKey = cursor ?? "initial";

    const cached = yield* withBook(
      token,
      scope,
      false,
      function* (tx) {
        return (yield* Db.readFetchPage(tx, scope.bookId, fetchId, cursorKey))[0];
      },
      "share",
    );

    if (cached)
      return {
        page: yield* decode(Contracts.ProviderPage, cached.body),
        rawSourceRef: cached.rawSourceRef,
      };

    const response = yield* Effect.tryPromise({
      try: () =>
        feed.fetchPage({
          providerAccountId: account.providerAccountId,
          liveMode: account.liveMode,
          currency: account.currency,
          currencyScale: account.currencyScale,
          selection,
          cursor,
        }),
      catch: (cause) => failure("Unavailable", cause),
    }).pipe(Effect.tapError(logFailure));

    const retained = yield* retainSource(token, {
      scope,
      idempotencyKey: `processor_page_${fetchId}_${cursorKey}`,
      input: {
        sourceSystem: "synthetic_stripe_balance_v1",
        sourceAccountId: account.providerAccountId,
        occurrenceKey: `${fetchId}:${cursorKey}`,
        sourceRevision: "1",
        filename: "processor-page.json",
        mediaType: "application/json",
        contentBase64: Buffer.from(response.bytes).toString("base64"),
      },
    });

    const content = yield* Effect.try({
      try: () => {
        assertUniqueJsonKeys(response.bytes);

        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(response.bytes);
      },
      catch: () => failure("InvalidJournal"),
    });

    const page = yield* Schema.decodeEffect(Schema.fromJsonString(Contracts.ProviderPage))(
      content,
      { onExcessProperty: "error" },
    ).pipe(Effect.mapError(() => failure("InvalidJournal")));

    yield* checkPage(account, selection, cursor, page);

    return yield* withBook(token, scope, false, function* (tx) {
      yield* Posting.lockBookForUpdate(tx, scope);
      const race = (yield* Db.readFetchPage(tx, scope.bookId, fetchId, cursorKey))[0];

      if (race) {
        if ((yield* digest(race.body)) !== (yield* digest(page)))
          return yield* failure("IdempotencyConflict");

        return {
          page: yield* decode(Contracts.ProviderPage, race.body),
          rawSourceRef: race.rawSourceRef,
        };
      }

      yield* Db.insertFetchPage(tx, {
        bookId: scope.bookId,
        fetchId,
        cursorKey,
        rawSourceRef: retained.id,
        body: yield* toJsonObject(page),
      });

      return { page, rawSourceRef: retained.id };
    });
  });
}

export const fetchProcessorObservations = Effect.fn("processor.fetch")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly accountId: string;
    readonly input: Selection;
  },
) {
  const { bindings } = yield* RequestEnvironment;
  const feed = bindings.PROCESSOR_FEED ?? configuredProcessorFeed(bindings);

  if (!feed) return yield* failure("UnsupportedProfile");

  if (command.input.startsOn > command.input.endsOn) return yield* failure("InvalidJournal");

  const initial = yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireTableAccess(tx, Db.tables, true);

    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "processor_fetch",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Fetch,
    );

    const account = yield* readProcessorAccount(tx, command.scope, command.accountId);

    if (request.previous)
      return { account, fetchId: request.previous.id, previous: request.previous };
    yield* Posting.lockBookForUpdate(tx, command.scope);

    const requestDigest = yield* digest({
      command,
      actorId: principal.actorId,
      accountDigest: account.digest,
    });

    const prior = (yield* Db.readFetchRequest(tx, command.scope.bookId, command.idempotencyKey))[0];

    if (prior && prior.requestDigest !== requestDigest)
      return yield* failure("IdempotencyConflict");
    const fetchId = prior?.id ?? newId("processor_fetch");

    if (!prior)
      yield* Db.insertFetchRequest(tx, {
        bookId: command.scope.bookId,
        key: command.idempotencyKey,
        id: fetchId,
        accountId: account.id,
        requestDigest,
        body: yield* toJsonObject({
          command,
          actorId: principal.actorId,
          accountDigest: account.digest,
        }),
      });

    return { account, fetchId, previous: null };
  });

  if (initial.previous) return initial.previous;
  const pages: RetainedPage[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;

  for (let count = 0; count < 100; count += 1) {
    const page: RetainedPage = yield* obtainPage(
      token,
      command.scope,
      initial.account,
      command.input,
      initial.fetchId,
      cursor,
      feed,
    );

    yield* checkPage(initial.account, command.input, cursor, page.page);
    pages.push(page);
    const next: string | null = page.page.nextCursor;

    if (next === null) break;

    if (cursors.has(next)) return yield* failure("InvalidJournal");
    cursors.add(next);
    cursor = next;

    if (count === 99) return yield* failure("UnsupportedProfile");
  }

  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "processor_fetch",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Fetch,
    );

    if (request.previous) return request.previous;
    yield* Posting.lockBookForUpdate(tx, command.scope);
    const account = yield* readProcessorAccount(tx, command.scope, initial.account.id);

    if (account.digest !== initial.account.digest) return yield* failure("StaleDependency");
    const first = pages[0]?.page;

    if (!first) return yield* failure("InvalidJournal");
    const firstRetained = pages[0];

    if (!firstRetained) return yield* failure("InvalidJournal");
    yield* registerProcessorCashHolding(tx, command.scope, account, firstRetained.rawSourceRef);

    const control = {
      reportId: first.reportId,
      openingMinor: first.openingMinor,
      closingMinor: first.closingMinor,
      complete: first.complete,
    };

    const controlDigest = yield* digest(control);
    const observations: Array<typeof Contracts.Observation.Type> = [];
    const sourceLinks: Array<{ observationId: string; rawSourceRef: string }> = [];
    const seen = new Set<string>();

    for (const retained of pages) {
      const page = retained.page;

      if (
        (yield* digest({
          reportId: page.reportId,
          openingMinor: page.openingMinor,
          closingMinor: page.closingMinor,
          complete: page.complete,
        })) !== controlDigest
      )
        return yield* failure("StaleDependency");

      for (const observation of yield* normalize(tx, command.scope, account, retained)) {
        if (seen.has(observation.id)) continue;
        seen.add(observation.id);
        observations.push(observation);
        sourceLinks.push({ observationId: observation.id, rawSourceRef: retained.rawSourceRef });
      }
    }

    const body = {
      id: initial.fetchId,
      accountId: account.id,
      selection: command.input,
      profileDigest: account.digest,
      rawSourceRefs: pages.map((page) => page.rawSourceRef),
      reportId: control.reportId,
      openingMinor: control.openingMinor,
      closingMinor: control.closingMinor,
      providerComplete: control.complete && command.input.view === "balance",
      observations,
    };

    const fetched = yield* decode(Contracts.Fetch, { ...body, digest: yield* digest(body) });
    yield* Db.insertFetch(tx, {
      bookId: command.scope.bookId,
      id: fetched.id,
      accountId: account.id,
      body: yield* toJsonObject(fetched),
    });

    for (const link of sourceLinks)
      yield* Db.insertSourceOccurrence(tx, {
        bookId: command.scope.bookId,
        fetchId: fetched.id,
        ...link,
        payoutMembershipId:
          command.input.view === "automatic_payout" ? command.input.providerPayoutId : null,
        body: yield* toJsonObject(link),
      });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "processor_fetch",
      principal.actorId,
      yield* toJsonObject(fetched),
    );

    return fetched;
  });
});
