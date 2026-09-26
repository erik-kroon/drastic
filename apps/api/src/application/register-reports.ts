import { digest as digestNative } from "./json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as RegisterContract from "@open-erp/contracts/register-reports";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { isoNow, newId, replay, saveCommand } from "./posting";
import { decode, exactKeys, toJsonObject, unsupported, withBook } from "./commerce/support";
import * as Db from "../db/register-reports";
import { readTableAccess } from "../db/commerce/access";
import type { Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const ReportSchema = RegisterContract.RegisterReport;

const PageSchema = RegisterContract.RegisterReportPage;

const SummarySchema = RegisterContract.RegisterReportSummary;

const maximumAccounts = 100;

const maximumRecords = 2000;

const inventoryPageSize = 20;

const maximumRetainedBytes = 2097152;

const maximumOrdinal = 9223372036854775807n;

function requireRegisterAccess(transaction: Transaction, write: boolean) {
  const tables = [...Db.registerTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      if (rows.some((row) => !row.canSelect)) return unsupported();

      return write &&
        rows.some(
          (row) =>
            [
              "commerce_register_snapshots",
              "commerce_register_allocation_dependencies",
              "command_receipts",
            ].includes(row.tableName) && !row.canInsert,
        )
        ? unsupported()
        : Effect.void;
    }),
  );
}

function exact(value: string) {
  return /^-?(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function arrayOf(value: Schema.Json | undefined) {
  const parsed = Schema.decodeUnknownOption(Schema.Array(Schema.JsonObject))(value);

  return Option.isSome(parsed) ? parsed.value : null;
}

function objectOrNull(value: Schema.Json | undefined) {
  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(value);

  return Option.isSome(parsed) ? parsed.value : null;
}

function textOf(value: Schema.Json | undefined) {
  return typeof value === "string" ? value : null;
}

function exactOf(value: Schema.Json | undefined) {
  const found = textOf(value);

  return found === null ? null : exact(found);
}

type RegisterCounts = {
  readonly accountCount: bigint;
  readonly invoiceCount: bigint;
  readonly allocationCount: bigint;
  readonly lineCount: bigint;
};

type RegisterArrays = {
  readonly allocations: JsonObject;
  readonly invoices: JsonObject;
  readonly lines: JsonObject;
  readonly controls: JsonObject;
  readonly allocationRows: ReadonlyArray<JsonObject>;
  readonly invoiceRows: ReadonlyArray<JsonObject>;
  readonly lineRows: ReadonlyArray<JsonObject>;
  readonly controlRows: ReadonlyArray<JsonObject>;
};

function readCounts(transaction: Transaction, bookId: string, asOfDate: string, sequence: string) {
  return Effect.gen(function* () {
    const bounds = (yield* Db.readBounds(transaction, bookId, asOfDate, sequence))[0];

    if (!bounds) return yield* failure("InternalError");
    const accountCount = exact(bounds.accounts);
    const invoiceCount = exact(bounds.invoices);
    const allocationCount = exact(bounds.allocations);
    const lineCount = exact(bounds.lines);

    if (
      accountCount === null ||
      invoiceCount === null ||
      allocationCount === null ||
      lineCount === null
    ) {
      return yield* failure("InternalError");
    }

    if (accountCount > BigInt(maximumAccounts)) return yield* failure("InvalidJournal");

    if (invoiceCount + allocationCount + lineCount > BigInt(maximumRecords)) {
      return yield* failure("InvalidJournal");
    }

    return { accountCount, invoiceCount, allocationCount, lineCount } satisfies RegisterCounts;
  });
}

function invoiceArithmeticHolds(rows: ReadonlyArray<JsonObject>) {
  return rows.every((row) => {
    const outstanding = exactOf(row.outstandingMinor);

    return outstanding !== null && outstanding >= 0n;
  });
}

function lineArithmeticHolds(rows: ReadonlyArray<JsonObject>) {
  return rows.every((row) => {
    const allocated = exactOf(row.allocatedMinor);
    const debit = exactOf(row.debitMinor);
    const credit = exactOf(row.creditMinor);

    return allocated !== null && debit !== null && credit !== null && allocated <= debit + credit;
  });
}

function readArrays(
  transaction: Transaction,
  bookId: string,
  asOfDate: string,
  sequence: string,
  currency: string,
) {
  return Effect.gen(function* () {
    const recognised = (yield* Db.countInvalidRecognitions(
      transaction,
      bookId,
      asOfDate,
      sequence,
      currency,
    ))[0]?.invalid;

    const allocated = (yield* Db.countInvalidAllocations(
      transaction,
      bookId,
      asOfDate,
      sequence,
    ))[0]?.invalid;

    if (recognised !== "0" || allocated !== "0") return yield* failure("InvalidJournal");

    const allocations = (yield* Db.readAllocations(transaction, bookId, asOfDate, sequence))[0]
      ?.value;

    if (!allocations) return yield* failure("InternalError");

    const invoices = (yield* Db.readInvoices(
      transaction,
      bookId,
      asOfDate,
      sequence,
      allocations,
    ))[0]?.value;

    if (!invoices) return yield* failure("InternalError");
    const invoiceRows = arrayOf(invoices);
    const allocationRows = arrayOf(allocations);

    if (!invoiceRows || !allocationRows) return yield* failure("InternalError");

    if (!invoiceArithmeticHolds(invoiceRows)) return yield* failure("InvalidJournal");

    const lines = (yield* Db.readLines(
      transaction,
      bookId,
      asOfDate,
      sequence,
      invoices,
      allocations,
    ))[0]?.value;

    if (!lines) return yield* failure("InternalError");
    const lineRows = arrayOf(lines);

    if (!lineRows) return yield* failure("InternalError");

    if (!lineArithmeticHolds(lineRows)) return yield* failure("InvalidJournal");
    const controls = (yield* Db.readControls(transaction, bookId, invoices, lines))[0]?.value;

    if (!controls) return yield* failure("InternalError");
    const controlRows = arrayOf(controls);

    if (!controlRows) return yield* failure("InternalError");

    return {
      allocations,
      invoices,
      lines,
      controls,
      allocationRows,
      invoiceRows,
      lineRows,
      controlRows,
    } satisfies RegisterArrays;
  });
}

function arraysMatchBounds(arrays: RegisterArrays, counts: RegisterCounts) {
  return (
    arrays.invoiceRows.length === Number(counts.invoiceCount) &&
    arrays.allocationRows.length === Number(counts.allocationCount) &&
    arrays.lineRows.length === Number(counts.lineCount) &&
    arrays.controlRows.length === Number(counts.accountCount)
  );
}

function registerStatus(counts: RegisterCounts, controls: ReadonlyArray<JsonObject>) {
  if (counts.accountCount === 0n) return "no_declared_accounts" as const;

  const differs = controls.some((row) => {
    const difference = exactOf(row.differenceMinor);
    const unexplained = exactOf(row.unexplainedLineCount);

    if (difference === null || unexplained === null) return true;

    return difference !== 0n || unexplained !== 0n;
  });

  return differs ? ("differences" as const) : ("balanced" as const);
}

function readInventoryCursor(
  transaction: Transaction,
  scope: Scope,
  available: bigint,
  cursor: string,
) {
  return Effect.gen(function* () {
    const decoded = objectOrNull((yield* Db.decodeCursor(transaction, cursor))[0]?.value);

    if (decoded === null) return yield* failure("InvalidJournal");
    const version = textOf(decoded.version);
    const parsedScope = objectOrNull(decoded.scope);
    const cutoff = textOf(decoded.cutoff);
    const after = textOf(decoded.after);

    if (
      version !== "1" ||
      parsedScope === null ||
      textOf(parsedScope.entityId) !== scope.entityId ||
      textOf(parsedScope.bookId) !== scope.bookId ||
      cutoff === null ||
      after === null
    ) {
      return yield* failure("InvalidJournal");
    }

    const cutoffValue = exact(cutoff);
    const afterValue = exact(after);

    if (cutoffValue === null || afterValue === null) return yield* failure("InvalidJournal");

    if (cutoffValue < 0n || afterValue < 0n) return yield* failure("InvalidJournal");

    if (afterValue > cutoffValue || cutoffValue > available)
      return yield* failure("InvalidJournal");

    return { cutoff: cutoffValue, after: afterValue };
  });
}

export const createRegisterReport = Effect.fn("registerReports.create")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof RegisterContract.CreateRegisterReport.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "create_register_report",
        principal.actorId,
        yield* toJsonObject(command.input),
        ReportSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRegisterAccess(transaction, true);
      const book = (yield* Db.readRegisterBook(transaction, command.scope.bookId))[0];

      if (!book) return yield* failure("NotFound");

      if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
        return yield* unsupported();
      }

      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, ["asOfDate"]);
      const asOfDate = calendarDate(textOf(input.asOfDate) ?? "");

      if (asOfDate === null) return yield* failure("InvalidJournal");
      const sequence = book.committedSequence;
      const counts = yield* readCounts(transaction, command.scope.bookId, asOfDate, sequence);

      const arrays = yield* readArrays(
        transaction,
        command.scope.bookId,
        asOfDate,
        sequence,
        book.currency,
      );

      if (!arraysMatchBounds(arrays, counts)) return yield* failure("InvalidJournal");
      const ordinal = (yield* Db.readNextOrdinal(transaction, command.scope.bookId))[0]?.ordinal;

      if (ordinal === undefined) return yield* failure("InternalError");
      const value = exact(ordinal);

      if (value === null || value < 1n || value > maximumOrdinal) {
        return yield* failure("InvalidJournal");
      }

      const id = newId("register_report");
      const status = registerStatus(counts, arrays.controlRows);

      const body = yield* toJsonObject({
        id,
        ordinal,
        kind: "synthetic_register_snapshot_v1",
        scope: command.scope,
        asOfDate,
        sequence,
        currency: book.currency,
        currencyScale: book.currencyScale,
        profileVersion: book.profileVersion,
        knowledgeBasis: "current_known_facts_at_capture",
        coverage: "not_established",
        status,
        invoiceCount: Number(counts.invoiceCount),
        allocationCount: Number(counts.allocationCount),
        ledgerLineCount: Number(counts.lineCount),
        accountCount: Number(counts.accountCount),
        createdAt: yield* isoNow(transaction),
        receipt: {
          key: command.idempotencyKey,
          operation: "create_register_report",
          actorId: principal.actorId,
        },
        controls: arrays.controlRows,
        invoices: arrays.invoiceRows,
        allocations: arrays.allocationRows,
        ledgerLines: arrays.lineRows,
      });

      const digest = yield* digestNative(body);

      if (digest === undefined) return yield* failure("InternalError");
      const sealed = { ...body, digest };
      const bytes = (yield* Db.retainedBytes(transaction, sealed))[0]?.bytes;

      if (bytes === undefined) return yield* failure("InternalError");

      if (BigInt(bytes) > BigInt(maximumRetainedBytes)) return yield* failure("InvalidJournal");
      yield* Db.insertSnapshot(transaction, {
        bookId: command.scope.bookId,
        id,
        ordinal,
        body: sealed,
      });

      const historyVersion = (yield* Db.readAllocationHistoryVersion(
        transaction,
        command.scope.bookId,
        asOfDate,
      ))[0]?.version;

      if (historyVersion === undefined) return yield* failure("InternalError");
      yield* Db.insertAllocationDependency(transaction, command.scope.bookId, id, historyVersion);
      const result = yield* decode(ReportSchema, sealed);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "create_register_report",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getRegisterReport = Effect.fn("registerReports.get")(function* (
  token: string,
  command: { scope: Scope; reportId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireRegisterAccess(transaction, false);
    const row = (yield* Db.readSnapshot(transaction, command.scope.bookId, command.reportId))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(ReportSchema, row.body);
  });
});

export const listRegisterReports = Effect.fn("registerReports.list")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireRegisterAccess(transaction, false);
    const current = (yield* Db.readOrdinalBound(transaction, command.scope.bookId))[0]?.current;

    if (current === undefined) return yield* failure("InternalError");
    const available = exact(current);

    if (available === null) return yield* failure("InternalError");
    let cutoff = available;
    let after = 0n;

    if (command.after !== undefined) {
      const cursor = yield* readInventoryCursor(
        transaction,
        command.scope,
        available,
        command.after,
      );

      cutoff = cursor.cutoff;
      after = cursor.after;
    }

    const total = (yield* Db.countInventory(
      transaction,
      command.scope.bookId,
      cutoff.toString(),
    ))[0]?.total;

    if (total === undefined) return yield* failure("InternalError");

    if (exact(total) !== cutoff) return yield* failure("InvalidJournal");

    const rows = (yield* Db.listInventory(
      transaction,
      command.scope.bookId,
      after.toString(),
      cutoff.toString(),
      inventoryPageSize,
    ))[0]?.value;

    const itemRows = arrayOf(rows);

    if (!itemRows) return yield* failure("InternalError");
    const remaining = cutoff - after;
    const expected = remaining < BigInt(inventoryPageSize) ? Number(remaining) : inventoryPageSize;

    if (itemRows.length !== expected) return yield* failure("InvalidJournal");
    const items = yield* Effect.forEach(itemRows, (row) => decode(SummarySchema, row));
    const cursorScope = yield* toJsonObject(command.scope);

    const first = (yield* Db.readCursor(transaction, cursorScope, cutoff.toString(), "0"))[0]
      ?.cursor;

    if (first === undefined) return yield* failure("InternalError");
    const last = after + BigInt(itemRows.length);

    const next =
      last < cutoff
        ? (yield* Db.readCursor(transaction, cursorScope, cutoff.toString(), last.toString()))[0]
            ?.cursor
        : null;

    if (last < cutoff && next === undefined) return yield* failure("InternalError");

    return yield* decode(PageSchema, {
      scope: command.scope,
      cutoff: cutoff.toString(),
      total,
      first,
      items,
      next: next ?? null,
    });
  });
});
