import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Settlement from "@open-erp/contracts/settlements";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand } from "../posting";
import * as BankDb from "../../db/banking/shared";
import * as ReportDb from "../../db/banking/reports";
import * as StatementDb from "../../db/banking/statements";
import type { Transaction } from "../../db/transaction";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

const ReconciliationSchema = Bank.BankReconciliation;

const ReconciliationViewSchema = Bank.BankReconciliationView;

const CapacitySchema = Settlement.BankCapacityReconciliation;

const CapacityViewSchema = Settlement.BankCapacityReconciliationView;

const reconciliationTables = [
  "books",
  "accounts",
  "periods",
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

const maximumCombinedRows = 1000;

const maximumStatements = 100;

const maximumAllocations = 1000;

type Basis = "exact" | "capacity";

function readJsonArray(value: Json | undefined) {
  return Array.isArray(value)
    ? value.flatMap((entry) => (Shared.isJsonObject(entry) ? [entry] : []))
    : [];
}

function intervalWalk(
  statements: ReadonlyArray<StatementDb.IntervalStatementRow>,
  startsOn: string,
  endsOn: string,
) {
  const gaps: string[] = [];
  const differences: string[] = [];
  let bankOpening: bigint | undefined;
  let bankClosing: bigint | undefined;
  let lastEnd: string | undefined;
  let lastClosing: bigint | undefined;

  for (const statement of statements) {
    const opening = Shared.minor(statement.openingMinor);
    const closing = Shared.minor(statement.closingMinor);

    if (opening === undefined || closing === undefined) return undefined;

    if (lastEnd === undefined) {
      bankOpening = opening;

      if (statement.startsOn !== startsOn) {
        gaps.push("No statement covers the start of the requested interval.");
      }
    } else {
      const continuation = Shared.nextDay(lastEnd);

      if (statement.startsOn !== continuation) {
        gaps.push("There is a gap between retained statement intervals.");
      }

      if (opening !== lastClosing) {
        differences.push("Consecutive statement closing and opening balances differ.");
      }
    }

    if (statement.declaredComplete !== "true") {
      gaps.push(`Statement ${statement.id} is explicitly declared incomplete.`);
    }

    bankClosing = closing;
    lastClosing = closing;
    lastEnd = statement.endsOn;
  }

  if (lastEnd === undefined) {
    gaps.push("No bank statement covers this interval.");
  } else if (lastEnd !== endsOn) {
    gaps.push("No statement covers the end of the requested interval.");
  }

  return { gaps, differences, bankOpening, bankClosing };
}

function unmatchedSourceRows(
  rows: ReadonlyArray<JsonObject>,
  matches: ReadonlyArray<JsonObject>,
  basis: Basis,
) {
  if (basis === "capacity") {
    return rows.filter((row) => Shared.minor(Shared.textField(row, "remainingMinor")) !== 0n);
  }

  const matched = new Set(
    matches.flatMap((match) => {
      const statementId = Shared.textField(match, "statementId");
      const rowOrdinal = Shared.numberField(match, "rowOrdinal");

      return statementId === undefined || rowOrdinal === undefined
        ? []
        : [`${statementId}:${rowOrdinal}`];
    }),
  );

  return rows.filter((row) => {
    const statementId = Shared.textField(row, "statementId");
    const rowOrdinal = Shared.numberField(row, "rowOrdinal");

    return (
      statementId === undefined ||
      rowOrdinal === undefined ||
      !matched.has(`${statementId}:${rowOrdinal}`)
    );
  });
}

function unmatchedLedgerRows(
  rows: ReadonlyArray<JsonObject>,
  matches: ReadonlyArray<JsonObject>,
  basis: Basis,
) {
  if (basis === "capacity") {
    return rows.filter((row) => Shared.minor(Shared.textField(row, "remainingMinor")) !== 0n);
  }

  const matched = new Set(
    matches.flatMap((match) => {
      const voucherId = Shared.textField(match, "voucherId");
      const lineId = Shared.textField(match, "lineId");

      return voucherId === undefined || lineId === undefined ? [] : [`${voucherId}:${lineId}`];
    }),
  );

  return rows.filter((row) => {
    const voucherId = Shared.textField(row, "voucherId");
    const lineId = Shared.textField(row, "lineId");

    return (
      voucherId === undefined || lineId === undefined || !matched.has(`${voucherId}:${lineId}`)
    );
  });
}

function readReportScope(
  transaction: Transaction,
  book: BankDb.BookStateRow,
  scope: Scope,
  input: typeof Bank.ReconcileBank.Type,
  capacity: boolean,
) {
  return Effect.gen(function* () {
    if (
      !Shared.isCalendarDate(input.startsOn) ||
      !Shared.isCalendarDate(input.endsOn) ||
      input.startsOn > input.endsOn
    ) {
      return yield* failure("InvalidJournal");
    }

    const account = (yield* BankDb.readAccount(transaction, scope.bookId, input.accountId))[0];

    if (!account) return yield* failure("InvalidJournal");

    if (
      (yield* StatementDb.readStatementCut(
        transaction,
        scope.bookId,
        input.accountId,
        input.startsOn,
        input.endsOn,
      ))[0]?.present === true
    ) {
      return yield* failure("InvalidJournal");
    }

    const bounds = (yield* StatementDb.readReportBounds(
      transaction,
      scope.bookId,
      input.accountId,
      input.startsOn,
      input.endsOn,
      book.committedSequence,
    ))[0];

    if (!bounds) return yield* failure("InternalError");

    if (
      bounds.observations + bounds.lines > maximumCombinedRows ||
      bounds.statements > maximumStatements ||
      (capacity && bounds.allocations > maximumAllocations)
    ) {
      return yield* failure("InvalidJournal");
    }
  });
}

function readReportMaterial(
  transaction: Transaction,
  book: BankDb.BookStateRow,
  scope: Scope,
  input: typeof Bank.ReconcileBank.Type,
  capacity: boolean,
) {
  return Effect.gen(function* () {
    const statements = yield* StatementDb.readIntervalStatements(
      transaction,
      scope.bookId,
      input.accountId,
      input.startsOn,
      input.endsOn,
    );

    const walk = intervalWalk(statements, input.startsOn, input.endsOn);

    if (!walk) return yield* failure("InvalidJournal");

    const totals = (yield* StatementDb.readLedgerTotals(
      transaction,
      scope.bookId,
      input.accountId,
      input.startsOn,
      input.endsOn,
      book.committedSequence,
    ))[0];

    if (!totals) return yield* failure("InternalError");
    const ledgerOpening = Shared.minor(totals.openingMinor);
    const ledgerClosing = Shared.minor(totals.closingMinor);

    if (ledgerOpening === undefined || ledgerClosing === undefined) {
      return yield* failure("InternalError");
    }

    return {
      statements,
      walk,
      totals,
      ledgerOpening,
      ledgerClosing,
      sourceRows: readJsonArray(
        (yield* StatementDb.readSourceRows(
          transaction,
          scope.bookId,
          input.accountId,
          input.startsOn,
          input.endsOn,
          capacity,
        ))[0]?.rows,
      ),
      ledgerRows: readJsonArray(
        (yield* StatementDb.readLedgerRows(
          transaction,
          scope.bookId,
          input.accountId,
          input.startsOn,
          input.endsOn,
          book.committedSequence,
          capacity,
        ))[0]?.rows,
      ),
      matches: readJsonArray(
        (yield* StatementDb.readIntervalMatches(
          transaction,
          scope.bookId,
          input.accountId,
          input.startsOn,
          input.endsOn,
        ))[0]?.matches,
      ),
      allocations: capacity
        ? readJsonArray(
            (yield* StatementDb.readIntervalAllocations(
              transaction,
              scope.bookId,
              input.accountId,
              input.startsOn,
              input.endsOn,
            ))[0]?.legs,
          )
        : [],
    };
  });
}

function summarize(
  walk: NonNullable<ReturnType<typeof intervalWalk>>,
  ledgerOpening: bigint,
  ledgerClosing: bigint,
  unmatchedSource: number,
  unmatchedLedger: number,
  basis: Basis,
) {
  const differences = [...walk.differences];

  if (walk.bankOpening === undefined || walk.bankClosing === undefined) {
    differences.push("Bank opening and closing balances are unavailable.");
  } else {
    if (walk.bankOpening !== ledgerOpening) {
      differences.push("The bank and ledger opening balances differ.");
    }

    if (walk.bankClosing !== ledgerClosing) {
      differences.push("The bank and ledger closing balances differ.");
    }
  }

  if (unmatchedSource > 0) {
    differences.push(
      basis === "capacity"
        ? "Retained bank observations have unallocated residual amounts."
        : "Retained bank observations have no exact posted-line match.",
    );
  }

  if (unmatchedLedger > 0) {
    differences.push(
      basis === "capacity"
        ? "Posted bank lines have unallocated residual amounts."
        : "Posted bank lines have no retained source match.",
    );
  }

  return {
    differences,
    status:
      differences.length > 0
        ? "differences"
        : walk.gaps.length > 0
          ? "balanced_but_incomplete"
          : "complete",
  };
}

function buildReport(
  transaction: Transaction,
  book: BankDb.BookStateRow,
  scope: Scope,
  input: typeof Bank.ReconcileBank.Type,
  basis: Basis,
  reportId: string,
  createdAt: string,
  receipt: JsonObject,
) {
  const capacity = basis === "capacity";

  return Effect.gen(function* () {
    yield* readReportScope(transaction, book, scope, input, capacity);
    const found = yield* readReportMaterial(transaction, book, scope, input, capacity);
    const unmatchedSource = unmatchedSourceRows(found.sourceRows, found.matches, basis);
    const unmatchedLedger = unmatchedLedgerRows(found.ledgerRows, found.matches, basis);

    const summary = summarize(
      found.walk,
      found.ledgerOpening,
      found.ledgerClosing,
      unmatchedSource.length,
      unmatchedLedger.length,
      basis,
    );

    const checkpoint = yield* Shared.readCheckpoint(transaction, scope.bookId, input.accountId);

    const common = {
      id: reportId,
      scope,
      accountId: input.accountId,
      currency: book.currency,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: summary.status,
      checkpoint,
      accountLedgerSequence: found.totals.sequence,
      ledgerOpeningMinor: Shared.signedText(found.ledgerOpening),
      ledgerClosingMinor: Shared.signedText(found.ledgerClosing),
      bankOpeningMinor:
        found.walk.bankOpening === undefined ? null : Shared.signedText(found.walk.bankOpening),
      bankClosingMinor:
        found.walk.bankClosing === undefined ? null : Shared.signedText(found.walk.bankClosing),
      openingDifferenceMinor:
        found.walk.bankOpening === undefined
          ? null
          : Shared.signedText(found.walk.bankOpening - found.ledgerOpening),
      closingDifferenceMinor:
        found.walk.bankClosing === undefined
          ? null
          : Shared.signedText(found.walk.bankClosing - found.ledgerClosing),
      sourceCoverageComplete: found.walk.gaps.length === 0,
      statements: found.statements.map((statement) => statement.body),
      sourceRows: found.sourceRows,
      ledgerLines: found.ledgerRows,
      matches: found.matches,
      unmatchedSource,
      unmatchedLedger,
      differences: summary.differences,
      coverageGaps: found.walk.gaps,
      receipt,
      createdAt,
    } satisfies JsonObject;

    return yield* Shared.toJsonObject(
      capacity
        ? Object.assign({}, common, {
            schemaVersion: "bank-capacity-v2",
            currencyScale: book.currencyScale,
            allocations: found.allocations,
          })
        : common,
    );
  });
}

// One basis-agnostic writer: the exact and capacity reports share every balance,
// coverage and residual rule, and each public operation decodes its own contract.
function saveReconciliation(
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Bank.ReconcileBank.Type;
  },
  basis: Basis,
) {
  const operation = basis === "capacity" ? "reconcile_bank_capacity" : "reconcile_bank";

  const reportTable =
    basis === "capacity" ? "bank_capacity_reconciliations" : "bank_reconciliations";

  return Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        [...reconciliationTables, reportTable],
        [reportTable, "command_receipts"],
      );
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        basis === "capacity" ? CapacitySchema : ReconciliationSchema,
      );

      if (request.previous) return request.previous;
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);

      const body = yield* buildReport(
        transaction,
        book,
        command.scope,
        command.input,
        basis,
        newId(basis === "capacity" ? "bankcapacity" : "reconciliation"),
        yield* isoNow(transaction),
        Shared.receipt(command.idempotencyKey, operation, principal.actorId),
      );

      const accountId = Shared.textField(body, "accountId");
      const reportId = Shared.textField(body, "id");

      if (accountId === undefined || reportId === undefined) {
        return yield* failure("InternalError");
      }

      yield* ReportDb.insertReconciliation(transaction, {
        bookId: command.scope.bookId,
        id: reportId,
        accountId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        body,
      );

      return body;
    }),
  );
}

export const reconcileBank = Effect.fn("banking.reconciliation.exact")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Bank.ReconcileBank.Type;
  },
) {
  return yield* Shared.decode(
    ReconciliationSchema,
    yield* saveReconciliation(token, command, "exact"),
  );
});

export const reconcileBankCapacity = Effect.fn("banking.reconciliation.capacity")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Bank.ReconcileBank.Type;
  },
) {
  return yield* Shared.decode(
    CapacitySchema,
    yield* saveReconciliation(token, command, "capacity"),
  );
});

function readReportFreshness(
  transaction: Transaction,
  scope: Scope,
  book: BankDb.BookStateRow,
  reconciliationId: string,
  basis: Basis,
) {
  return Effect.gen(function* () {
    const stored = yield* basis === "capacity"
      ? ReportDb.readCapacityReconciliation(transaction, scope.bookId, reconciliationId)
      : ReportDb.readReconciliation(transaction, scope.bookId, reconciliationId);

    const report = stored[0];

    if (!report) return yield* failure("NotFound");
    const accountId = Shared.textField(report.body, "accountId");
    const endsOn = Shared.textField(report.body, "endsOn");

    if (accountId === undefined || endsOn === undefined) {
      return yield* failure("InternalError");
    }

    const checkpoint = yield* Shared.readCheckpoint(transaction, scope.bookId, accountId);

    const sequence = (yield* StatementDb.readAccountLedgerSequence(
      transaction,
      scope.bookId,
      accountId,
      endsOn,
    ))[0]?.sequence;

    if (sequence === undefined) return yield* failure("InternalError");

    return {
      body: report.body,
      current: {
        fresh:
          checkpoint.sourceRevision ===
            Shared.textField(Shared.objectField(report.body, "checkpoint"), "sourceRevision") &&
          sequence === Shared.textField(report.body, "accountLedgerSequence") &&
          book.currency === Shared.textField(report.body, "currency") &&
          book.profile === Shared.bankProfile &&
          book.authority === "native",
        currentSourceRevision: checkpoint.sourceRevision,
        currentAccountLedgerSequence: sequence,
      },
    };
  });
}

export const getBankReconciliation = Effect.fn("banking.reconciliation.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reconciliationId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, [...reconciliationTables, "bank_reconciliations"]);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      const found = yield* readReportFreshness(
        transaction,
        command.scope,
        book,
        command.reconciliationId,
        "exact",
      );

      return yield* Shared.decode(ReconciliationViewSchema, {
        report: yield* Shared.decode(ReconciliationSchema, found.body),
        ...found.current,
      });
    }),
  );
});

export const getBankCapacityReconciliation = Effect.fn("banking.reconciliation.capacityGet")(
  function* (token: string, command: { readonly scope: Scope; readonly reconciliationId: string }) {
    return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, [
          ...reconciliationTables,
          "bank_capacity_reconciliations",
        ]);
        yield* Shared.requireColumns(transaction, Shared.accountColumns);
        const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

        if (!book) return yield* failure("Forbidden");

        const found = yield* readReportFreshness(
          transaction,
          command.scope,
          book,
          command.reconciliationId,
          "capacity",
        );

        return yield* Shared.decode(CapacityViewSchema, {
          report: yield* Shared.decode(CapacitySchema, found.body),
          ...found.current,
        });
      }),
    );
  },
);
