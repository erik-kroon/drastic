import { citedSuggestions, recordDecision, type Comparison } from "../decision-provenance";
import { admitBankMatch } from "../resource-admission";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { replay, saveCommand } from "../posting";
import type { Transaction } from "../../db/transaction";
import * as BankDb from "../../db/banking/shared";
import * as StatementDb from "../../db/banking/statements";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const MatchReceiptSchema = Bank.BankMatchReceipt;

const matchTables = [
  "books",
  "accounts",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_allocation_legs",
  "journal_lines",
  "vouchers",
  "command_receipts",
];

const matchInserts = ["bank_matches", "command_receipts"];

const matchUpdates = ["bank_sources"];

export type MatchTarget = {
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly voucherId: string;
  readonly lineId: string;
};

// One exact signed amount, one whole retained row, one whole statement interval.
// Partial capacity belongs to a reviewed allocation plan, never to an exact match.
export function addMatch(
  transaction: Transaction,
  bookId: string,
  actorId: string,
  target: MatchTarget,
  origin: "imported" | "explicit",
  ownerId?: string,
) {
  return Effect.gen(function* () {
    if (
      !Number.isSafeInteger(target.rowOrdinal) ||
      target.rowOrdinal < 1 ||
      target.rowOrdinal > 10000
    ) {
      return yield* failure("InvalidJournal");
    }

    const observation = (yield* StatementDb.readObservation(
      transaction,
      bookId,
      target.statementId,
      target.rowOrdinal,
    ))[0];

    if (!observation) return yield* failure("NotFound");

    const line = (yield* StatementDb.readLine(
      transaction,
      bookId,
      target.voucherId,
      target.lineId,
    ))[0];

    if (!line) return yield* failure("NotFound");
    const observed = Shared.minor(observation.amountMinor);
    const posted = Shared.minor(line.amountMinor);

    if (observed === undefined || posted === undefined) return yield* Shared.unsupported();

    if (
      line.accountId !== observation.accountId ||
      posted !== observed ||
      line.postedOn < observation.startsOn ||
      line.postedOn > observation.endsOn
    ) {
      return yield* failure("InvalidJournal");
    }

    yield* admitBankMatch(transaction, bookId, target, ownerId);

    const retained = (yield* StatementDb.readObservationMatch(
      transaction,
      bookId,
      target.statementId,
      target.rowOrdinal,
    ))[0];

    if (retained) {
      if (retained.voucherId !== target.voucherId || retained.lineId !== target.lineId) {
        return yield* failure("InvalidJournal");
      }

      return yield* Shared.toJsonObject(retained);
    }

    if (
      (yield* StatementDb.readLineMatch(transaction, bookId, target.voucherId, target.lineId))
        .length > 0
    ) {
      return yield* failure("InvalidJournal");
    }

    if (
      (yield* StatementDb.readAllocatedLegPresence(
        transaction,
        bookId,
        target.statementId,
        target.rowOrdinal,
        target.voucherId,
        target.lineId,
      ))[0]?.present === true
    ) {
      return yield* failure("InvalidJournal");
    }

    yield* StatementDb.insertMatch(transaction, {
      bookId,
      statementId: target.statementId,
      rowOrdinal: target.rowOrdinal,
      voucherId: target.voucherId,
      lineId: target.lineId,
      origin,
      actorId,
    });
    yield* BankDb.bumpSourceRevision(transaction, bookId, observation.accountId);

    return yield* Shared.toJsonObject({
      statementId: target.statementId,
      rowOrdinal: target.rowOrdinal,
      voucherId: target.voucherId,
      lineId: target.lineId,
      origin,
      actorId,
    } satisfies JsonObject);
  });
}

export const matchBankObservation = Effect.fn("banking.match.observation")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Bank.BankMatchInput.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, matchTables, matchInserts, matchUpdates);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "match_bank_observation",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        MatchReceiptSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);

      const observation = (yield* StatementDb.readObservation(
        transaction,
        command.scope.bookId,
        command.input.statementId,
        command.input.rowOrdinal,
      ))[0];

      if (!observation) return yield* failure("NotFound");

      const checkpoint = yield* Shared.readCheckpoint(
        transaction,
        command.scope.bookId,
        observation.accountId,
      );

      const subject = {
        kind: "bank_row" as const,
        statementId: observation.statementId,
        rowOrdinal: observation.rowOrdinal,
        revision: checkpoint.sourceRevision,
      };

      const exposure = yield* citedSuggestions(
        transaction,
        command.scope.bookId,
        principal,
        [subject],
        command.input.presentedSuggestionIds ?? [],
      );

      const retainedMatch = (yield* StatementDb.readObservationMatch(
        transaction,
        command.scope.bookId,
        command.input.statementId,
        command.input.rowOrdinal,
      ))[0];

      const matched = yield* addMatch(
        transaction,
        command.scope.bookId,
        principal.actorId,
        {
          statementId: command.input.statementId,
          rowOrdinal: command.input.rowOrdinal,
          voucherId: command.input.voucherId,
          lineId: command.input.lineId,
        },
        "explicit",
      );

      const statement = (yield* StatementDb.readStatement(
        transaction,
        command.scope.bookId,
        command.input.statementId,
      ))[0];

      if (!statement) return yield* failure("NotFound");

      const body = yield* Shared.toJsonObject({
        match: matched,
        checkpoint: yield* Shared.readCheckpoint(
          transaction,
          command.scope.bookId,
          statement.accountId,
        ),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "match_bank_observation",
          principal.actorId,
        ),
      } satisfies JsonObject);

      const selected = yield* Shared.decode(Bank.BankMatch, matched);

      const comparisons: Comparison[] = exposure.records.map((record) => {
        const first =
          record.ranked.source === "bank_ranking_v2" ? record.ranked.options[0] : undefined;

        return {
          coverage: "complete",
          comparison:
            first === undefined
              ? "not_comparable"
              : first.voucherId === selected.voucherId && first.lineId === selected.lineId
                ? "unchanged"
                : "changed",
          dimensions: { voucherId: selected.voucherId, lineId: selected.lineId },
        };
      });

      if (!retainedMatch)
        yield* recordDecision(transaction, {
          bookId: command.scope.bookId,
          actorId: principal.actorId,
          kind: "bank_match",
          id: `${selected.statementId}:${selected.rowOrdinal}`,
          subject: yield* Shared.toJsonObject(subject),
          selected: yield* Shared.toJsonObject({
            ...selected,
            bookCommitSequence: checkpoint.sequence,
          }),
          exposure,
          comparisons,
        });

      const receipt = yield* Shared.decode(MatchReceiptSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "match_bank_observation",
        principal.actorId,
        body,
      );

      return receipt;
    }),
  );
});
