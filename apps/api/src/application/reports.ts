import { digest as digestNative } from "./json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as ReportContract from "@open-erp/contracts/reports";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { isoNow, newId, replay, saveCommand } from "./posting";
import { decode, exactKeys, toJsonObject, unsupported, withBook } from "./commerce/support";
import * as Db from "../db/reports";
import { readTableAccess } from "../db/commerce/access";
import type { Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

type Family = Db.Family;

const SnapshotSchema = ReportContract.ReportSnapshot;

const SnapshotPageSchema = ReportContract.ReportSnapshotPage;

const LinesSchema = ReportContract.ReportLines;

const ExplanationSchema = ReportContract.ReportExplanation;

const GeneralLedgerSchema = ReportContract.GeneralLedgerPage;

const FamilySnapshotSchema = ReportContract.ReportFamilySnapshot;

const ComparisonSchema = ReportContract.ReportComparisonPage;

const families = ["profit_and_loss", "balance_sheet", "cash_flow"] as const;

const mappingKeys = ["version", "reviewed", "roles"] as const;

const roleKeys = ["accountId", "role"] as const;

const linePageSize = 100;

const snapshotPageSize = 50;

const comparisonPageSize = 100;

const maximumFamilyLines = 10000;

const maximumMappingRoles = 500;

const cursorParts =
  /^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,18}:[1-9][0-9]{0,9}$/;

function requireReportAccess(transaction: Transaction, write: boolean) {
  const tables = [...Db.reportTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      if (rows.some((row) => !row.canSelect)) return unsupported();

      return write &&
        rows.some(
          (row) =>
            ["report_snapshots", "report_lines", "command_receipts"].includes(row.tableName) &&
            !row.canInsert,
        )
        ? unsupported()
        : Effect.void;
    }),
  );
}

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function exact(value: string) {
  return /^-?(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

function objectOrNull(value: Schema.Json | undefined) {
  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(value);

  return Option.isSome(parsed) ? parsed.value : null;
}

function arrayOrNull(value: Schema.Json | undefined) {
  const parsed = Schema.decodeUnknownOption(Schema.Array(Schema.Json))(value);

  return Option.isSome(parsed) ? parsed.value : null;
}

function familyOrNull(value: string | null) {
  return value === null ? null : (families.find((choice) => choice === value) ?? null);
}

function text(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function number(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "number" ? found : null;
}

function readReport(transaction: Transaction, scope: Scope, reportId: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readSnapshot(transaction, scope.bookId, reportId))[0];

    if (!row) return yield* failure("NotFound");

    return row;
  });
}

function readReportLine(
  transaction: Transaction,
  scope: Scope,
  reportId: string,
  accountId: string,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readLine(transaction, scope.bookId, reportId, accountId))[0];

    if (!row) return yield* failure("NotFound");

    return row.body;
  });
}

export const prepareReport = Effect.fn("reports.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof ReportContract.PrepareReport.Type;
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
        "prepare_report",
        principal.actorId,
        yield* toJsonObject(command.input),
        SnapshotSchema,
      );

      if (request.previous) return request.previous;
      yield* requireReportAccess(transaction, true);
      const book = (yield* Db.readReportBook(transaction, command.scope.bookId))[0];

      if (!book) return yield* failure("NotFound");

      if (command.input.kind !== "trial_balance_v1" || book.profile !== "synthetic-core-v1") {
        return yield* unsupported();
      }

      const startsOn = calendarDate(command.input.startsOn);
      const endsOn = calendarDate(command.input.endsOn);

      if (startsOn === null || endsOn === null) return yield* failure("InvalidJournal");

      if (startsOn > endsOn) return yield* failure("InvalidJournal");
      const sequence = book.committedSequence;

      const totals = (yield* Db.readReportTotals(
        transaction,
        command.scope.bookId,
        sequence,
        startsOn,
        endsOn,
      ))[0];

      if (!totals) return yield* failure("InternalError");
      const debit = exact(totals.debitMinor);
      const credit = exact(totals.creditMinor);

      if (debit === null || credit === null) return yield* failure("InternalError");
      const id = newId("report");

      const body = yield* toJsonObject({
        kind: "trial_balance_v1",
        id,
        scope: command.scope,
        startsOn,
        endsOn,
        sequence,
        currency: book.currency,
        currencyScale: book.currencyScale,
        createdAt: yield* isoNow(transaction),
        accountCount: Number(totals.accountCount),
        voucherCount: Number(totals.voucherCount),
        debitMinor: totals.debitMinor,
        creditMinor: totals.creditMinor,
        balanced: debit === credit,
        coverage: "not_established",
        warnings: [
          "Internal synthetic trial balance only; not a statutory financial statement.",
          "A balanced ledger does not establish complete source records, tax correctness or period readiness.",
          "Opening balances include all earlier postings; no fiscal-year profit transfer is inferred.",
        ],
      });

      yield* Db.insertSnapshot(transaction, {
        bookId: command.scope.bookId,
        id,
        startsOn,
        endsOn,
        sequence,
        body,
      });
      yield* Db.insertTrialBalanceLines(
        transaction,
        command.scope.bookId,
        id,
        sequence,
        startsOn,
        endsOn,
      );
      const result = yield* decode(SnapshotSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_report",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getReport = Effect.fn("reports.get")(function* (
  token: string,
  command: { scope: Scope; reportId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);
    const row = yield* readReport(transaction, command.scope, command.reportId);

    return yield* decode(SnapshotSchema, row.body);
  });
});

export const listReports = Effect.fn("reports.list")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);
    const after = command.after ?? "";

    if (after !== "" && !/^[a-z][a-z0-9_-]{2,127}$/.test(after)) {
      return yield* failure("InvalidJournal");
    }

    const rows = yield* Db.listSnapshots(
      transaction,
      command.scope.bookId,
      "trial_balance_v1",
      after,
    );

    const page = rows.slice(0, snapshotPageSize);
    const items = yield* Effect.forEach(page, (row) => decode(SnapshotSchema, row.body));
    const last = page[page.length - 1];

    return yield* decode(SnapshotPageSchema, {
      items,
      next: rows.length > snapshotPageSize && last !== undefined ? last.id : null,
    });
  });
});

export const reportLines = Effect.fn("reports.lines")(function* (
  token: string,
  command: { scope: Scope; reportId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);
    const snapshot = yield* readReport(transaction, command.scope, command.reportId);
    const after = command.after ?? "";

    const rows = yield* Db.listLines(
      transaction,
      command.scope.bookId,
      command.reportId,
      after,
      linePageSize + 1,
    );

    const page = rows.slice(0, linePageSize);
    const items = yield* Effect.forEach(page, (row) => decode(ReportContract.ReportLine, row.body));

    return yield* decode(LinesSchema, {
      reportId: command.reportId,
      total: Number(snapshot.body.accountCount),
      items,
      next: rows.length > linePageSize ? (page.at(-1)?.body.accountId ?? null) : null,
    });
  });
});

export const reportExplanation = Effect.fn("reports.explain")(function* (
  token: string,
  command: { scope: Scope; reportId: string; lineId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);
    const snapshot = yield* readReport(transaction, command.scope, command.reportId);

    const line = yield* readReportLine(
      transaction,
      command.scope,
      command.reportId,
      command.lineId,
    );

    const parts = command.after === undefined ? null : command.after.split(":");

    if (parts !== null) {
      if (
        parts.length !== 4 ||
        !cursorParts.test(command.after!) ||
        parts[0] !== command.reportId ||
        parts[1] !== command.lineId
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    const afterSequence = parts === null ? "0" : parts![2]!;
    const afterOrdinal = parts === null ? 0 : Number(parts![3]);

    const total = (yield* Db.countContributions(
      transaction,
      command.scope.bookId,
      snapshot.sequence,
      snapshot.endsOn,
      command.lineId,
    ))[0];

    if (!total) return yield* failure("InternalError");

    const rows = yield* Db.listContributions(
      transaction,
      command.scope.bookId,
      snapshot.sequence,
      snapshot.endsOn,
      command.lineId,
      afterSequence,
      afterOrdinal,
      snapshot.startsOn,
      linePageSize + 1,
    );

    const page = rows.slice(0, linePageSize);

    const items = yield* Effect.forEach(page, (row) =>
      decode(ReportContract.Contribution, {
        voucherId: row.voucherId,
        lineId: row.lineId,
        sequence: row.sequence,
        ordinal: row.ordinal,
        postingDate: row.postingDate,
        part: row.part,
        description: row.description,
        debitMinor: row.debitMinor,
        creditMinor: row.creditMinor,
        evidenceRefs: row.evidenceRefs,
      } satisfies JsonObject),
    );

    return yield* decode(ExplanationSchema, {
      report: snapshot.body,
      line,
      formula: "closing = opening + debits - credits",
      totalContributions: Number(total.total),
      items,
      next:
        rows.length > linePageSize
          ? `${command.reportId}:${command.lineId}:${page.at(-1)!.sequence}:${page.at(-1)!.ordinal}`
          : null,
    });
  });
});

export const reportGeneralLedger = Effect.fn("reports.generalLedger")(function* (
  token: string,
  command: { scope: Scope; reportId: string; lineId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);
    const snapshot = yield* readReport(transaction, command.scope, command.reportId);

    const line = yield* readReportLine(
      transaction,
      command.scope,
      command.reportId,
      command.lineId,
    );

    const opening = text(line, "openingMinor");

    if (opening === null) return yield* failure("InternalError");
    const parts = command.after === undefined ? null : command.after.split(":");

    if (parts !== null) {
      if (
        parts.length !== 4 ||
        !cursorParts.test(command.after!) ||
        parts[0] !== command.reportId ||
        parts[1] !== command.lineId
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    const afterSequence = parts === null ? "0" : parts![2]!;
    const afterOrdinal = parts === null ? 0 : Number(parts![3]);

    if (
      parts !== null &&
      (yield* Db.existsIntervalContribution(
        transaction,
        command.scope.bookId,
        snapshot.sequence,
        snapshot.startsOn,
        snapshot.endsOn,
        command.lineId,
        afterSequence,
        afterOrdinal,
      ))[0]?.present !== true
    ) {
      return yield* failure("InvalidJournal");
    }

    const total = (yield* Db.countIntervalContributions(
      transaction,
      command.scope.bookId,
      snapshot.sequence,
      snapshot.startsOn,
      snapshot.endsOn,
      command.lineId,
    ))[0];

    if (!total) return yield* failure("InternalError");

    const pageOpening = (yield* Db.pageOpeningBalance(
      transaction,
      command.scope.bookId,
      snapshot.sequence,
      snapshot.startsOn,
      snapshot.endsOn,
      command.lineId,
      opening,
      afterSequence,
      afterOrdinal,
    ))[0];

    if (!pageOpening) return yield* failure("InternalError");
    let balance = exact(pageOpening.pageOpening);

    if (balance === null) return yield* failure("InternalError");

    const rows = yield* Db.listIntervalContributions(
      transaction,
      command.scope.bookId,
      snapshot.sequence,
      snapshot.startsOn,
      snapshot.endsOn,
      command.lineId,
      afterSequence,
      afterOrdinal,
      linePageSize + 1,
    );

    const page = rows.slice(0, linePageSize);
    const items: Array<JsonObject> = [];

    for (const row of page) {
      const debit = exact(row.debitMinor);
      const credit = exact(row.creditMinor);

      if (debit === null || credit === null) return yield* failure("InternalError");
      balance += debit - credit;
      items.push({
        voucherId: row.voucherId,
        lineId: row.lineId,
        sequence: row.sequence,
        ordinal: row.ordinal,
        postingDate: row.postingDate,
        part: "movement",
        series: row.series ?? "",
        voucherNumber: row.voucherNumber ?? "0",
        postingPurpose: row.postingPurpose ?? "",
        correctsVoucherId: row.correctsVoucherId,
        description: row.description,
        debitMinor: row.debitMinor,
        creditMinor: row.creditMinor,
        evidenceRefs: row.evidenceRefs,
        runningBalanceMinor: balance.toString(),
      } satisfies JsonObject);
    }

    const decoded = yield* Effect.forEach(items, (item) =>
      decode(ReportContract.GeneralLedgerEntry, item),
    );

    return yield* decode(GeneralLedgerSchema, {
      report: snapshot.body,
      line,
      order: "committed_sequence_then_line_ordinal",
      formula: "balance = opening + debits - credits",
      totalMovements: Number(total.total),
      pageOpeningMinor: pageOpening.pageOpening,
      pageClosingMinor: balance.toString(),
      items: decoded,
      next:
        rows.length > linePageSize
          ? `${command.reportId}:${command.lineId}:${page.at(-1)!.sequence}:${page.at(-1)!.ordinal}`
          : null,
    });
  });
});

function validateMapping(mapping: JsonObject, family: Family) {
  return Effect.gen(function* () {
    yield* exactKeys(mapping, [...mappingKeys]);

    if (mapping.version !== "synthetic_report_mapping_v1" || mapping.reviewed !== true) {
      return yield* unsupported();
    }

    const roles = arrayOrNull(mapping.roles);

    if (roles === null) return yield* unsupported();

    if (roles.length < 1 || roles.length > maximumMappingRoles) return yield* unsupported();
    const allowed = Db.rolesFor(family);
    const seen = new Set<string>();

    for (const entry of roles) {
      const role = objectOrNull(entry);

      if (role === null) return yield* failure("InvalidJournal");
      yield* exactKeys(role, [...roleKeys]);
      const accountId = text(role, "accountId");
      const name = text(role, "role");

      if (accountId === null || !/^[a-z][a-z0-9_-]{2,127}$/.test(accountId)) {
        return yield* failure("InvalidJournal");
      }

      if (name === null) return yield* failure("InvalidJournal");

      if (name !== "excluded" && !allowed.includes(name)) return yield* unsupported();

      if (seen.has(accountId)) return yield* unsupported();
      seen.add(accountId);
    }

    return roles;
  });
}

function familyView(
  report: JsonObject,
  mapping: JsonObject,
  mappingDigest: string,
  family: Family,
  lines: ReadonlyArray<Db.FamilyLineRow>,
  totals: JsonObject,
) {
  const sourceReportId = text(report, "sourceReportId");
  const sequence = text(report, "sequence");
  const startsOn = text(report, "startsOn");
  const endsOn = text(report, "endsOn");
  const warnings = arrayOrNull(report.warnings);

  if (
    sourceReportId === null ||
    sequence === null ||
    startsOn === null ||
    endsOn === null ||
    warnings === null
  ) {
    return null;
  }

  return {
    report,
    family,
    sourceReportId,
    cutoff: { sequence, startsOn, endsOn },
    mapping,
    mappingDigest,
    lines: lines.map((row) => ({
      id: row.id,
      label: row.label,
      accountIds: row.accountIds,
      openingMinor: row.openingMinor,
      movementMinor: row.movementMinor,
      closingMinor: row.closingMinor,
      amountMinor: row.amountMinor,
    })),
    totals,
    interpretation: "synthetic_reviewed_mapping_only",
    coverage: "not_established",
    reviewedOpening: false,
    statutory: false,
    financialClose: false,
    warnings,
  } satisfies JsonObject;
}

function readFamilySnapshot(transaction: Transaction, scope: Scope, reportId: string) {
  return Effect.gen(function* () {
    const row = yield* readReport(transaction, scope, reportId);
    const family = text(row.body, "family");
    const parsedMapping = objectOrNull(row.body.mapping);
    const sourceReportId = text(row.body, "sourceReportId");
    const mappingDigest = text(row.body, "mappingDigest");

    if (
      family === null ||
      parsedMapping === null ||
      sourceReportId === null ||
      mappingDigest === null
    ) {
      return yield* unsupported();
    }

    const expected = yield* digestNative(parsedMapping);

    if (expected === undefined) return yield* failure("InternalError");

    if (
      parsedMapping.version !== "synthetic_report_mapping_v1" ||
      parsedMapping.reviewed !== true ||
      mappingDigest !== expected
    ) {
      return yield* unsupported();
    }

    const selected = familyOrNull(family);

    if (selected === null) return yield* unsupported();

    const computed = (yield* Db.readFamilyLines(
      transaction,
      scope.bookId,
      reportId,
      selected,
      parsedMapping,
    ))[0];

    if (!computed) return yield* failure("InternalError");

    const view = familyView(
      row.body,
      parsedMapping,
      mappingDigest,
      selected,
      computed.lines,
      computed.totals,
    );

    if (view === null) return yield* failure("InternalError");

    return yield* decode(FamilySnapshotSchema, view);
  });
}

export const getReportFamily = Effect.fn("reports.getFamily")(function* (
  token: string,
  command: { scope: Scope; reportId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);

    return yield* readFamilySnapshot(transaction, command.scope, command.reportId);
  });
});

export const prepareReportFamily = Effect.fn("reports.prepareFamily")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof ReportContract.PrepareReportFamily.Type;
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
        "prepare_report_family",
        principal.actorId,
        yield* toJsonObject(command.input),
        FamilySnapshotSchema,
      );

      if (request.previous) return request.previous;
      yield* requireReportAccess(transaction, true);
      const book = (yield* Db.readReportBook(transaction, command.scope.bookId))[0];

      if (!book) return yield* failure("NotFound");
      const input = yield* toJsonObject(command.input);
      yield* exactKeys(input, ["kind", "sourceReportId", "mapping"]);
      const selected = familyOrNull(text(input, "kind"));
      const mapping = objectOrNull(input.mapping);

      if (selected === null || mapping === null) return yield* unsupported();
      yield* validateMapping(mapping, selected);
      const sourceId = text(input, "sourceReportId");

      if (sourceId === null) return yield* failure("InvalidJournal");
      const source = (yield* Db.readSnapshot(transaction, command.scope.bookId, sourceId))[0];

      if (!source) return yield* failure("NotFound");

      if (text(source.body, "kind") !== "trial_balance_v1") return yield* unsupported();

      if (book.profile !== "synthetic-core-v1") return yield* unsupported();

      if (number(source.body, "currencyScale") === null) return yield* unsupported();

      const counted = (yield* Db.countReportLines(
        transaction,
        command.scope.bookId,
        sourceId,
        maximumFamilyLines,
      ))[0];

      if (!counted) return yield* failure("InternalError");

      if (BigInt(counted.count) < 1n || BigInt(counted.count) > BigInt(maximumFamilyLines)) {
        return yield* unsupported();
      }

      const coverage = (yield* Db.readComparisonMappingRows(
        transaction,
        command.scope.bookId,
        sourceId,
        mapping,
      ))[0];

      if (!coverage) return yield* failure("InternalError");

      if (coverage.unmapped !== "0" || coverage.unused !== "0") return yield* unsupported();
      const mapped = arrayOrNull(mapping.roles);

      if (mapped === null) return yield* unsupported();

      if (counted.count !== String(mapped.length)) return yield* unsupported();
      const reportId = newId("report");
      const mappingDigest = yield* digestNative(mapping);

      if (mappingDigest === undefined) return yield* failure("InternalError");

      const body = yield* toJsonObject({
        kind: selected,
        id: reportId,
        scope: command.scope,
        sourceReportId: source.id,
        family: selected,
        startsOn: source.startsOn,
        endsOn: source.endsOn,
        sequence: source.sequence,
        currency: source.body.currency,
        currencyScale: source.body.currencyScale,
        createdAt: yield* isoNow(transaction),
        accountCount: source.body.accountCount,
        voucherCount: source.body.voucherCount,
        debitMinor: source.body.debitMinor,
        creditMinor: source.body.creditMinor,
        balanced: source.body.balanced,
        coverage: "not_established",
        mapping,
        mappingDigest,
        reviewedOpening: false,
        statutory: false,
        financialClose: false,
        warnings: [
          "Synthetic report family only; no statutory financial statement, reviewed opening or financial-close readiness is established.",
          "The report uses the saved source cutoff and explicit reviewed account-role mapping; no account classification is inferred.",
          "Contributing entries remain the existing fixed-cutoff journal-line lineage and require the saved source report interpretation.",
        ],
      });

      yield* Db.insertSnapshot(transaction, {
        bookId: command.scope.bookId,
        id: reportId,
        startsOn: source.startsOn,
        endsOn: source.endsOn,
        sequence: source.sequence,
        body,
      });
      yield* Db.copyReportLines(transaction, command.scope.bookId, source.id, reportId);
      const result = yield* readFamilySnapshot(transaction, command.scope, reportId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_report_family",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const compareReports = Effect.fn("reports.compare")(function* (
  token: string,
  command: {
    scope: Scope;
    leftReportId: string;
    rightReportId: string;
    after?: string;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireReportAccess(transaction, false);
    const left = yield* readReport(transaction, command.scope, command.leftReportId);
    const right = yield* readReport(transaction, command.scope, command.rightReportId);

    for (const side of [left, right]) {
      if (text(side.body, "kind") !== "trial_balance_v1") return yield* unsupported();

      if (number(side.body, "currencyScale") === null) return yield* unsupported();
    }

    if (
      text(left.body, "currency") !== text(right.body, "currency") ||
      number(left.body, "currencyScale") !== number(right.body, "currencyScale")
    ) {
      return yield* unsupported();
    }

    const sources: Array<{
      snapshot: Db.SnapshotRow;
      totals: Db.ComparisonTotalsRow;
      digest: string;
    }> = [];

    for (const snapshot of [left, right]) {
      const counted = (yield* Db.countReportLines(
        transaction,
        command.scope.bookId,
        snapshot.id,
        maximumFamilyLines,
      ))[0];

      if (!counted) return yield* failure("InternalError");

      if (counted.inconsistent) return yield* failure("InvalidJournal");

      if (BigInt(counted.count) > BigInt(maximumFamilyLines)) return yield* unsupported();
      const headerCount = number(snapshot.body, "accountCount");

      if (headerCount === null) return yield* failure("InternalError");

      if (counted.count !== String(headerCount)) return yield* failure("InvalidJournal");

      const totals = (yield* Db.readComparisonTotals(
        transaction,
        command.scope.bookId,
        snapshot.id,
      ))[0];

      if (!totals) return yield* failure("InternalError");

      if (
        totals.debitMinor !== text(snapshot.body, "debitMinor") ||
        totals.creditMinor !== text(snapshot.body, "creditMinor")
      ) {
        return yield* failure("InvalidJournal");
      }

      const digest = (yield* Db.digestHeaderWithLines(
        transaction,
        command.scope.bookId,
        snapshot.id,
        snapshot.body,
      ))[0];

      if (!digest) return yield* failure("InternalError");
      sources.push({ snapshot, totals, digest: digest.digest });
    }

    let anchor = "";

    if (command.after !== undefined) {
      if (
        !/^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/.test(
          command.after,
        ) ||
        command.after.split(":")[0] !== command.leftReportId ||
        command.after.split(":")[1] !== command.rightReportId
      ) {
        return yield* failure("InvalidJournal");
      }

      anchor = command.after.split(":")[2]!;

      if (
        (yield* Db.comparisonCursorExists(
          transaction,
          command.scope.bookId,
          command.leftReportId,
          command.rightReportId,
          anchor,
        ))[0]?.present !== true
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    const page = (yield* Db.readComparisonPage(
      transaction,
      command.scope.bookId,
      command.leftReportId,
      command.rightReportId,
      anchor,
      comparisonPageSize,
    ))[0];

    if (!page) return yield* failure("InternalError");

    const items = page.items.map((row) => ({
      accountId: row.accountId,
      presence: row.presence,
      left: row.left,
      right: row.right,
      labelsChanged: row.labelsChanged,
      difference: row.difference,
    }));

    const leftTotals = sources[0]!.totals;
    const rightTotals = sources[1]!.totals;

    const difference =
      page.leftOnlyCount === "0" && page.rightOnlyCount === "0"
        ? {
            openingMinor: (
              exact(rightTotals.openingMinor)! - exact(leftTotals.openingMinor)!
            ).toString(),
            debitMinor: (exact(rightTotals.debitMinor)! - exact(leftTotals.debitMinor)!).toString(),
            creditMinor: (
              exact(rightTotals.creditMinor)! - exact(leftTotals.creditMinor)!
            ).toString(),
            movementMinor: (
              exact(rightTotals.movementMinor)! - exact(leftTotals.movementMinor)!
            ).toString(),
            closingMinor: (
              exact(rightTotals.closingMinor)! - exact(leftTotals.closingMinor)!
            ).toString(),
          }
        : null;

    return yield* decode(ComparisonSchema, {
      left: {
        report: left.body,
        digest: sources[0]!.digest,
        digestScope: "saved_header_and_account_lines",
      },
      right: {
        report: right.body,
        digest: sources[1]!.digest,
        digestScope: "saved_header_and_account_lines",
      },
      currency: text(left.body, "currency")!,
      currencyScale: number(left.body, "currencyScale")!,
      order: "account_identity",
      differenceFormula: "difference = right - left",
      movementFormula: "movement = debits - credits",
      closingFormula: "closing = opening + debits - credits",
      sameInterval:
        text(left.body, "startsOn") === text(right.body, "startsOn") &&
        text(left.body, "endsOn") === text(right.body, "endsOn"),
      sameCutoff: left.sequence === right.sequence,
      totalAccounts: Number(page.totalAccounts),
      bothPresentCount: Number(page.bothPresentCount),
      leftOnlyCount: Number(page.leftOnlyCount),
      rightOnlyCount: Number(page.rightOnlyCount),
      totals: {
        left: {
          openingMinor: leftTotals.openingMinor,
          debitMinor: leftTotals.debitMinor,
          creditMinor: leftTotals.creditMinor,
          movementMinor: leftTotals.movementMinor,
          closingMinor: leftTotals.closingMinor,
        },
        right: {
          openingMinor: rightTotals.openingMinor,
          debitMinor: rightTotals.debitMinor,
          creditMinor: rightTotals.creditMinor,
          movementMinor: rightTotals.movementMinor,
          closingMinor: rightTotals.closingMinor,
        },
        difference,
      },
      items,
      next:
        page.next === null ? null : `${command.leftReportId}:${command.rightReportId}:${page.next}`,
      interpretation: "saved_snapshot_arithmetic_only",
      coverage: "not_established",
      reviewedOpening: false,
      statutoryComparability: false,
      financialCloseReady: false,
      warnings: [
        "Differences are right minus left over saved minor units, not approved prior-year comparatives or financial-close results.",
        "Different intervals and cutoffs remain visible; equal dates or cutoffs do not establish like-for-like source completeness.",
        "Missing account sides and their differences are null, never zero. Full-total difference is unavailable when account identity sets differ.",
        "Frozen account codes and names can differ. Identity, not labels, aligns accounts; no new, renamed or absent account is guessed equivalent.",
        "Opening amounts include earlier postings in each saved report, not a reviewed OpeningSet or inferred fiscal-year transfer.",
      ],
    });
  });
});
