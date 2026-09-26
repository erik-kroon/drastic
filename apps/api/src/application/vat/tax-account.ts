import { admitAccountRole } from "../resource-admission";
import { canonicalText as canonicalNative } from "../json";
import * as Tax from "@open-erp/contracts/tax-account";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Db from "../../db/posting";
import { databaseFailure, type Transaction } from "../../db/transaction";
import * as ReclassDb from "../../db/vat/reclassification";
import * as TaxDb from "../../db/vat/tax-account";
import {
  decode,
  toJsonObject,
  unsupported,
  type JsonObject,
  type Principal,
  type Scope,
} from "../commerce/support";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode } from "../identity";
import { isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import { digestBody, digestValue } from "./basis";

type StatementInput = typeof Tax.RecordTaxAccountStatement.Type;

type Statement = typeof Tax.TaxAccountStatement.Type;

type ClassificationInput = typeof Tax.ResolveTaxAccountEventClassification.Type;

type Selection = typeof Tax.SelectTaxAccountMatch.Type;

type MatchInput = typeof Tax.MatchTaxAccountEvent.Type;

type ControlInput = typeof Tax.CreateTaxAccountControl.Type;

const StatementSchema = Tax.TaxAccountStatement;

const StatementListSchema = Tax.TaxAccountStatementList;

const ResolutionSchema = Tax.TaxAccountEventResolution;

const ClassificationViewSchema = Tax.TaxAccountEventClassificationView;

const WorklistPageSchema = Tax.TaxAccountUnclassifiedEventPage;

const MatchBasisSchema = Tax.TaxAccountMatchBasis;

const MatchSchema = Tax.TaxAccountMatch;

const UnmatchSchema = Tax.TaxAccountUnmatch;

const MatchViewSchema = Tax.TaxAccountMatchView;

const MatchDetailSchema = Tax.TaxAccountMatchDetail;

const MatchListSchema = Tax.TaxAccountMatchList;

const ControlSchema = Tax.TaxAccountControl;

const ControlViewSchema = Tax.TaxAccountControlView;

const ControlListSchema = Tax.TaxAccountControlList;

const statementBound = 200;

const eventBound = 10000;

const sourceBound = 20;

const controlBound = 200;

const ledgerLineBound = 5000;

const matchBound = 1000;

const resolutionBound = 1000;

const worklistPageBound = 50;

const maximumIntervalDays = 365;

const controlByteBound = 8388608;

const cursorPrefix = "taue1";

const writableTables = new Set([
  "tax_account_sources",
  "tax_account_statements",
  "tax_account_events",
  "tax_account_classification_resolutions",
  "tax_account_matches",
  "tax_account_controls",
  "command_receipts",
]);

function isJsonRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTaxBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function sameJson(left: Schema.Json, right: Schema.Json) {
  const first = canonicalizeJson(left);
  const second = canonicalizeJson(right);

  if (Result.isFailure(first) || Result.isFailure(second)) return false;

  return first.success.json === second.success.json;
}

function requireTaxAccountAccess(transaction: Transaction, write: boolean) {
  return TaxDb.readTaxAccountAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== TaxDb.taxAccountTables.length) return unsupported();

      const denied = rows.some((row) => {
        if (!row.canSelect) return true;

        return write && writableTables.has(row.tableName) && !row.canInsert;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function readBook(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];

    if (book === undefined) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }

    return book;
  });
}

function minor(value: string) {
  return BigInt(value);
}

function isCalendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`) + days * 86400000;

  return new Date(parsed).toISOString().slice(0, 10);
}

function requireOrderedInterval(startsOn: string, endsOn: string) {
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn)) return failure("InvalidJournal");

  if (startsOn > endsOn) return failure("InvalidJournal");

  if (
    Date.parse(`${endsOn}T00:00:00.000Z`) - Date.parse(`${startsOn}T00:00:00.000Z`) >
    maximumIntervalDays * 86400000
  ) {
    return failure("InvalidJournal");
  }

  return Effect.void;
}

function readOpenPeriod(transaction: Transaction, bookId: string, date: string) {
  return Effect.gen(function* () {
    const rows = yield* TaxDb.readPeriodsForDate(transaction, bookId, date);

    if (rows.length !== 1) return yield* unsupported();
    const period = rows[0];

    if (period === undefined) return yield* unsupported();

    if (period.locked) return yield* failure("PeriodLocked");

    return { id: period.id, version: period.version };
  });
}

type RetainedEvent = {
  readonly id: string;
  readonly ordinal: number;
  readonly input: typeof Tax.TaxAccountEventInput.Type;
};

type EventClassification = {
  readonly statementId: string;
  readonly statementDigest: string;
  readonly event: RetainedEvent;
  readonly resolution: typeof Tax.TaxAccountEventResolution.Type | null;
  readonly effectiveClassification: typeof Tax.TaxAccountEventInput.fields.classification.Type;
};

function readEventClassification(transaction: Transaction, bookId: string, eventId: string) {
  return Effect.gen(function* () {
    const event = (yield* TaxDb.readEvent(transaction, bookId, eventId))[0];

    if (event === undefined) return yield* failure("NotFound");
    const statement = (yield* TaxDb.readStatement(transaction, bookId, event.statementId))[0];

    if (statement === undefined) return yield* failure("NotFound");
    const view = yield* decode(StatementSchema, statement.body);
    const row = view.events[event.ordinal - 1];

    if (row === undefined) return yield* failure("InternalError");
    const retained = (yield* TaxDb.readResolutionByEvent(transaction, bookId, eventId))[0];

    const resolution =
      retained === undefined ? null : yield* decode(ResolutionSchema, retained.body);

    return {
      statementId: statement.id,
      statementDigest: view.digest,
      event: row,
      resolution,
      effectiveClassification: resolution?.input.classification ?? row.input.classification,
    } satisfies EventClassification;
  });
}

function classificationBody(classification: EventClassification): JsonObject {
  return {
    statementId: classification.statementId,
    statementDigest: classification.statementDigest,
    event: classification.event,
    resolution: classification.resolution,
    effectiveClassification: classification.effectiveClassification,
  };
}

export const listUnclassifiedEvents = Effect.fn("taxAccount.listUnclassifiedEvents")(function* (
  token: string,
  command: { scope: Scope; accountId: string; after?: string },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);

      if (
        (yield* TaxDb.readSource(transaction, command.scope.bookId, command.accountId))[0] ===
        undefined
      ) {
        return yield* failure("NotFound");
      }

      const context = (yield* digestValue({
        entityId: command.scope.entityId,
        bookId: command.scope.bookId,
        accountId: command.accountId,
      })).slice(8);

      let after = "";

      if (command.after !== undefined) {
        const parts = command.after.split(":");

        if (parts.length !== 3 || parts[0] !== cursorPrefix || parts[1] !== context) {
          return yield* failure("InvalidJournal");
        }

        after = parts[2] ?? "";
        const anchor = (yield* TaxDb.readEvent(transaction, command.scope.bookId, after))[0];

        if (anchor === undefined || anchor.accountId !== command.accountId) {
          return yield* failure("InvalidJournal");
        }
      }

      const scanned = yield* TaxDb.readWorklistScan(
        transaction,
        command.scope.bookId,
        command.accountId,
        after,
      );

      const examined = scanned.slice(0, worklistPageBound);
      const views: Array<JsonObject> = [];

      for (const row of examined) {
        const classification = yield* readEventClassification(
          transaction,
          command.scope.bookId,
          row.id,
        );

        if (classification.effectiveClassification === "unknown") {
          views.push(classificationBody(classification));
        }
      }

      const last = examined.at(-1)?.id;

      return yield* decode(WorklistPageSchema, {
        scope: command.scope,
        accountId: command.accountId,
        items: views,
        scanned: examined.length,
        next:
          scanned.length > worklistPageBound && last !== undefined
            ? `${cursorPrefix}:${context}:${last}`
            : null,
        consistency: "live_unclassified_events",
      });
    }),
  );
});

export const resolveEventClassification = Effect.fn("taxAccount.resolveEventClassification")(
  function* (
    token: string,
    command: {
      scope: Scope;
      id: string;
      idempotencyKey: string;
      input: ClassificationInput;
    },
  ) {
    return yield* withTaxBook(
      token,
      command.scope,
      true,
      (transaction, principal) =>
        Effect.gen(function* () {
          const payload = yield* toJsonObject({ eventId: command.id, input: command.input });

          const request = yield* replay(
            transaction,
            command.scope,
            command.idempotencyKey,
            "resolve_tax_account_event_classification",
            principal.actorId,
            payload,
            ResolutionSchema,
          );

          if (request.previous) return request.previous;
          yield* requireTaxAccountAccess(transaction, true);
          yield* Db.lockBookForUpdate(transaction, command.scope);
          yield* readBook(transaction, command.scope);

          const classification = yield* readEventClassification(
            transaction,
            command.scope.bookId,
            command.id,
          );

          if (classification.statementDigest !== command.input.expectedStatementDigest) {
            return yield* failure("StaleDependency");
          }

          if (classification.event.input.classification !== "unknown") {
            return yield* failure("InvalidJournal");
          }

          if (classification.resolution !== null) {
            return yield* failure("IdempotencyConflict");
          }

          const evidence = yield* Db.readEvidence(
            transaction,
            command.scope.bookId,
            command.input.evidenceId,
          );

          const sha256 = evidence[0]?.sha256;

          if (sha256 === undefined) return yield* failure("MissingEvidence");
          const count = yield* TaxDb.readResolutionCount(transaction, command.scope.bookId);

          if ((count[0]?.total ?? 0) >= resolutionBound) return yield* unsupported();

          const body = yield* digestBody({
            id: newId("taxclassification"),
            scope: command.scope,
            eventId: command.id,
            statementId: classification.statementId,
            statementDigest: classification.statementDigest,
            input: command.input,
            evidenceSha256: sha256,
            createdAt: yield* isoNow(transaction),
            receipt: {
              key: command.idempotencyKey,
              operation: "resolve_tax_account_event_classification",
              actorId: principal.actorId,
            },
          });

          const resolution = yield* decode(ResolutionSchema, body);
          yield* TaxDb.insertResolution(transaction, {
            bookId: command.scope.bookId,
            id: resolution.id,
            eventId: command.id,
            evidenceId: command.input.evidenceId,
            body,
          });
          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            "resolve_tax_account_event_classification",
            principal.actorId,
            resolution,
          );

          return resolution;
        }),
      "update",
    );
  },
);

export const getEventClassification = Effect.fn("taxAccount.getEventClassification")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);

      const classification = yield* readEventClassification(
        transaction,
        command.scope.bookId,
        command.id,
      );

      return yield* decode(ClassificationViewSchema, classificationBody(classification));
    }),
  );
});

function readMatchBasis(transaction: Transaction, scope: Scope, selection: Selection) {
  return Effect.gen(function* () {
    const book = yield* readBook(transaction, scope);
    const event = (yield* TaxDb.readEvent(transaction, scope.bookId, selection.eventId))[0];

    if (event === undefined) return yield* failure("NotFound");
    const statement = (yield* TaxDb.readStatement(transaction, scope.bookId, event.statementId))[0];

    if (statement === undefined) return yield* failure("NotFound");
    const source = yield* decode(StatementSchema, statement.body);

    if (source.digest !== selection.statementDigest) return yield* failure("StaleDependency");
    const row = source.events[event.ordinal - 1];

    if (row === undefined) return yield* failure("InternalError");
    const classification = yield* readEventClassification(transaction, scope.bookId, event.id);

    const line = (yield* TaxDb.readLine(
      transaction,
      scope.bookId,
      selection.voucherId,
      selection.lineId,
    ))[0];

    if (line === undefined) return yield* failure("NotFound");

    if (
      line.accountId !== event.accountId ||
      row.input.occurredOn !== line.postingDate ||
      minor(row.input.amountMinor) !== minor(line.debitMinor) - minor(line.creditMinor) ||
      source.input.currency !== book.currency ||
      source.input.currencyScale !== book.currencyScale ||
      classification.effectiveClassification === "unknown"
    ) {
      return yield* failure("InvalidJournal");
    }

    if (
      minor(line.sequence) > book.committedSequence ||
      line.postingPurpose === "reversal" ||
      (yield* TaxDb.readCorrections(transaction, scope.bookId, selection.voucherId)).length > 0
    ) {
      return yield* failure("StaleDependency");
    }

    const reservation = (yield* TaxDb.readReservation(
      transaction,
      scope.bookId,
      event.id,
      selection.voucherId,
      selection.lineId,
    ))[0];

    if (reservation?.reserved === true) return yield* failure("StaleDependency");

    if (
      (yield* ReclassDb.readClaimedLineRows(transaction, scope.bookId, [
        { voucherId: selection.voucherId, lineId: selection.lineId },
      ])).some((claim) => claim.claimed)
    ) {
      return yield* failure("StaleDependency");
    }

    const period = yield* readOpenPeriod(transaction, scope.bookId, line.postingDate);
    const account = (yield* Db.readAccounts(transaction, scope.bookId, [event.accountId]))[0];

    if (account === undefined) return yield* failure("StaleDependency");

    if (!account.active) return yield* failure("StaleDependency");

    const entries: Array<readonly [string, Schema.Json]> = [
      ["scope", scope],
      ["selection", selection],
    ];

    if (classification.resolution !== null) {
      entries.push([
        "classificationResolution",
        {
          id: classification.resolution.id,
          digest: classification.resolution.digest,
          eventId: event.id,
          classification: classification.resolution.input.classification,
        },
      ]);
    }

    const body = Object.fromEntries([
      ...entries,
      ["statementId", statement.id],
      ["accountId", account.id],
      ["accountVersion", account.version.toString()],
      ["currency", book.currency],
      ["currencyScale", book.currencyScale],
      ["profileVersion", book.profileVersion.toString()],
      ["writerEpoch", book.writerEpoch.toString()],
      ["period", { id: period.id, version: period.version.toString() }],
      ["event", row],
      ["sourceEvidenceId", statement.evidenceId],
      ["sourceEvidenceSha256", statement.evidenceSha256],
      [
        "line",
        {
          voucherId: line.voucherId,
          lineId: line.lineId,
          ordinal: line.ordinal,
          sequence: line.sequence,
          postingDate: line.postingDate,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          description: line.description,
          postingPurpose: line.postingPurpose,
          correctsVoucherId: line.correctsVoucherId,
          evidenceRefs: line.evidenceRefs,
        },
      ],
    ]);

    return yield* decode(MatchBasisSchema, yield* digestBody(body));
  });
}

export const previewMatch = Effect.fn("taxAccount.previewMatch")(function* (
  token: string,
  command: { scope: Scope; input: Selection },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);

      return yield* readMatchBasis(transaction, command.scope, command.input);
    }),
  );
});

export const matchEvent = Effect.fn("taxAccount.matchEvent")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: MatchInput },
) {
  return yield* withTaxBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "match_tax_account_event",
          principal.actorId,
          payload,
          MatchSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTaxAccountAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);

        const evidence = yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.evidenceId,
        );

        const sha256 = evidence[0]?.sha256;

        if (sha256 === undefined) return yield* failure("MissingEvidence");

        const count = yield* TaxDb.readCount(
          transaction,
          "tax_account_matches",
          command.scope.bookId,
        );

        if ((count[0]?.total ?? 0) >= matchBound) return yield* unsupported();
        const basis = yield* readMatchBasis(transaction, command.scope, command.input.selection);

        if (basis.digest !== command.input.expectedBasisDigest) {
          return yield* failure("StaleDependency");
        }

        const body = yield* digestBody({
          id: newId("taxmatch"),
          scope: command.scope,
          input: command.input,
          basis,
          evidenceSha256: sha256,
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "match_tax_account_event",
            actorId: principal.actorId,
          },
        });

        const match = yield* decode(MatchSchema, body);
        yield* TaxDb.insertMatch(transaction, {
          bookId: command.scope.bookId,
          id: match.id,
          eventId: basis.event.id,
          voucherId: basis.line.voucherId,
          lineId: basis.line.lineId,
          evidenceId: command.input.evidenceId,
          body,
        });
        yield* TaxDb.insertMatchCapacity(transaction, {
          bookId: command.scope.bookId,
          matchId: match.id,
          eventId: basis.event.id,
          voucherId: basis.line.voucherId,
          lineId: basis.line.lineId,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "match_tax_account_event",
          principal.actorId,
          match,
        );

        return match;
      }),
    "update",
  );
});

export const unmatchEvent = Effect.fn("taxAccount.unmatchEvent")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    id: string;
    input: typeof Tax.UnmatchTaxAccountEvent.Type;
  },
) {
  return yield* withTaxBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "unmatch_tax_account_event",
          principal.actorId,
          payload,
          UnmatchSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTaxAccountAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* readBook(transaction, command.scope);
        const row = (yield* TaxDb.readMatch(transaction, command.scope.bookId, command.id))[0];

        if (row === undefined) return yield* failure("NotFound");
        const match = yield* decode(MatchSchema, row.body);

        if (match.digest !== command.input.expectedDigest) {
          return yield* failure("StaleDependency");
        }

        if (
          (yield* TaxDb.readMatchCapacity(transaction, command.scope.bookId, match.id))[0]
            ?.reserved !== true
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const evidence = yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.evidenceId,
        );

        const sha256 = evidence[0]?.sha256;

        if (sha256 === undefined) return yield* failure("MissingEvidence");
        yield* readOpenPeriod(
          transaction,
          command.scope.bookId,
          match.basis.event.input.occurredOn,
        );

        const body = yield* digestBody({
          id: newId("taxunmatch"),
          scope: command.scope,
          matchId: match.id,
          input: command.input,
          evidenceSha256: sha256,
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "unmatch_tax_account_event",
            actorId: principal.actorId,
          },
        });

        const unmatch = yield* decode(UnmatchSchema, body);
        yield* TaxDb.insertUnmatch(transaction, {
          bookId: command.scope.bookId,
          id: unmatch.id,
          matchId: match.id,
          evidenceId: command.input.evidenceId,
          body,
        });
        yield* TaxDb.releaseMatchCapacity(transaction, command.scope.bookId, match.id);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "unmatch_tax_account_event",
          principal.actorId,
          unmatch,
        );

        return unmatch;
      }),
    "update",
  );
});

function readMatchView(
  transaction: Transaction,
  bookId: string,
  match: typeof Tax.TaxAccountMatch.Type,
) {
  return Effect.gen(function* () {
    const unmatch = (yield* TaxDb.readUnmatchByMatch(transaction, bookId, match.id))[0];

    const active =
      (yield* TaxDb.readMatchCapacity(transaction, bookId, match.id))[0]?.reserved === true;

    const book = (yield* TaxDb.readBookState(transaction, bookId))[0];
    const account = (yield* Db.readAccounts(transaction, bookId, [match.basis.accountId]))[0];

    const voucher = (yield* TaxDb.readVoucherSequence(
      transaction,
      bookId,
      match.basis.line.voucherId,
    ))[0];

    if (book === undefined || account === undefined || voucher === undefined) {
      return yield* failure("InternalError");
    }

    const claimed = (yield* ReclassDb.readClaimedLineRows(transaction, bookId, [
      { voucherId: match.basis.line.voucherId, lineId: match.basis.line.lineId },
    ])).some((claim) => claim.claimed);

    const usable =
      active &&
      account.active &&
      account.version.toString() === match.basis.accountVersion &&
      book.profile === "synthetic-core-v1" &&
      book.authority === "native" &&
      book.profileVersion === match.basis.profileVersion &&
      book.writerEpoch === match.basis.writerEpoch &&
      book.currency === match.basis.currency &&
      book.currencyScale === match.basis.currencyScale &&
      minor(voucher.sequence) <= minor(book.committedSequence) &&
      voucher.postingPurpose !== "reversal" &&
      (yield* TaxDb.readCorrections(transaction, bookId, match.basis.line.voucherId)).length ===
        0 &&
      !claimed;

    return {
      match,
      unmatch: unmatch === undefined ? null : yield* decode(UnmatchSchema, unmatch.body),
      active,
      usable,
    };
  });
}

export const getMatch = Effect.fn("taxAccount.getMatch")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* TaxDb.readMatch(transaction, command.scope.bookId, command.id))[0];

      if (row === undefined) return yield* failure("NotFound");
      const match = yield* decode(MatchSchema, row.body);
      const view = yield* readMatchView(transaction, command.scope.bookId, match);

      const reference = (yield* TaxDb.readSubledgerBasisReference(
        transaction,
        command.scope.bookId,
        row.voucherId,
        row.lineId,
      ))[0];

      return yield* decode(MatchDetailSchema, {
        match: view.match,
        unmatch: view.unmatch,
        active: view.active,
        usable: view.usable,
        subledgerBasisReference:
          reference === undefined
            ? null
            : {
                scheduleId: reference.scheduleId,
                basisDigest: reference.basisDigest,
                voucherId: reference.voucherId,
                lineId: reference.lineId,
              },
        roleCompatibilityAssessed: false,
      });
    }),
  );
});

export const listMatches = Effect.fn("taxAccount.listMatches")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);

      const count = yield* TaxDb.readCount(
        transaction,
        "tax_account_matches",
        command.scope.bookId,
      );

      if ((count[0]?.total ?? 0) > matchBound) return yield* unsupported();
      const rows = yield* TaxDb.readMatchesForBook(transaction, command.scope.bookId);
      const items: Array<JsonObject> = [];

      for (const row of rows) {
        const match = yield* decode(MatchSchema, row.body);
        const view = yield* readMatchView(transaction, command.scope.bookId, match);
        items.push(yield* toJsonObject(yield* decode(MatchViewSchema, view)));
      }

      return yield* decode(MatchListSchema, { items });
    }),
  );
});

export const recordStatement = Effect.fn("taxAccount.recordStatement")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: StatementInput },
) {
  return yield* withTaxBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "record_tax_account_statement",
          principal.actorId,
          payload,
          StatementSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTaxAccountAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const book = yield* readBook(transaction, command.scope);

        if (
          command.input.currency !== book.currency ||
          command.input.currencyScale !== book.currencyScale
        ) {
          return yield* unsupported();
        }

        yield* requireOrderedInterval(command.input.startsOn, command.input.endsOn);

        const account = (yield* Db.readAccounts(transaction, command.scope.bookId, [
          command.input.accountId,
        ]))[0];

        if (account === undefined || !account.active) return yield* failure("NotFound");

        const sourceEvidence = (yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.evidenceId,
        ))[0];

        const reviewEvidence = (yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.reviewEvidenceId,
        ))[0];

        const sha256 = sourceEvidence?.sha256;
        const reviewSha256 = reviewEvidence?.sha256;

        if (sha256 === undefined || reviewSha256 === undefined) {
          return yield* failure("MissingEvidence");
        }

        const existing = (yield* TaxDb.readStatementByKey(
          transaction,
          command.scope.bookId,
          command.input.accountId,
          command.input.statementKey,
        ))[0];

        if (existing !== undefined) {
          const retained = yield* decode(StatementSchema, existing.body);

          if (!sameJson(retained.input, command.input)) {
            return yield* failure("IdempotencyConflict");
          }

          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            "record_tax_account_statement",
            principal.actorId,
            retained,
          );

          return retained;
        }

        if (
          (yield* TaxDb.readStatementBySource(
            transaction,
            command.scope.bookId,
            command.input.accountId,
            sha256,
            command.input.sourceLocator,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const statements = yield* TaxDb.readCount(
          transaction,
          "tax_account_statements",
          command.scope.bookId,
        );

        const events = yield* TaxDb.readEventCount(transaction, command.scope.bookId);

        if (
          (statements[0]?.total ?? 0) >= statementBound ||
          (events[0]?.total ?? 0) + command.input.rows.length > eventBound
        ) {
          return yield* unsupported();
        }

        const admitted = yield* admitStatementRows(transaction, command.scope, command.input);
        const movement = admitted.movement;
        const rows = admitted.rows;

        if (minor(command.input.openingMinor) + movement !== minor(command.input.closingMinor)) {
          return yield* failure("InvalidJournal");
        }

        yield* admitTaxAccountSource(transaction, command.scope, command.input);

        const body = yield* digestBody({
          id: newId("taxstatement"),
          scope: command.scope,
          input: command.input,
          evidenceSha256: sha256,
          reviewEvidenceSha256: reviewSha256,
          movementMinor: movement.toString(),
          events: rows,
          coverage: "not_established",
          taxReturnEffect: "none",
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "record_tax_account_statement",
            actorId: principal.actorId,
          },
        });

        const statement = yield* decode(StatementSchema, body);
        yield* TaxDb.insertStatement(transaction, {
          bookId: command.scope.bookId,
          id: statement.id,
          accountId: command.input.accountId,
          statementKey: command.input.statementKey,
          evidenceId: command.input.evidenceId,
          reviewEvidenceId: command.input.reviewEvidenceId,
          evidenceSha256: sha256,
          sourceLocator: command.input.sourceLocator,
          startsOn: command.input.startsOn,
          endsOn: command.input.endsOn,
          body,
        });
        yield* TaxDb.insertEvents(
          transaction,
          rows.map((row) => ({
            bookId: command.scope.bookId,
            id: row.id,
            accountId: command.input.accountId,
            eventKey: row.input.eventKey,
            statementId: statement.id,
            ordinal: row.ordinal,
          })),
        );
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "record_tax_account_statement",
          principal.actorId,
          statement,
        );

        return statement;
      }),
    "update",
  );
});

type AdmittedRows = {
  readonly movement: bigint;
  readonly rows: ReadonlyArray<{
    readonly id: string;
    readonly ordinal: number;
    readonly input: typeof Tax.TaxAccountEventInput.Type;
  }>;
};

function admitStatementRows(transaction: Transaction, scope: Scope, input: StatementInput) {
  return Effect.gen(function* () {
    const seen = new Set<string>();

    const rows: Array<{
      id: string;
      ordinal: number;
      input: typeof Tax.TaxAccountEventInput.Type;
    }> = [];

    let movement = 0n;

    for (const [index, row] of input.rows.entries()) {
      if (
        !isCalendarDate(row.occurredOn) ||
        row.occurredOn < input.startsOn ||
        row.occurredOn > input.endsOn
      ) {
        return yield* failure("InvalidJournal");
      }

      if (seen.has(row.eventKey)) return yield* failure("IdempotencyConflict");

      if (
        (yield* TaxDb.readEventByKey(transaction, scope.bookId, input.accountId, row.eventKey))
          .length > 0
      ) {
        return yield* failure("IdempotencyConflict");
      }

      seen.add(row.eventKey);
      movement += minor(row.amountMinor);
      rows.push({ id: newId("taxevent"), ordinal: index + 1, input: row });
    }

    return { movement, rows } satisfies AdmittedRows;
  });
}

function admitTaxAccountSource(transaction: Transaction, scope: Scope, input: StatementInput) {
  return Effect.gen(function* () {
    const source = (yield* TaxDb.readSource(transaction, scope.bookId, input.accountId))[0];

    if (source !== undefined && source.sourceKey !== input.sourceAccountKey) {
      return yield* failure("IdempotencyConflict");
    }

    const mapped = (yield* TaxDb.readSourceByKey(
      transaction,
      scope.bookId,
      input.sourceAccountKey,
    ))[0];

    if (mapped !== undefined && mapped.accountId !== input.accountId) {
      return yield* failure("IdempotencyConflict");
    }

    if (source !== undefined) return;
    const sources = yield* TaxDb.readSourceCount(transaction, scope.bookId);

    if ((sources[0]?.total ?? 0) >= sourceBound) return yield* unsupported();
    yield* admitAccountRole(transaction, scope.bookId, input.accountId, "tax");
    yield* TaxDb.insertSource(transaction, {
      bookId: scope.bookId,
      accountId: input.accountId,
      sourceKey: input.sourceAccountKey,
    });
  });
}

export const getStatement = Effect.fn("taxAccount.getStatement")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* TaxDb.readStatement(transaction, command.scope.bookId, command.id))[0];

      if (row === undefined) return yield* failure("NotFound");

      return yield* decode(StatementSchema, row.body);
    }),
  );
});

export const listStatements = Effect.fn("taxAccount.listStatements")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);

      const count = yield* TaxDb.readCount(
        transaction,
        "tax_account_statements",
        command.scope.bookId,
      );

      if ((count[0]?.total ?? 0) > statementBound) return yield* unsupported();
      const rows = yield* TaxDb.listStatementItems(transaction, command.scope.bookId);

      return yield* decode(StatementListSchema, { items: rows.map((row) => row.item) });
    }),
  );
});

function readDependencyDigest(
  transaction: Transaction,
  scope: Scope,
  book: {
    readonly committedSequence: bigint;
    readonly profile: string;
    readonly profileVersion: bigint;
    readonly authority: string;
    readonly writerEpoch: bigint;
    readonly currency: string;
    readonly currencyScale: number;
  },
  accountId: string,
  startsOn: string,
  endsOn: string,
  bounded: boolean,
) {
  return Effect.gen(function* () {
    const account = (yield* Db.readAccounts(transaction, scope.bookId, [accountId]))[0];

    if (account === undefined) return yield* failure("NotFound");
    const source = (yield* TaxDb.readSource(transaction, scope.bookId, accountId))[0] ?? null;

    const statements = yield* TaxDb.readDependencyStatements(
      transaction,
      scope.bookId,
      accountId,
      startsOn,
      endsOn,
    );

    const resolutions = yield* TaxDb.readDependencyResolutions(
      transaction,
      scope.bookId,
      accountId,
      startsOn,
      endsOn,
    );

    const matching = yield* readMatchingDependencies(transaction, scope.bookId);

    if (matching === null)
      return yield* bounded ? failure("UnsupportedProfile") : Effect.succeed(null);

    const basis: Array<readonly [string, Schema.Json]> = [
      [
        "book",
        {
          sequence: book.committedSequence.toString(),
          profile: book.profile,
          profileVersion: book.profileVersion.toString(),
          authority: book.authority,
          writerEpoch: book.writerEpoch.toString(),
          currency: book.currency,
          currencyScale: book.currencyScale,
        },
      ],
      [
        "account",
        {
          book_id: scope.bookId,
          id: account.id,
          code: account.code,
          name: account.name,
          active: account.active,
          version: account.version.toString(),
        },
      ],
      ["source", source === null ? null : { book_id: scope.bookId, ...source }],
      ["statements", statements.map((row) => row.item)],
      ["matching", matching],
    ];

    if (resolutions.length > 0) {
      basis.push(["classificationResolutionCount", resolutions.length]);
      basis.push([
        "classificationResolutionDigest",
        yield* digestValue(resolutions.map((row) => row.item)),
      ]);
    }

    return yield* digestValue(Object.fromEntries(basis));
  });
}

function readMatchingDependencies(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const matches = yield* TaxDb.readCount(transaction, "tax_account_matches", bookId);
    const unmatches = yield* TaxDb.readCount(transaction, "tax_account_unmatches", bookId);

    if ((matches[0]?.total ?? 0) > matchBound || (unmatches[0]?.total ?? 0) > matchBound) {
      return null;
    }

    const matchInventory = yield* TaxDb.readMatchInventory(transaction, bookId);
    const unmatchInventory = yield* TaxDb.readUnmatchInventory(transaction, bookId);
    const rows = yield* TaxDb.readMatchesForBook(transaction, bookId);
    const active: Array<JsonObject> = [];

    for (const row of rows) {
      const match = yield* decode(MatchSchema, row.body);
      const view = yield* readMatchView(transaction, bookId, match);
      active.push(
        yield* toJsonObject({
          id: match.id,
          active: view.active,
          usable: view.usable,
          corrections: (yield* TaxDb.readCorrections(transaction, bookId, row.voucherId)).map(
            (correction) => correction.id,
          ),
        }),
      );
    }

    return {
      matchCount: matches[0]?.total ?? 0,
      unmatchCount: unmatches[0]?.total ?? 0,
      matchInventoryDigest: yield* digestValue(matchInventory.map((row) => row.item)),
      unmatchInventoryDigest: yield* digestValue(unmatchInventory.map((row) => row.item)),
      activeStateDigest: yield* digestValue(active),
    };
  });
}

type SourceRollforward = {
  readonly diagnostics: Array<(typeof Tax.TaxAccountControl.fields.diagnostics.Type)[number]>;
  readonly statements: ReadonlyArray<Statement>;
  readonly gaps: ReadonlyArray<{ startsOn: string; endsOn: string }>;
  readonly overlaps: ReadonlyArray<{ leftStatementId: string; rightStatementId: string }>;
  readonly breaks: ReadonlyArray<{
    leftStatementId: string;
    rightStatementId: string;
    differenceMinor: string;
  }>;
  readonly classificationResolutions: ReadonlyArray<{
    id: string;
    digest: string;
    eventId: string;
    classification: ClassificationInput["classification"];
  }>;
  readonly eventIds: ReadonlyArray<string>;
  readonly unknownEventIds: ReadonlyArray<string>;
  readonly sourceOpeningMinor: bigint | null;
  readonly sourceMovementMinor: bigint | null;
  readonly sourceClosingMinor: bigint | null;
};

function admitControlInterval(
  transaction: Transaction,
  scope: Scope,
  input: ControlInput,
  book: { readonly committedSequence: bigint },
) {
  return Effect.gen(function* () {
    yield* requireOrderedInterval(input.startsOn, input.endsOn);
    const account = (yield* Db.readAccounts(transaction, scope.bookId, [input.accountId]))[0];

    if (account === undefined) return yield* failure("NotFound");

    if (
      (yield* TaxDb.readOverlappingStatements(
        transaction,
        scope.bookId,
        account.id,
        input.startsOn,
        input.endsOn,
      )).length > 0
    ) {
      return yield* failure("InvalidJournal");
    }

    const controls = yield* TaxDb.readControlCount(transaction, scope.bookId);

    if ((controls[0]?.total ?? 0) >= controlBound) return yield* unsupported();

    const bound = yield* TaxDb.readLedgerLineBound(
      transaction,
      scope.bookId,
      account.id,
      input.endsOn,
      book.committedSequence.toString(),
    );

    if ((bound[0]?.total ?? 0) > ledgerLineBound) return yield* unsupported();

    return account;
  });
}

function readSourceRollforward(
  transaction: Transaction,
  scope: Scope,
  input: ControlInput,
  accountId: string,
  accountActive: boolean,
) {
  return Effect.gen(function* () {
    const rows = yield* TaxDb.readStatementsForAccount(
      transaction,
      scope.bookId,
      accountId,
      input.startsOn,
      input.endsOn,
    );

    const statements: Array<Statement> = [];
    const gaps: Array<{ startsOn: string; endsOn: string }> = [];

    const breaks: Array<{
      leftStatementId: string;
      rightStatementId: string;
      differenceMinor: string;
    }> = [];

    const classificationResolutions: Array<{
      id: string;
      digest: string;
      eventId: string;
      classification: ClassificationInput["classification"];
    }> = [];

    const eventIds: Array<string> = [];
    const unknownEventIds: Array<string> = [];
    let cursor = input.startsOn;
    let lastEnd = "";
    let lastId = "";
    let lastClose = 0n;
    let opening: bigint | null = null;
    let movement = 0n;
    let closing: bigint | null = null;

    for (const row of rows) {
      const statement = yield* decode(StatementSchema, row.body);

      if (row.startsOn > cursor) {
        gaps.push({ startsOn: cursor, endsOn: shiftDate(row.startsOn, -1) });
      }

      cursor = row.endsOn > cursor ? shiftDate(row.endsOn, 1) : cursor;
      const statementOpening = minor(statement.input.openingMinor);
      const statementClosing = minor(statement.input.closingMinor);

      if (lastEnd === "") {
        opening = statementOpening;
      } else if (row.startsOn === shiftDate(lastEnd, 1) && statementOpening !== lastClose) {
        breaks.push({
          leftStatementId: lastId,
          rightStatementId: row.id,
          differenceMinor: (statementOpening - lastClose).toString(),
        });
      }

      lastEnd = row.endsOn;
      lastId = row.id;
      lastClose = statementClosing;
      closing = statementClosing;
      movement += minor(statement.movementMinor);
      statements.push(statement);

      for (const event of statement.events) {
        const classification = yield* readEventClassification(transaction, scope.bookId, event.id);
        eventIds.push(event.id);

        if (classification.effectiveClassification === "unknown") {
          unknownEventIds.push(event.id);
        }

        if (classification.resolution !== null) {
          classificationResolutions.push({
            id: classification.resolution.id,
            digest: classification.resolution.digest,
            eventId: event.id,
            classification: classification.resolution.input.classification,
          });
        }
      }
    }

    if (cursor <= input.endsOn) gaps.push({ startsOn: cursor, endsOn: input.endsOn });
    const overlaps = readStatementOverlaps(statements);
    const diagnostics: SourceRollforward["diagnostics"] = ["coverage_unestablished"];

    if (statements.length === 0) diagnostics.push("missing_source");

    if (gaps.length > 0) diagnostics.push("source_gaps");

    if (overlaps.length > 0) diagnostics.push("source_overlaps");

    if (breaks.length > 0) diagnostics.push("source_balance_chain");

    if (!accountActive) diagnostics.push("inactive_account");

    if (unknownEventIds.length > 0) diagnostics.push("unknown_classifications");
    const complete = gaps.length === 0 && overlaps.length === 0 && breaks.length === 0;

    return {
      diagnostics,
      statements,
      gaps,
      overlaps,
      breaks,
      classificationResolutions,
      eventIds,
      unknownEventIds,
      sourceOpeningMinor: complete ? opening : null,
      sourceMovementMinor: complete ? movement : null,
      sourceClosingMinor: complete ? closing : null,
    } satisfies SourceRollforward;
  });
}

function readStatementOverlaps(statements: ReadonlyArray<Statement>) {
  const overlaps: Array<{ leftStatementId: string; rightStatementId: string }> = [];

  const ordered = [...statements].sort((left, right) =>
    left.id === right.id ? 0 : left.id < right.id ? -1 : 1,
  );

  for (const left of ordered) {
    for (const right of ordered) {
      if (
        left.id < right.id &&
        left.input.startsOn <= right.input.endsOn &&
        right.input.startsOn <= left.input.endsOn
      ) {
        overlaps.push({ leftStatementId: left.id, rightStatementId: right.id });
      }
    }
  }

  return overlaps;
}

function readAccountMatches(
  transaction: Transaction,
  scope: Scope,
  accountId: string,
  endsOn: string,
) {
  return Effect.gen(function* () {
    const rows = yield* TaxDb.readMatchesForBook(transaction, scope.bookId);
    const matches: Array<JsonObject> = [];

    for (const row of rows) {
      const match = yield* decode(MatchSchema, row.body);

      if (match.basis.accountId !== accountId) continue;

      if (match.basis.event.input.occurredOn > endsOn) continue;
      const view = yield* readMatchView(transaction, scope.bookId, match);
      matches.push(yield* toJsonObject(yield* decode(MatchViewSchema, view)));
    }

    return matches;
  });
}

function readUnmatchedItems(
  usableMatches: ReadonlyArray<JsonObject>,
  eventIds: ReadonlyArray<string>,
  ledgerLines: ReadonlyArray<{ readonly item: JsonObject }>,
) {
  const eventIdSet = new Set(usableMatches.map(matchedEventId));
  const lineKeySet = new Set(usableMatches.map(matchedLineKey));
  const lines: Array<{ voucherId: string; lineId: string }> = [];
  const lineIds: Array<string> = [];

  for (const row of ledgerLines) {
    const voucherId = row.item.voucherId;
    const lineId = row.item.lineId;

    if (typeof voucherId !== "string" || typeof lineId !== "string") continue;

    if (lineKeySet.has(`${voucherId}:${lineId}`)) continue;
    lines.push({ voucherId, lineId });
    lineIds.push(lineId);
  }

  return {
    eventIds: eventIds.filter((eventId) => !eventIdSet.has(eventId)),
    lines,
    lineIds,
  };
}

export const createControl = Effect.fn("taxAccount.createControl")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: ControlInput },
) {
  return yield* withTaxBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "create_tax_account_control",
          principal.actorId,
          payload,
          ControlSchema,
        );

        if (request.previous) return request.previous;
        yield* requireTaxAccountAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const book = yield* readBook(transaction, command.scope);

        const account = yield* admitControlInterval(
          transaction,
          command.scope,
          command.input,
          book,
        );

        const source = yield* readSourceRollforward(
          transaction,
          command.scope,
          command.input,
          account.id,
          account.active,
        );

        const diagnostics = source.diagnostics;
        const statements = source.statements;

        const totals = (yield* TaxDb.readLedgerTotals(
          transaction,
          command.scope.bookId,
          account.id,
          command.input.startsOn,
          command.input.endsOn,
          book.committedSequence.toString(),
        ))[0];

        if (totals === undefined) return yield* failure("InternalError");
        const ledgerOpening = minor(totals.opening);
        const ledgerMovement = minor(totals.movement);
        const ledgerClosing = minor(totals.closing);

        if (
          source.sourceOpeningMinor !== null &&
          source.sourceMovementMinor !== null &&
          source.sourceClosingMinor !== null &&
          (source.sourceOpeningMinor !== ledgerOpening ||
            source.sourceMovementMinor !== ledgerMovement ||
            source.sourceClosingMinor !== ledgerClosing)
        ) {
          diagnostics.push("source_ledger_difference");
        }

        const matches = yield* readAccountMatches(
          transaction,
          command.scope,
          account.id,
          command.input.endsOn,
        );

        const ledgerLines = yield* TaxDb.readLedgerLines(
          transaction,
          command.scope.bookId,
          account.id,
          command.input.startsOn,
          command.input.endsOn,
          book.committedSequence.toString(),
        );

        const usableMatches = matches.filter((item) => item.usable === true);
        const remaining = readUnmatchedItems(usableMatches, source.eventIds, ledgerLines);
        const remainingEvents = remaining.eventIds;
        const remainingLines = remaining.lines;
        const remainingLineIds = remaining.lineIds;

        if (remainingEvents.length > 0) diagnostics.push("unmatched_events");

        if (remainingLines.length > 0) diagnostics.push("unmatched_ledger_lines");

        if (matches.some((item) => item.active === true && item.usable !== true)) {
          diagnostics.push("invalid_matches");
        }

        const dependencyDigest = yield* readDependencyDigest(
          transaction,
          command.scope,
          book,
          account.id,
          command.input.startsOn,
          command.input.endsOn,
          true,
        );

        if (dependencyDigest === null) return yield* unsupported();

        const body = yield* digestBody({
          id: newId("taxcontrol"),
          scope: command.scope,
          input: command.input,
          kind: "synthetic_tax_account_gl_control_v3",
          dependencyDigest,
          classificationResolutions: source.classificationResolutions,
          sequence: book.committedSequence.toString(),
          currency: book.currency,
          currencyScale: book.currencyScale,
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            version: account.version.toString(),
            active: account.active,
          },
          statements,
          ledgerLines: ledgerLines.map((row) => row.item),
          sourceGaps: source.gaps,
          sourceOverlaps: source.overlaps,
          balanceBreaks: source.breaks,
          sourceOpeningMinor: source.sourceOpeningMinor?.toString() ?? null,
          sourceMovementMinor: source.sourceMovementMinor?.toString() ?? null,
          sourceClosingMinor: source.sourceClosingMinor?.toString() ?? null,
          ledgerOpeningMinor: ledgerOpening.toString(),
          ledgerMovementMinor: ledgerMovement.toString(),
          ledgerClosingMinor: ledgerClosing.toString(),
          openingDifferenceMinor:
            source.sourceOpeningMinor === null
              ? null
              : (source.sourceOpeningMinor - ledgerOpening).toString(),
          movementDifferenceMinor:
            source.sourceMovementMinor === null
              ? null
              : (source.sourceMovementMinor - ledgerMovement).toString(),
          closingDifferenceMinor:
            source.sourceClosingMinor === null
              ? null
              : (source.sourceClosingMinor - ledgerClosing).toString(),
          matches,
          unmatchedLedgerLines: remainingLines,
          unmatchedEventIds: remainingEvents,
          unmatchedLedgerLineIds: remainingLineIds,
          unknownClassificationEventIds: source.unknownEventIds,
          diagnostics,
          coverage: "not_established",
          reconciled: false,
          financialCloseReady: false,
          taxReturnEffect: "none",
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "create_tax_account_control",
            actorId: principal.actorId,
          },
        });

        const control = yield* decode(ControlSchema, body);
        const content = yield* canonicalNative(body);

        if (content === undefined) return yield* failure("InternalError");
        const byteLength = new TextEncoder().encode(content).byteLength;

        if (byteLength > controlByteBound) return yield* unsupported();
        yield* TaxDb.insertControl(transaction, {
          bookId: command.scope.bookId,
          id: control.id,
          body,
          content,
          sha256: yield* sha256Hex(content),
          byteLength,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "create_tax_account_control",
          principal.actorId,
          control,
        );

        return control;
      }),
    "update",
  );
});

function matchedEventId(item: JsonObject) {
  const match = item.match;

  if (!isJsonRecord(match)) return null;
  const basis = match.basis;

  if (!isJsonRecord(basis)) return null;
  const event = basis.event;

  if (!isJsonRecord(event)) return null;

  return typeof event.id === "string" ? event.id : null;
}

function matchedLineKey(item: JsonObject) {
  const match = item.match;

  if (!isJsonRecord(match)) return null;
  const basis = match.basis;

  if (!isJsonRecord(basis)) return null;
  const line = basis.line;

  if (!isJsonRecord(line)) return null;
  const voucherId = line.voucherId;
  const lineId = line.lineId;

  return typeof voucherId === "string" && typeof lineId === "string"
    ? `${voucherId}:${lineId}`
    : null;
}

export const getControl = Effect.fn("taxAccount.getControl")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* TaxDb.readControl(transaction, command.scope.bookId, command.id))[0];

      if (row === undefined) return yield* failure("NotFound");
      const snapshot = yield* decode(ControlSchema, row.body);
      const book = yield* readBook(transaction, command.scope);

      const dependencyDigest = yield* readDependencyDigest(
        transaction,
        command.scope,
        book,
        snapshot.input.accountId,
        snapshot.input.startsOn,
        snapshot.input.endsOn,
        false,
      );

      return yield* decode(ControlViewSchema, {
        snapshot,
        dependenciesCurrent: dependencyDigest === snapshot.dependencyDigest,
        artifact: {
          content: row.content,
          sha256: row.sha256,
          byteLength: row.byteLength,
          mediaType: "application/json",
        },
      });
    }),
  );
});

export const listControls = Effect.fn("taxAccount.listControls")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireTaxAccountAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const count = yield* TaxDb.readControlCount(transaction, command.scope.bookId);

      if ((count[0]?.total ?? 0) > controlBound) return yield* unsupported();
      const rows = yield* TaxDb.listControlItems(transaction, command.scope.bookId);

      return yield* decode(ControlListSchema, { items: rows.map((row) => row.item) });
    }),
  );
});
