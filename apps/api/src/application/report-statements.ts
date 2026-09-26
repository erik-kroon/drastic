import * as Accounting from "@open-erp/contracts/accounting";
import * as StatementContract from "@open-erp/contracts/report-statements";
import { calculateStatementModel } from "@open-erp/domain/statements";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { isoNow, newId, replay, saveCommand, versionedDigest } from "./posting";
import { decode, toJsonObject, unsupported, withBook, type JsonObject } from "./commerce/support";
import { readTableAccess } from "../db/commerce/access";
import * as Db from "../db/report-statements";
import type { Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type StatementKind = StatementContract.StatementKind;

const SnapshotSchema = StatementContract.StatementSnapshot;

const PageSchema = StatementContract.StatementSnapshotPage;

const ExplanationSchema = StatementContract.StatementRowExplanation;

const ComparisonSchema = StatementContract.StatementComparison;

const ListSchema = StatementContract.StatementSnapshotList;

const RowSchema = StatementContract.StatementModelRow;

const ContributionSchema = StatementContract.StatementContribution;

const inputKeys = ["fiscalYearId", "asOf", "plStartsOn", "plEndsOn", "mapping"];

const ordinalCursor = /^[a-z][a-z0-9_-]{2,127}:[1-9][0-9]{0,9}$/;

const rowCursor = /^[a-z][a-z0-9_-]{2,127}:[a-z][a-z0-9_-]{2,127}$/;

const identifier = /^[a-z][a-z0-9_-]{2,127}$/;

function requireStatementAccess(transaction: Transaction, write: boolean) {
  const tables = [...Db.statementTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      if (rows.some((row) => !row.canSelect)) return unsupported();

      return write &&
        rows.some((row) =>
          Db.statementWriteTables.some((name) => name === row.tableName && !row.canInsert),
        )
        ? unsupported()
        : Effect.void;
    }),
  );
}

function requireNativeProfile(row: Db.StatementBookRow | undefined) {
  if (row === undefined) return failure("NotFound");

  return row.profile === "synthetic-core-v1" ? Effect.void : unsupported();
}

function arrayOf(value: JsonObject, key: string) {
  const parsed = Schema.decodeUnknownOption(Schema.Array(Schema.JsonObject))(value[key]);

  return Option.isSome(parsed) ? parsed.value : null;
}

function text(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function objectOf(value: JsonObject, key: string) {
  const found = value[key];

  return Schema.is(Schema.JsonObject)(found) ? found : null;
}

function ordinalAnchor(cursor: string | undefined) {
  if (cursor === undefined) return { ordinal: 0, after: null };

  if (!ordinalCursor.test(cursor)) return null;

  const ordinal = Number(cursor.split(":")[1]);

  return Number.isSafeInteger(ordinal) && ordinal > 0 ? { ordinal, after: cursor } : null;
}

function rowAnchor(cursor: string | undefined) {
  if (cursor === undefined) return { rowId: "", after: null };

  if (!rowCursor.test(cursor)) return null;

  const [snapshotId, rowId] = cursor.split(":");

  return snapshotId === undefined || rowId === undefined ? null : { rowId, after: cursor };
}

function requireRowAnchor(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  ordinal: number,
) {
  if (ordinal === 0) return Effect.void;

  return Db.readStatementRowAnchor(transaction, bookId, snapshotId, ordinal).pipe(
    Effect.flatMap((rows) => (rows.length === 1 ? Effect.void : failure("NotFound"))),
  );
}

function requireContributionAnchor(
  transaction: Transaction,
  bookId: string,
  snapshotId: string,
  rowId: string,
  ordinal: number,
) {
  if (ordinal === 0) return Effect.void;

  return Db.readStatementContributionAnchor(transaction, bookId, snapshotId, rowId, ordinal).pipe(
    Effect.flatMap((rows) => (rows.length === 1 ? Effect.void : failure("NotFound"))),
  );
}

function exactInputKeys(value: JsonObject) {
  const actual = Object.keys(value).sort();
  const expected = [...inputKeys].sort();

  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? Effect.void
    : failure("InvalidJournal");
}

type CapturedStatement = {
  readonly fiscalYear: Db.StatementFiscalYearRow;
  readonly openingBasis: StatementContract.StatementOpeningBasis;
  readonly accounts: ReadonlyArray<Db.StatementAccountRow>;
  readonly opening: ReadonlyArray<Db.StatementAmountRow>;
  readonly components: ReadonlyArray<Db.StatementComponentRow>;
  readonly accountsDigest: string;
};

function capture(
  transaction: Transaction,
  scope: Scope,
  input: typeof StatementContract.PrepareStatementSnapshot.Type,
  boundary: string,
) {
  return Effect.gen(function* () {
    const year = (yield* Db.readStatementFiscalYear(
      transaction,
      scope.bookId,
      input.fiscalYearId,
    ))[0];

    if (year === undefined) return yield* failure("NotFound");
    const base = (yield* Db.readStatementOpeningBase(transaction, scope.bookId, year.id))[0];
    const openingVoucherId = base?.mode === "opening_set" ? (base.openingVoucherId ?? null) : null;

    // A pending opening set has no voucher yet, so the honest representation is the
    // committed prior native balance, and the model says so through its diagnostic.
    const representation =
      openingVoucherId === null
        ? ("prior_native_balance" as const)
        : ("opening_set_voucher" as const);

    const accounts = yield* Db.readStatementAccounts(
      transaction,
      scope.bookId,
      Db.maximumStatementAccounts,
    );

    if (accounts.length > Db.maximumStatementAccounts) {
      return yield* failure("UnsupportedProfile");
    }

    const opening = yield* Db.readStatementOpeningLines(
      transaction,
      scope.bookId,
      year.startsOn,
      boundary,
      openingVoucherId,
      Db.maximumStatementAccounts,
    );

    if (opening.length > Db.maximumStatementAccounts) return yield* failure("UnsupportedProfile");

    const components = yield* Db.readStatementComponents(
      transaction,
      scope.bookId,
      year.startsOn,
      input.asOf,
      boundary,
      openingVoucherId,
      Db.maximumStatementComponents,
    );

    if (components.length > Db.maximumStatementComponents) {
      return yield* failure("UnsupportedProfile");
    }

    const digest = (yield* Db.readStatementAccountsDigest(transaction, scope.bookId))[0]?.digest;

    if (digest === undefined) return yield* failure("InternalError");

    return {
      fiscalYear: year,
      openingBasis: {
        representation,
        basisId: base !== undefined && openingVoucherId !== null ? base.sourcePlanId : year.id,
        openingVoucherId,
        reviewed: false,
      },
      accounts,
      opening,
      components,
      accountsDigest: digest,
    } satisfies CapturedStatement;
  });
}

function statementBasis(
  scope: Scope,
  input: typeof StatementContract.PrepareStatementSnapshot.Type,
  captured: CapturedStatement,
  boundary: string,
  cutoff: string,
  profileVersion: string,
) {
  const roles = new Map(input.mapping.accountRoleRules.map((rule) => [rule.accountId, rule.role]));

  return {
    scope,
    fiscalYear: {
      id: captured.fiscalYear.id,
      startsOn: captured.fiscalYear.startsOn,
      endsOn: captured.fiscalYear.endsOn,
    },
    asOf: input.asOf,
    plInterval: { startsOn: input.plStartsOn, endsOn: input.plEndsOn },
    ledgerBoundary: boundary,
    recordedCutoff: cutoff,
    openingBasis: captured.openingBasis,
    factRevisions: {
      bookProfileVersion: profileVersion,
      bookSequence: boundary,
      fiscalYearId: captured.fiscalYear.id,
      accountsDigest: captured.accountsDigest,
      movementCount: captured.components.length,
    },
    accounts: captured.accounts.map((account) => ({
      accountId: account.id,
      code: account.code,
      name: account.name,
      role: roles.get(account.id) ?? ("excluded" as const),
      version: account.version,
    })),
    opening: captured.opening.map((line) => ({ accountId: line.accountId, minor: line.minor })),
    components: captured.components,
    completeMembership: true,
  } satisfies typeof import("@open-erp/domain/statements").StatementBasis.Type;
}

const mappingRefusals = new Set([
  "DuplicateAccountRole",
  "DuplicateRowId",
  "DuplicateNodeId",
  "ReservedRowId",
  "UnknownMember",
  "MemberCycle",
  "MixedStatementNode",
  "RoleStatementMismatch",
  "MixedBalanceClass",
  "RepeatedRoleDestination",
  "FiscalInterval",
]);

function refusalFor(code: string) {
  if (mappingRefusals.has(code)) return failure("InvalidJournal");

  return code === "ComponentAccountUnmapped" ? failure("InternalError") : unsupported();
}

export const prepareStatementSnapshot = Effect.fn("statements.prepare")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof StatementContract.PrepareStatementSnapshot.Type;
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
        "prepare_statement_snapshot",
        principal.actorId,
        yield* toJsonObject(command.input),
        SnapshotSchema,
      );

      if (request.previous) return request.previous;
      yield* requireStatementAccess(transaction, true);
      yield* exactInputKeys(yield* toJsonObject(command.input));
      const book = (yield* Db.readStatementBook(transaction, command.scope.bookId))[0];

      yield* requireNativeProfile(book);

      if (book === undefined) return yield* failure("NotFound");

      const boundary = book.committedSequence;
      const cutoff = yield* isoNow(transaction);
      const captured = yield* capture(transaction, command.scope, command.input, boundary);

      const basis = statementBasis(
        command.scope,
        command.input,
        captured,
        boundary,
        cutoff,
        book.profileVersion,
      );

      const calculated = calculateStatementModel(command.input.mapping, basis);

      if (Result.isFailure(calculated)) return yield* refusalFor(calculated.failure.code);

      if (calculated.success.rows.length > Db.maximumStatementRows) {
        return yield* unsupported();
      }

      const mapping = yield* toJsonObject(command.input.mapping);
      const checksum = yield* versionedDigest(mapping);
      const id = newId("statement");

      const body = yield* toJsonObject({
        kind: "semantic_statement_v1",
        id,
        scope: command.scope,
        fiscalYear: captured.fiscalYear,
        asOf: command.input.asOf,
        plInterval: { startsOn: command.input.plStartsOn, endsOn: command.input.plEndsOn },
        ledgerBoundary: boundary,
        recordedCutoff: cutoff,
        currency: book.currency,
        currencyScale: book.currencyScale,
        openingBasis: captured.openingBasis,
        factRevisions: basis.factRevisions,
        mappingRelease: { ...mapping, checksum },
        balance: calculated.success.balance,
        coverage: calculated.success.coverage,
        diagnostics: calculated.success.diagnostics,
        calculationNodes: calculated.success.calculationNodes,
        rowCount: calculated.success.rows.length,
        contributionCount: calculated.success.contributions.length,
        noFinancialEffect: calculated.success.outcome.noFinancialEffect,
        createdAt: cutoff,
        receipt: {
          key: command.idempotencyKey,
          operation: "prepare_statement_snapshot",
          actorId: principal.actorId,
        },
      });

      yield* Db.insertStatementSnapshot(transaction, {
        bookId: command.scope.bookId,
        id,
        fiscalYearId: captured.fiscalYear.id,
        asOf: command.input.asOf,
        sequence: BigInt(boundary),
        body,
      });

      yield* Db.insertStatementRows(
        transaction,
        yield* Effect.forEach(calculated.success.rows, (row) =>
          Effect.map(toJsonObject(row), (encoded) => ({
            bookId: command.scope.bookId,
            snapshotId: id,
            ordinal: row.ordinal,
            rowId: row.rowId,
            body: encoded,
          })),
        ),
      );

      if (calculated.success.contributions.length > 0) {
        yield* Db.insertStatementContributions(
          transaction,
          yield* Effect.forEach(calculated.success.contributions, (contribution) =>
            Effect.map(toJsonObject(contribution), (encoded) => ({
              bookId: command.scope.bookId,
              snapshotId: id,
              ordinal: contribution.ordinal,
              rowId: contribution.rowId,
              componentId: contribution.componentId,
              body: encoded,
            })),
          ),
        );
      }

      const result = yield* decode(SnapshotSchema, body);

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_statement_snapshot",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

function childRowIds(body: JsonObject, rowId: string) {
  const nodes = arrayOf(body, "calculationNodes");

  if (nodes === null) return [];

  const found = nodes.find((node) => text(node, "nodeId") === rowId);
  const members = found === undefined ? null : arrayOf(found, "memberRowIds");

  if (members === null) return [];

  return members
    .map((member) => text(member, "rowId"))
    .filter((value): value is string => value !== null);
}

export const getStatementSnapshot = Effect.fn("statements.get")(function* (
  token: string,
  command: {
    scope: Scope;
    snapshotId: string;
    statement?: StatementKind;
    after?: string;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireStatementAccess(transaction, false);

    const stored = (yield* Db.readStatementSnapshot(
      transaction,
      command.scope.bookId,
      command.snapshotId,
    ))[0];

    if (stored === undefined) return yield* failure("NotFound");
    const snapshot = yield* decode(SnapshotSchema, stored.body);
    const cursor = ordinalAnchor(command.after);

    if (cursor === null) return yield* failure("InvalidJournal");
    yield* requireRowAnchor(transaction, command.scope.bookId, command.snapshotId, cursor.ordinal);

    const page = (yield* Db.readStatementRowPage(
      transaction,
      command.scope.bookId,
      command.snapshotId,
      command.statement ?? null,
      cursor.ordinal,
      Db.statementSnapshotPageSize,
    ))[0];

    if (page === undefined) return yield* failure("InternalError");
    const items = arrayOf(page.items, "items");

    if (items === null) return yield* failure("InternalError");

    const live = (yield* Db.readStatementLiveStatus(
      transaction,
      command.scope.bookId,
      snapshot.ledgerBoundary,
      snapshot.asOf,
      snapshot.createdAt,
    ))[0];

    if (live === undefined) return yield* failure("InternalError");
    const postingsAfterCutoff = Number(live.postingsAfterCutoff);

    return yield* decode(PageSchema, {
      snapshot,
      live: {
        checkedAt: yield* isoNow(transaction),
        bookSequence: live.committedSequence,
        postingsAfterCutoff,
        invalidatedByReopen: live.reopenedAfterCapture,
        currentForCurrentBooks: postingsAfterCutoff === 0 && !live.reopenedAfterCapture,
      },
      order: "retained_row_ordinal",
      statementFilter: command.statement ?? null,
      total: snapshot.rowCount,
      items: yield* Effect.forEach(items, (row) => decode(RowSchema, row)),
      next:
        page.nextOrdinal === null
          ? null
          : `${command.snapshotId}:${BigInt(page.nextOrdinal).toString()}`,
    });
  });
});

export const explainStatementRow = Effect.fn("statements.explain")(function* (
  token: string,
  command: { scope: Scope; snapshotId: string; rowId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireStatementAccess(transaction, false);

    const stored = (yield* Db.readStatementSnapshot(
      transaction,
      command.scope.bookId,
      command.snapshotId,
    ))[0];

    if (stored === undefined) return yield* failure("NotFound");

    const saved = (yield* Db.readStatementRow(
      transaction,
      command.scope.bookId,
      command.snapshotId,
      command.rowId,
    ))[0];

    if (saved === undefined) return yield* failure("NotFound");
    const row = yield* decode(RowSchema, saved.body);
    const cursor = ordinalAnchor(command.after);

    if (cursor === null) return yield* failure("InvalidJournal");

    if (row.kind === "leaf") {
      yield* requireContributionAnchor(
        transaction,
        command.scope.bookId,
        command.snapshotId,
        row.rowId,
        cursor.ordinal,
      );

      const total = (yield* Db.countStatementContributions(
        transaction,
        command.scope.bookId,
        command.snapshotId,
        row.rowId,
      ))[0];

      if (total === undefined) return yield* failure("InternalError");

      const rows = yield* Db.readStatementContributionPage(
        transaction,
        command.scope.bookId,
        command.snapshotId,
        row.rowId,
        cursor.ordinal,
        Db.statementContributionPageSize + 1,
      );

      const page = rows.slice(0, Db.statementContributionPageSize);
      const last = page[page.length - 1];

      return yield* decode(ExplanationSchema, {
        snapshotId: command.snapshotId,
        row,
        kind: "frozen_contributions",
        movementFormula: "signed = debits - credits",
        amountFormula: "amount = closing * presentation sign",
        totalContributions: Number(total.total),
        items: yield* Effect.forEach(page, (item) => decode(ContributionSchema, item.body)),
        childRowIds: [],
        next:
          rows.length > Db.statementContributionPageSize && last !== undefined
            ? `${command.snapshotId}:${last.ordinal}`
            : null,
      });
    }

    const children = yield* Effect.gen(function* () {
      if (row.kind !== "computed") return childRowIds(stored.body, row.rowId);

      return (yield* Db.listStatementRowIds(
        transaction,
        command.scope.bookId,
        command.snapshotId,
        "profit_and_loss",
        Db.maximumStatementRows,
      )).map((child) => child.rowId);
    });

    return yield* decode(ExplanationSchema, {
      snapshotId: command.snapshotId,
      row,
      kind: "calculated_children",
      movementFormula: "signed = debits - credits",
      amountFormula: "amount = closing * presentation sign",
      totalContributions: 0,
      items: [],
      childRowIds: children,
      next: null,
    });
  });
});

function subtract(right: string, left: string) {
  return (BigInt(right) - BigInt(left)).toString();
}

function presenceOf(left: JsonObject | null, right: JsonObject | null) {
  if (left === null) return "right_only" as const;

  return right === null ? ("left_only" as const) : ("both" as const);
}

function classificationChanged(left: JsonObject, right: JsonObject) {
  return (
    text(left, "statement") !== text(right, "statement") ||
    text(left, "balanceClass") !== text(right, "balanceClass") ||
    JSON.stringify(left.contributionRoles ?? []) !== JSON.stringify(right.contributionRoles ?? [])
  );
}

export const compareStatementSnapshots = Effect.fn("statements.compare")(function* (
  token: string,
  command: { scope: Scope; snapshotId: string; otherId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireStatementAccess(transaction, false);

    const left = (yield* Db.readStatementSnapshot(
      transaction,
      command.scope.bookId,
      command.snapshotId,
    ))[0];

    const right = (yield* Db.readStatementSnapshot(
      transaction,
      command.scope.bookId,
      command.otherId,
    ))[0];

    if (left === undefined || right === undefined) return yield* failure("NotFound");
    const leftSnapshot = yield* decode(SnapshotSchema, left.body);
    const rightSnapshot = yield* decode(SnapshotSchema, right.body);

    if (
      leftSnapshot.currency !== rightSnapshot.currency ||
      leftSnapshot.currencyScale !== rightSnapshot.currencyScale
    ) {
      return yield* unsupported();
    }

    const cursor = rowAnchor(command.after);

    if (cursor === null) return yield* failure("InvalidJournal");

    if (
      cursor.rowId !== "" &&
      (yield* Db.readStatementRowIdentity(
        transaction,
        command.scope.bookId,
        command.snapshotId,
        command.otherId,
        cursor.rowId,
      )).length === 0
    ) {
      return yield* failure("NotFound");
    }

    const page = (yield* Db.readStatementComparisonPage(
      transaction,
      command.scope.bookId,
      command.snapshotId,
      command.otherId,
      cursor.rowId,
      Db.statementSnapshotPageSize,
    ))[0];

    if (page === undefined) return yield* failure("InternalError");
    const raw = arrayOf(page.items, "items");

    if (raw === null) return yield* failure("InternalError");

    const items = yield* Effect.forEach(raw, (entry) =>
      Effect.gen(function* () {
        const leftRow = objectOf(entry, "left");
        const rightRow = objectOf(entry, "right");
        const rowId = text(entry, "rowId");

        if (rowId === null) return yield* failure("InternalError");

        const left = leftRow === null ? Effect.succeed(null) : decode(RowSchema, leftRow);
        const right = rightRow === null ? Effect.succeed(null) : decode(RowSchema, rightRow);
        const decodedLeft = yield* left;
        const decodedRight = yield* right;

        return {
          rowId,
          presence: presenceOf(leftRow, rightRow),
          left: decodedLeft,
          right: decodedRight,
          classificationChanged:
            leftRow === null || rightRow === null ? null : classificationChanged(leftRow, rightRow),
          difference:
            leftRow === null || rightRow === null
              ? null
              : {
                  amountMinor: subtract(
                    text(rightRow, "amountMinor") ?? "0",
                    text(leftRow, "amountMinor") ?? "0",
                  ),
                  closingMinor: subtract(
                    text(rightRow, "closingMinor") ?? "0",
                    text(leftRow, "closingMinor") ?? "0",
                  ),
                },
        };
      }),
    );

    const leftDigest = (yield* Db.digestStatementSnapshot(
      transaction,
      command.scope.bookId,
      command.snapshotId,
    ))[0]?.digest;

    const rightDigest = (yield* Db.digestStatementSnapshot(
      transaction,
      command.scope.bookId,
      command.otherId,
    ))[0]?.digest;

    if (leftDigest === undefined || rightDigest === undefined) {
      return yield* failure("InternalError");
    }

    const leftTotals = (yield* Db.readStatementComparisonTotals(
      transaction,
      command.scope.bookId,
      command.snapshotId,
      command.otherId,
    ))[0];

    const rightTotals = (yield* Db.readStatementComparisonTotals(
      transaction,
      command.scope.bookId,
      command.otherId,
      command.snapshotId,
    ))[0];

    if (leftTotals === undefined || rightTotals === undefined) {
      return yield* failure("InternalError");
    }

    const sameRowSet = leftTotals.leftOnlyRows === "0" && leftTotals.rightOnlyRows === "0";

    return yield* decode(ComparisonSchema, {
      left: { snapshot: leftSnapshot, digest: leftDigest },
      right: { snapshot: rightSnapshot, digest: rightDigest },
      mode: "own_mapping_with_classification_change_display",
      order: "row_identity",
      differenceFormula: "difference = right - left",
      sameCurrencyUnit: true,
      sameMapping: leftSnapshot.mappingRelease.checksum === rightSnapshot.mappingRelease.checksum,
      total: Number(page.total),
      totals: {
        left: {
          amountMinor: leftTotals.amountMinor,
          closingMinor: leftTotals.closingMinor,
        },
        right: {
          amountMinor: rightTotals.amountMinor,
          closingMinor: rightTotals.closingMinor,
        },
        difference: sameRowSet
          ? {
              amountMinor: subtract(rightTotals.amountMinor, leftTotals.amountMinor),
              closingMinor: subtract(rightTotals.closingMinor, leftTotals.closingMinor),
            }
          : null,
      },
      items,
      next: page.nextRowId === null ? null : `${command.snapshotId}:${page.nextRowId}`,
      warnings: [
        "Each side keeps its own saved mapping and row identity. A changed classification is displayed, never edited to make the graphs agree.",
        "Differences are right minus left in the shared currency unit. A missing side is null, never zero.",
        "Totals cover the whole retained row set on both sides. The difference is null when the two snapshots do not retain the same row identities.",
        "Neither snapshot establishes a company profile, a reviewed opening or statutory comparability.",
      ],
    });
  });
});

export const listStatementSnapshots = Effect.fn("statements.list")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireStatementAccess(transaction, false);
    const after = command.after ?? "";

    if (after !== "" && !identifier.test(after)) return yield* failure("InvalidJournal");

    const rows = yield* Db.listStatementSnapshots(
      transaction,
      command.scope.bookId,
      after,
      Db.statementSnapshotListPageSize + 1,
    );

    const page = rows.slice(0, Db.statementSnapshotListPageSize);
    const last = page[page.length - 1];

    return yield* decode(ListSchema, {
      items: yield* Effect.forEach(page, (row) => decode(SnapshotSchema, row.body)),
      next: rows.length > Db.statementSnapshotListPageSize ? (last?.id ?? null) : null,
    });
  });
});
