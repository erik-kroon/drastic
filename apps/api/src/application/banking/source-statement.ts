import type * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as BankDb from "../../db/banking/shared";
import * as SourceDb from "../../db/banking/source-statement";
import * as StatementDb from "../../db/banking/statements";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { digest, newId, replay, saveCommand } from "../posting";
import { addMatch } from "./matches";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;

const ReceiptSchema = Bank.StatementImportReceipt;
const ViewSchema = Bank.BankStatementView;

const statementTables = [
  "books",
  "accounts",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "journal_lines",
  "vouchers",
  "evidence",
  "command_receipts",
];
const statementInserts = [
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "command_receipts",
];
const statementUpdates = ["bank_sources"];

type Source = typeof Bank.StatementSource.Type;

// The retained statement is exactly the imported source. Admission identity and
// imported matches travel beside it, never inside it.
function statementSourceOf(input: typeof Bank.ImportBankStatement.Type): Source {
  return {
    kind: input.kind,
    statementIdentifier: input.statementIdentifier,
    sourceBankAccountId: input.sourceBankAccountId,
    accountId: input.accountId,
    currency: input.currency,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    openingMinor: input.openingMinor,
    closingMinor: input.closingMinor,
    completeness: input.completeness,
    rows: input.rows,
  };
}

function rowsAreAdmissible(source: Source) {
  const ordinals = new Set<number>();
  const providers = new Set<string>();
  let total = Shared.minor(source.openingMinor);
  if (total === undefined) return undefined;
  for (const row of source.rows) {
    const amount = Shared.minor(row.amountMinor);
    if (amount === undefined) return undefined;
    if (
      !Shared.isCalendarDate(row.date) ||
      row.date < source.startsOn ||
      row.date > source.endsOn ||
      ordinals.has(row.rowOrdinal) ||
      (row.providerId !== null && providers.has(row.providerId))
    ) {
      return undefined;
    }
    ordinals.add(row.rowOrdinal);
    if (row.providerId !== null) providers.add(row.providerId);
    total += amount;
  }
  if (total !== Shared.minor(source.closingMinor)) return undefined;
  return total;
}

// The caller holds current authority and the book write lock for the entire admission.
export function admitReviewedStatement(
  transaction: Transaction,
  scope: Scope,
  actorId: string,
  key: string,
  input: typeof Bank.ImportBankStatement.Type,
) {
  return Effect.gen(function* () {
    const request = yield* replay(
      transaction,
      scope,
      key,
      "import_bank_statement",
      actorId,
      yield* Shared.toJsonObject(input),
      ReceiptSchema,
    );
    if (request.previous)
      return { request, admitted: undefined, previous: request.previous } as const;
    const book = (yield* BankDb.lockBook(transaction, scope.bookId, "update"))[0];
    if (!book) return yield* failure("Forbidden");
    yield* Shared.requireNativeBankProfile(book.profile, book.authority);
    const source = statementSourceOf(input);
    const account = (yield* BankDb.readAccount(transaction, scope.bookId, source.accountId))[0];
    if (
      !account?.active ||
      book.currency !== source.currency ||
      !Shared.isCalendarDate(source.startsOn) ||
      !Shared.isCalendarDate(source.endsOn) ||
      source.startsOn > source.endsOn ||
      rowsAreAdmissible(source) === undefined
    ) {
      return yield* failure("InvalidJournal");
    }
    const evidence = (yield* BankDb.readEvidence(transaction, scope.bookId, input.evidenceId))[0];
    if (!evidence || evidence.mediaType !== "application/json") {
      return yield* failure("MissingEvidence");
    }
    const retained = yield* Schema.decodeEffect(Schema.fromJsonString(Bank.StatementSource))(
      evidence.content,
    ).pipe(Effect.mapError(() => failure("MissingEvidence")));
    if ((yield* digest(source)) !== (yield* digest(retained))) {
      return yield* failure("MissingEvidence");
    }

    const inputBody = yield* Shared.toJsonObject(input);
    const existing = (yield* StatementDb.readStatementByIdentity(
      transaction,
      scope.bookId,
      source.sourceBankAccountId,
      source.statementIdentifier,
    ))[0];
    if (existing) {
      if (!(yield* Shared.sameCanonical(existing.importInput, inputBody))) {
        return yield* failure("IdempotencyConflict");
      }
      return { request, admitted: existing, previous: undefined } as const;
    }

    const conflicts = (yield* SourceDb.readConflicts(transaction, scope.bookId, source))[0];
    if (!conflicts) return yield* failure("InternalError");
    if (conflicts.mapping || conflicts.overlap || conflicts.provider) {
      return yield* failure("InvalidJournal");
    }
    const id = newId("statement");
    yield* SourceDb.insertSource(
      transaction,
      scope.bookId,
      source.accountId,
      source.sourceBankAccountId,
    );
    yield* SourceDb.insertStatement(transaction, {
      bookId: scope.bookId,
      id,
      accountId: source.accountId,
      sourceBankAccountId: source.sourceBankAccountId,
      statementIdentifier: source.statementIdentifier,
      evidenceId: evidence.id,
      startsOn: source.startsOn,
      endsOn: source.endsOn,
      source: yield* Shared.toJsonObject(source),
      importInput: inputBody,
    });
    if (source.rows.length > 0) {
      yield* SourceDb.insertObservations(transaction, {
        bookId: scope.bookId,
        statementId: id,
        sourceBankAccountId: source.sourceBankAccountId,
        rows: source.rows,
      });
    }
    const revision = (yield* BankDb.bumpSourceRevision(
      transaction,
      scope.bookId,
      source.accountId,
    ))[0]?.revision;
    if (revision === undefined) return yield* failure("InternalError");
    const statement = (yield* StatementDb.readStatementByIdentity(
      transaction,
      scope.bookId,
      source.sourceBankAccountId,
      source.statementIdentifier,
    ))[0];
    if (!statement) return yield* failure("InternalError");
    return { request, admitted: statement, previous: undefined } as const;
  });
}

export const importBankStatement = Effect.fn("banking.statement.import")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Bank.ImportBankStatement.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, statementTables, statementInserts, statementUpdates);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const admission = yield* admitReviewedStatement(
        transaction,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        command.input,
      );
      if (admission.previous) return admission.previous;
      if (!admission.admitted) return yield* failure("InternalError");
      const statement = admission.admitted;

      for (const match of command.input.existingMatches) {
        yield* addMatch(
          transaction,
          command.scope.bookId,
          principal.actorId,
          {
            statementId: statement.id,
            rowOrdinal: match.rowOrdinal,
            voucherId: match.voucherId,
            lineId: match.lineId,
          },
          "imported",
        );
      }

      const matches = (yield* StatementDb.readStatementMatches(
        transaction,
        command.scope.bookId,
        statement.id,
      ))[0]?.matches;
      const checkpoint = yield* Shared.readCheckpoint(
        transaction,
        command.scope.bookId,
        statement.accountId,
      );
      const body = yield* Shared.toJsonObject({
        statement: Shared.statementBody(statement),
        matches: Array.isArray(matches) ? matches : [],
        checkpoint,
        receipt: Shared.receipt(command.idempotencyKey, "import_bank_statement", principal.actorId),
      } satisfies JsonObject);
      const receipt = yield* Shared.decode(ReceiptSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        admission.request.expected,
        "import_bank_statement",
        principal.actorId,
        body,
      );
      return receipt;
    }),
  );
});

export const getBankStatement = Effect.fn("banking.statement.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly statementId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, statementTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const statement = (yield* StatementDb.readStatement(
        transaction,
        command.scope.bookId,
        command.statementId,
      ))[0];
      if (!statement) return yield* failure("NotFound");
      const matches = (yield* StatementDb.readStatementMatches(
        transaction,
        command.scope.bookId,
        statement.id,
      ))[0]?.matches;
      return yield* Shared.decode(ViewSchema, {
        statement: Shared.statementBody(statement),
        matches: Array.isArray(matches) ? matches : [],
        checkpoint: yield* Shared.readCheckpoint(
          transaction,
          command.scope.bookId,
          statement.accountId,
        ),
      });
    }),
  );
});
