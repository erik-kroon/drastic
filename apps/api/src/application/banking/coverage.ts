import * as Accounting from "@open-erp/contracts/accounting";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import * as CoverageDb from "../../db/banking/coverage";
import * as BankDb from "../../db/banking/shared";
import * as SignoffDb from "../../db/banking/signoffs";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;

const ReportSchema = Coverage.BankSourceCoverageReport;
const ViewSchema = Coverage.BankSourceCoverageView;
const ListSchema = Coverage.BankSourceCoverageList;

const coverageTables = [
  "books",
  "accounts",
  "periods",
  "closing_inventories",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_source_coverage_reports",
  "evidence",
  "command_receipts",
];
const coverageInserts = ["bank_source_coverage_reports", "command_receipts"];
const maximumReports = 200;
const maximumCaptureBytes = 8388608;
const maximumAccounts = 100;

type Statement = CoverageDb.CoverageStatementRow;

function dayBefore(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Shared.isCalendarDate(value)) return undefined;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function statementGaps(statements: ReadonlyArray<Statement>, startsOn: string, endsOn: string) {
  const gaps: JsonObject[] = [];
  let cursor = startsOn;
  for (const statement of statements) {
    if (statement.startsOn > cursor) {
      const previous = dayBefore(statement.startsOn);
      if (previous === undefined) return undefined;
      gaps.push({ startsOn: cursor, endsOn: previous });
    }
    const next = Shared.nextDay(statement.endsOn > endsOn ? endsOn : statement.endsOn);
    if (next === undefined) return undefined;
    if (next > cursor) cursor = next;
  }
  if (cursor <= endsOn) gaps.push({ startsOn: cursor, endsOn });
  return gaps;
}

function statementOverlaps(statements: ReadonlyArray<Statement>) {
  const overlaps: JsonObject[] = [];
  const ordered = [...statements].sort((left, right) => left.id.localeCompare(right.id));
  for (let first = 0; first < ordered.length; first += 1) {
    for (let second = first + 1; second < ordered.length; second += 1) {
      const left = ordered[first];
      const right = ordered[second];
      if (left === undefined || right === undefined) continue;
      if (left.startsOn <= right.endsOn && right.startsOn <= left.endsOn) {
        overlaps.push({
          leftStatementId: left.id,
          rightStatementId: right.id,
          startsOn: left.startsOn > right.startsOn ? left.startsOn : right.startsOn,
          endsOn: left.endsOn < right.endsOn ? left.endsOn : right.endsOn,
        });
      }
    }
  }
  return overlaps;
}

function adjacentBalances(
  statements: ReadonlyArray<Statement>,
  sourceBankAccountId: string | null,
  bookCurrency: string,
) {
  const pairs: Array<{
    readonly leftEnds: string;
    readonly leftId: string;
    readonly rightId: string;
    readonly leftClosing: string;
    readonly rightOpening: string;
    readonly difference: string;
  }> = [];
  for (const left of statements) {
    for (const right of statements) {
      if (left === right) continue;
      if (Shared.nextDay(left.endsOn) !== right.startsOn) continue;
      if (left.body.sourceBankAccountId !== right.body.sourceBankAccountId) continue;
      if (left.body.currency !== bookCurrency || right.body.currency !== bookCurrency) continue;
      if (left.body.sourceBankAccountId !== sourceBankAccountId) continue;
      const leftClosing = Shared.textField(left.body, "closingMinor");
      const rightOpening = Shared.textField(right.body, "openingMinor");
      if (leftClosing === undefined || rightOpening === undefined) continue;
      const closing = Shared.minor(leftClosing);
      const opening = Shared.minor(rightOpening);
      if (closing === undefined || opening === undefined) continue;
      pairs.push({
        leftEnds: left.endsOn,
        leftId: left.id,
        rightId: right.id,
        leftClosing,
        rightOpening,
        difference: Shared.signedText(opening - closing),
      });
    }
  }
  pairs.sort((left, right) => {
    if (left.leftEnds !== right.leftEnds) return left.leftEnds.localeCompare(right.leftEnds);
    if (left.leftId !== right.leftId) return left.leftId.localeCompare(right.leftId);
    return left.rightId.localeCompare(right.rightId);
  });
  return pairs.map((pair) => ({
    leftStatementId: pair.leftId,
    rightStatementId: pair.rightId,
    leftClosingMinor: pair.leftClosing,
    rightOpeningMinor: pair.rightOpening,
    differenceMinor: pair.difference,
  })) satisfies JsonObject[];
}

function boundaryBalance(
  statements: ReadonlyArray<Statement>,
  boundary: string,
  edge: "startsOn" | "endsOn",
  sourceBankAccountId: string | null,
  bookCurrency: string,
) {
  const covering = statements.filter(
    (statement) => statement.startsOn <= boundary && statement.endsOn >= boundary,
  );
  const statement = covering.length === 1 ? covering[0] : undefined;
  if (
    statement === undefined ||
    statement.body.sourceBankAccountId !== sourceBankAccountId ||
    statement.body.currency !== bookCurrency ||
    (edge === "startsOn" ? statement.startsOn !== boundary : statement.endsOn !== boundary)
  ) {
    return null;
  }
  return edge === "startsOn"
    ? Shared.textField(statement.body, "openingMinor")
    : Shared.textField(statement.body, "closingMinor");
}

export const createBankSourceCoverage = Effect.fn("banking.coverage.create")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Coverage.CreateBankSourceCoverage.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, coverageTables, coverageInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];
      if (!book) return yield* failure("Forbidden");
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "create_bank_source_coverage",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        ReportSchema,
      );
      if (request.previous) return request.previous;
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);
      if (
        !Shared.isCalendarDate(command.input.startsOn) ||
        !Shared.isCalendarDate(command.input.endsOn) ||
        command.input.startsOn > command.input.endsOn
      ) {
        return yield* failure("InvalidJournal");
      }

      const inventory = (yield* SignoffDb.readInventory(
        transaction,
        command.scope.bookId,
        command.input.inventoryId,
      ))[0];
      if (!inventory) return yield* failure("NotFound");
      const period = (yield* SignoffDb.readPeriod(
        transaction,
        command.scope.bookId,
        inventory.periodId,
      ))[0];
      if (!period) return yield* failure("NotFound");
      if (command.input.startsOn !== period.startsOn || command.input.endsOn !== period.endsOn) {
        return yield* failure("InvalidJournal");
      }
      if (
        (yield* SignoffDb.readInventorySuperseded(
          transaction,
          command.scope.bookId,
          inventory.periodId,
          inventory.ordinal,
        ))[0]?.present === true
      ) {
        return yield* failure("StaleDependency");
      }
      if (
        (yield* CoverageDb.readCoverageReportCount(transaction, command.scope.bookId))[0]!.total >=
        maximumReports
      ) {
        return yield* Shared.unsupported();
      }
      const dependencyDigest = (yield* BankDb.readCoverageDependencyDigest(
        transaction,
        command.scope.bookId,
        inventory.id,
      ))[0]?.digest;
      if (dependencyDigest === undefined || dependencyDigest === null) {
        return yield* Shared.unsupported();
      }

      const declared = Shared.arrayField(inventory.body, "bankAccountIds").flatMap((entry) =>
        typeof entry === "string" ? [entry] : [],
      );
      const mapped = (yield* BankDb.readMappedAccountIds(
        transaction,
        command.scope.bookId,
      )).flatMap((row) => [row.id]);
      const accountIds = [...new Set([...declared, ...mapped])].sort();
      if (accountIds.length > maximumAccounts) return yield* Shared.unsupported();
      const accounts = yield* CoverageDb.readCoverageAccountScope(
        transaction,
        command.scope.bookId,
        accountIds,
      );

      const reportAccounts = yield* Effect.forEach(accounts, (account) =>
        Effect.gen(function* () {
          const statements = yield* CoverageDb.readCoverageStatements(
            transaction,
            command.scope.bookId,
            account.id,
            command.input.startsOn,
            command.input.endsOn,
          );
          const diagnostics: string[] = [];
          if (!declared.includes(account.id)) diagnostics.push("mapped_account_not_declared");
          if (account.sourceBankAccountId === null) diagnostics.push("source_mapping_missing");

          const coverage = yield* Effect.forEach(statements, (statement) =>
            Effect.gen(function* () {
              const opening = Shared.minor(Shared.textField(statement.body, "openingMinor"));
              const closing = Shared.minor(Shared.textField(statement.body, "closingMinor"));
              const movement = Shared.minor(statement.movementMinor);
              if (opening === undefined || closing === undefined || movement === undefined) {
                return yield* failure("InvalidJournal");
              }
              const cuts = Shared.objectField(statement.body, "completeness").declaredComplete;
              const flags: string[] = [];
              if (cuts !== true) flags.push("statement_declared_incomplete");
              if (
                statement.startsOn < command.input.startsOn ||
                statement.endsOn > command.input.endsOn
              ) {
                flags.push("statement_crosses_boundary");
              }
              if (
                statement.body.sourceBankAccountId !== account.sourceBankAccountId ||
                statement.body.currency !== book.currency
              ) {
                flags.push("source_identity_or_currency_mismatch");
              }
              if (opening + movement !== closing) flags.push("statement_balance_difference");
              if (statement.observedRowCount !== statement.declaredRowCount) {
                flags.push("statement_row_count_difference");
              }
              return Object.assign(
                {},
                {
                  statement: statement.body,
                  movementMinor: Shared.signedText(movement),
                  movementDifferenceMinor: Shared.signedText(opening + movement - closing),
                  observedRowCount: statement.observedRowCount,
                  cutsRequestedBoundary:
                    statement.startsOn < command.input.startsOn ||
                    statement.endsOn > command.input.endsOn,
                  diagnostics: flags,
                },
              ) satisfies JsonObject;
            }),
          );
          if (statements.length === 0) diagnostics.push("statements_missing");

          const gaps = statementGaps(statements, command.input.startsOn, command.input.endsOn);
          if (!gaps) return yield* failure("InvalidJournal");
          const overlaps = statementOverlaps(statements);
          const adjacent = adjacentBalances(statements, account.sourceBankAccountId, book.currency);
          const openingMinor = boundaryBalance(
            statements,
            command.input.startsOn,
            "startsOn",
            account.sourceBankAccountId,
            book.currency,
          );
          const closingMinor = boundaryBalance(
            statements,
            command.input.endsOn,
            "endsOn",
            account.sourceBankAccountId,
            book.currency,
          );
          if (openingMinor === null || openingMinor === undefined) {
            diagnostics.push("opening_checkpoint_unavailable");
          }
          if (closingMinor === null || closingMinor === undefined) {
            diagnostics.push("closing_checkpoint_unavailable");
          }
          const hasReviewGaps =
            diagnostics.length > 0 ||
            gaps.length > 0 ||
            overlaps.length > 0 ||
            adjacent.some((pair) => Shared.minor(pair.differenceMinor) !== 0n) ||
            coverage.some((entry) => Shared.arrayField(entry, "diagnostics").length > 0);
          return Object.assign(
            {},
            {
              accountId: account.id,
              code: account.code,
              name: account.name,
              active: account.active,
              accountVersion: account.version,
              declared: declared.includes(account.id),
              sourceBankAccountId: account.sourceBankAccountId,
              sourceRevision: account.sourceRevision,
              statements: coverage,
              gaps,
              overlaps,
              adjacentBalances: adjacent,
              openingMinor: openingMinor ?? null,
              closingMinor: closingMinor ?? null,
              diagnostics,
              hasReviewGaps,
            },
          ) satisfies JsonObject;
        }),
      );

      const captured = {
        id: newId("bank_coverage"),
        kind: "synthetic_bank_source_coverage_v1",
        scope: command.scope,
        input: yield* Shared.toJsonObject(command.input),
        inventory: inventory.body,
        period: {
          id: period.id,
          version: period.version,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          locked: period.locked,
        },
        currency: book.currency,
        currencyScale: book.currencyScale,
        sequence: book.committedSequence,
        dependencyDigest,
        accounts: reportAccounts,
        diagnostics: declared.length === 0 ? ["no_declared_accounts"] : [],
        hasReviewGaps:
          declared.length === 0 ||
          reportAccounts.some((account) => Shared.booleanField(account, "hasReviewGaps") === true),
        coverage: "not_established",
        financialCloseReady: false,
        knowledgeBasis: "current_known_facts_at_capture",
        createdAt: yield* isoNow(transaction),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "create_bank_source_coverage",
          principal.actorId,
        ),
      } satisfies JsonObject;
      const sealed = yield* Shared.toJsonObject(
        Object.assign({}, captured, { digest: yield* digest(captured) }),
      );
      const content = yield* Shared.canonicalText(sealed);
      const byteLength = Shared.byteLength(content);
      if (byteLength > maximumCaptureBytes) return yield* Shared.unsupported();
      const reportBody = yield* Shared.decode(ReportSchema, sealed);
      yield* CoverageDb.insertCoverageReport(transaction, {
        bookId: command.scope.bookId,
        id: reportBody.id,
        inventoryId: inventory.id,
        body: sealed,
        content,
        sha256: yield* sha256Hex(content),
        byteLength,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "create_bank_source_coverage",
        principal.actorId,
        yield* Shared.toJsonObject(reportBody),
      );
      return reportBody;
    }),
  );
});

export const getBankSourceCoverage = Effect.fn("banking.coverage.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly reportId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, coverageTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const saved = (yield* CoverageDb.readCoverageReport(
        transaction,
        command.scope.bookId,
        command.reportId,
      ))[0];
      if (!saved) return yield* failure("NotFound");
      const current = (yield* BankDb.readCoverageDependencyDigest(
        transaction,
        command.scope.bookId,
        saved.inventoryId,
      ))[0]?.digest;
      return yield* Shared.decode(ViewSchema, {
        report: yield* Shared.decode(ReportSchema, saved.body),
        dependenciesCurrent:
          current != null && Shared.textField(saved.body, "dependencyDigest") === current,
        artifact: {
          content: saved.content,
          sha256: saved.sha256,
          byteLength: saved.byteLength,
          mediaType: "application/json",
        },
      });
    }),
  );
});

export const listBankSourceCoverage = Effect.fn("banking.coverage.list")(function* (
  token: string,
  command: { readonly scope: Scope },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, coverageTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const rows = yield* CoverageDb.listCoverageReports(transaction, command.scope.bookId);
      return yield* Shared.decode(ListSchema, {
        scope: command.scope,
        items: rows.map((row) => {
          const input = Shared.objectField(row.body, "input");
          return {
            id: row.id,
            inventoryId: row.inventoryId,
            startsOn: Shared.textField(input, "startsOn") ?? "",
            endsOn: Shared.textField(input, "endsOn") ?? "",
            createdAt: Shared.textField(row.body, "createdAt") ?? "",
            sequence: Shared.textField(row.body, "sequence") ?? "",
            hasReviewGaps: Shared.booleanField(row.body, "hasReviewGaps") === true,
            digest: Shared.textField(row.body, "digest") ?? "",
          };
        }),
        coverage: "not_established",
      });
    }),
  );
});
