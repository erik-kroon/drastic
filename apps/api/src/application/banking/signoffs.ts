import * as Accounting from "@open-erp/contracts/accounting";
import * as Signoffs from "@open-erp/contracts/bank-signoffs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import * as SignoffDb from "../../db/banking/signoffs";
import * as BankDb from "../../db/banking/shared";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;

const PlanSchema = Signoffs.BankSignoffPlan;
const SignoffSchema = Signoffs.BankReconciliationSignoff;
const ViewSchema = Signoffs.BankSignoffView;
const ListSchema = Signoffs.BankSignoffList;

const signoffTables = [
  "books",
  "accounts",
  "closing_inventories",
  "bank_source_coverage_reports",
  "bank_capacity_reconciliations",
  "bank_signoff_plans",
  "evidence",
  "command_receipts",
  "vouchers",
  "journal_lines",
];
const signoffInserts = ["bank_signoff_plans", "evidence", "command_receipts"];

function coverageAccountIsComplete(account: JsonObject, coverage: JsonObject) {
  const families = Shared.arrayField(Shared.objectField(coverage, "inventory"), "families");
  return (
    account.declared === true &&
    account.active === true &&
    account.hasReviewGaps === false &&
    Shared.isEmptyJsonArray(coverage.diagnostics) &&
    families.some(
      (family) =>
        Shared.textField(family, "family") === "bank_sources" &&
        Shared.textField(family, "status") === "required",
    )
  );
}

function resolutionIsComplete(report: JsonObject, account: JsonObject) {
  return (
    Shared.textField(report, "schemaVersion") === "bank-capacity-v2" &&
    Shared.textField(report, "status") === "complete" &&
    report.sourceCoverageComplete === true &&
    Shared.isEmptyJsonArray(report.unmatchedSource) &&
    Shared.isEmptyJsonArray(report.unmatchedLedger) &&
    Shared.isEmptyJsonArray(report.differences) &&
    Shared.isEmptyJsonArray(report.coverageGaps) &&
    Shared.textField(report, "openingDifferenceMinor") === "0" &&
    Shared.textField(report, "closingDifferenceMinor") === "0" &&
    Shared.textField(report, "bankOpeningMinor") === Shared.textField(account, "openingMinor") &&
    Shared.textField(report, "bankClosingMinor") === Shared.textField(account, "closingMinor")
  );
}

export function signoffDependenciesCurrent(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  plan: typeof Signoffs.BankSignoffPlan.Type,
) {
  return Effect.gen(function* () {
    const digestRows = yield* BankDb.readCoverageDependencyDigest(
      transaction,
      bookId,
      plan.basis.inventoryId,
    );
    if (digestRows[0]?.digest !== plan.basis.dependencyDigest) return false;
    const account = yield* BankDb.readAccount(transaction, bookId, plan.accountId);
    return account[0]?.active === true;
  });
}

function readPlan(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  planId: string,
) {
  return Effect.gen(function* () {
    const rows = yield* SignoffDb.readSignoffPlan(transaction, bookId, planId);
    const row = rows[0];
    if (!row) return yield* failure("NotFound");
    return yield* Shared.decode(PlanSchema, row.body);
  });
}

function readBook(transaction: import("../../db/transaction").Transaction, scope: Scope) {
  return BankDb.lockBook(transaction, scope.bookId, "update").pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];
      return book ? Effect.succeed(book) : failure("Forbidden");
    }),
  );
}

export const prepareBankSignoff = Effect.fn("banking.signoff.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Signoffs.PrepareBankSignoff.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, signoffTables, signoffInserts);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* readBook(transaction, command.scope);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_bank_signoff",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        PlanSchema,
      );
      if (request.previous) return request.previous;
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);
      if (
        !Shared.identifierPattern.test(command.input.coverageReportId) ||
        !Shared.identifierPattern.test(command.input.reconciliationId)
      ) {
        return yield* failure("InvalidJournal");
      }

      const coverage = (yield* SignoffDb.readCoverage(
        transaction,
        command.scope.bookId,
        command.input.coverageReportId,
      ))[0];
      if (!coverage) return yield* failure("NotFound");
      const report = (yield* SignoffDb.readCapacityReconciliation(
        transaction,
        command.scope.bookId,
        command.input.reconciliationId,
      ))[0];
      if (!report) return yield* failure("NotFound");
      if (
        (yield* SignoffDb.readSignoffPlanCount(transaction, command.scope.bookId))[0]!.total >= 200
      ) {
        return yield* Shared.unsupported();
      }

      const dependencyDigest = (yield* BankDb.readCoverageDependencyDigest(
        transaction,
        command.scope.bookId,
        coverage.inventoryId,
      ))[0]?.digest;
      if (dependencyDigest === undefined || dependencyDigest === null) {
        return yield* Shared.unsupported();
      }
      if (dependencyDigest !== Shared.textField(coverage.body, "dependencyDigest")) {
        return yield* failure("StaleDependency");
      }

      const accountCandidate = Shared.arrayField(coverage.body, "accounts").find(
        (candidate) => Shared.textField(candidate, "accountId") === report.accountId,
      );
      if (
        !Shared.isJsonObject(accountCandidate) ||
        !coverageAccountIsComplete(accountCandidate, coverage.body)
      ) {
        return yield* failure("InvalidJournal");
      }
      const account = accountCandidate;

      const startsOn = Shared.textField(report.body, "startsOn");
      const endsOn = Shared.textField(report.body, "endsOn");
      if (startsOn === undefined || endsOn === undefined) return yield* failure("StaleDependency");
      const accountSequence =
        (yield* SignoffDb.readAccountLedgerSequence(
          transaction,
          command.scope.bookId,
          report.accountId,
          endsOn,
        ))[0]?.sequence ?? "0";
      const coverageInput = Shared.objectField(coverage.body, "input");
      const checkpoint = Shared.objectField(report.body, "checkpoint");
      if (
        startsOn !== Shared.textField(coverageInput, "startsOn") ||
        endsOn !== Shared.textField(coverageInput, "endsOn") ||
        Shared.textField(report.body, "currency") !== book.currency ||
        report.body.currencyScale !== book.currencyScale ||
        Shared.textField(checkpoint, "sequence") !== Shared.textField(coverage.body, "sequence") ||
        Shared.textField(checkpoint, "sourceRevision") !==
          Shared.textField(account, "sourceRevision") ||
        Shared.textField(report.body, "accountLedgerSequence") !== accountSequence
      ) {
        return yield* failure("StaleDependency");
      }
      if (!resolutionIsComplete(report.body, account)) return yield* failure("InvalidJournal");

      const statementBasis = Shared.arrayField(account, "statements")
        .map((statement) => Shared.objectField(statement, "statement"))
        .sort((left, right) =>
          (Shared.textField(left, "id") ?? "") < (Shared.textField(right, "id") ?? "") ? -1 : 1,
        );
      const reportStatements = Shared.arrayField(report.body, "statements")
        .filter(Shared.isJsonObject)
        .sort((left, right) => ((left.id ?? "") < (right.id ?? "") ? -1 : 1));
      const statementDigestSource = yield* Shared.toJsonObject({ statements: statementBasis });
      if (!Shared.sameJson(statementBasis, reportStatements)) {
        return yield* failure("StaleDependency");
      }

      const inventory = Shared.objectField(coverage.body, "inventory");
      const body = Object.assign(
        {},
        {
          id: newId("banksignoff"),
          version: 1,
          scope: command.scope,
          input: command.input,
          accountId: report.accountId,
          startsOn,
          endsOn,
          currency: book.currency,
          currencyScale: book.currencyScale,
          basis: {
            inventoryId: coverage.inventoryId,
            inventoryDigest: yield* digest(inventory),
            coverageDigest: Shared.textField(coverage.body, "digest") ?? "",
            reconciliationDigest: yield* digest(report.body),
            statementDigest: yield* digest(statementDigestSource),
            allocationDigest: yield* digest({
              matches: report.body.matches ?? null,
              allocations: report.body.allocations ?? null,
            }),
            dependencyDigest,
            sourceRevision: Shared.textField(account, "sourceRevision") ?? "0",
            ledgerSequence: book.committedSequence,
            accountLedgerSequence: accountSequence,
            checkVersion: "bank_signoff_v1",
          } satisfies JsonObject,
          reviewScope: "selected_declared_bank_account",
          coverage: "not_established",
          financialCloseReady: false,
          createdAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "prepare_bank_signoff",
            principal.actorId,
          ),
        },
      ) satisfies JsonObject;
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      const plan = yield* Shared.decode(PlanSchema, sealed);
      yield* SignoffDb.insertSignoffPlan(transaction, {
        bookId: command.scope.bookId,
        id: plan.id,
        coverageReportId: coverage.id,
        reconciliationId: report.id,
        body: sealed,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_bank_signoff",
        principal.actorId,
        yield* Shared.toJsonObject(plan),
      );
      return plan;
    }),
  );
});

export const signBankReconciliation = Effect.fn("banking.signoff.sign")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Signoffs.SignBankReconciliation.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, signoffTables, [
        ...signoffInserts,
        "bank_reconciliation_signoffs",
      ]);
      const book = yield* readBook(transaction, command.scope);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "sign_bank_reconciliation",
        principal.actorId,
        {
          planId: command.planId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        SignoffSchema,
      );
      if (request.previous) return request.previous;

      const stored = (yield* SignoffDb.readSignoffPlan(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      if (!stored) return yield* failure("NotFound");
      if (command.input.digest !== stored.body.digest) return yield* failure("StaleDependency");

      const existing = (yield* SignoffDb.readReconciliationSignoff(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      if (existing) {
        const retained = yield* Shared.toJsonObject(
          Object.fromEntries(
            Object.entries(existing.body).filter(
              ([key]) =>
                !["planId", "evidenceSha256", "actorId", "signedAt", "receipt"].includes(key),
            ),
          ),
        );
        if (
          Shared.textField(existing.body, "actorId") !== principal.actorId ||
          !Shared.sameJson(retained, yield* Shared.toJsonObject(command.input))
        ) {
          return yield* failure("IdempotencyConflict");
        }
        const recovered = yield* Shared.decode(SignoffSchema, existing.body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "sign_bank_reconciliation",
          principal.actorId,
          yield* Shared.toJsonObject(recovered),
        );
        return recovered;
      }

      yield* Shared.requireNativeBankProfile(book.profile, book.authority);
      const plan = yield* Shared.decode(PlanSchema, stored.body);
      if (!(yield* signoffDependenciesCurrent(transaction, command.scope.bookId, plan))) {
        return yield* failure("StaleDependency");
      }
      const source = (yield* BankDb.readEvidence(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      ))[0];
      if (!source) return yield* failure("MissingEvidence");

      const body = Object.assign({}, command.input, {
        planId: command.planId,
        evidenceSha256: source.sha256,
        actorId: principal.actorId,
        signedAt: yield* isoNow(transaction),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "sign_bank_reconciliation",
          principal.actorId,
        ),
      }) satisfies JsonObject;
      const content = yield* Shared.canonicalText({ plan: stored.body, signoff: body });
      const length = Shared.byteLength(content);
      if (length > 1048576) return yield* Shared.unsupported();
      yield* SignoffDb.insertReconciliationSignoff(transaction, {
        bookId: command.scope.bookId,
        planId: command.planId,
        evidenceId: source.id,
        body,
        content,
        sha256: yield* sha256Hex(content),
        byteLength: length,
      });
      const signoff = yield* Shared.decode(SignoffSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "sign_bank_reconciliation",
        principal.actorId,
        yield* Shared.toJsonObject(signoff),
      );
      return signoff;
    }),
  );
});

export const getBankSignoff = Effect.fn("banking.signoff.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly planId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, signoffTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const plan = yield* readPlan(transaction, command.scope.bookId, command.planId);
      const signed = (yield* SignoffDb.readReconciliationSignoff(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      return yield* Shared.decode(ViewSchema, {
        plan,
        signoff: signed ? yield* Shared.decode(SignoffSchema, signed.body) : null,
        dependenciesCurrent: yield* signoffDependenciesCurrent(
          transaction,
          command.scope.bookId,
          plan,
        ),
        artifact: signed
          ? {
              content: signed.content,
              sha256: signed.sha256,
              byteLength: signed.byteLength,
              mediaType: "application/json",
            }
          : null,
      });
    }),
  );
});

export const listBankSignoffs = Effect.fn("banking.signoff.list")(function* (
  token: string,
  command: { readonly scope: Scope },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, signoffTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const rows = yield* SignoffDb.listSignoffPlans(transaction, command.scope.bookId);
      return yield* Shared.decode(ListSchema, {
        scope: command.scope,
        items: rows.map((row) => ({
          id: row.body.id ?? "",
          accountId: row.body.accountId ?? "",
          startsOn: row.body.startsOn ?? "",
          endsOn: row.body.endsOn ?? "",
          createdAt: row.body.createdAt ?? "",
          digest: row.body.digest ?? "",
          signedAt: row.signedAt,
        })),
      });
    }),
  );
});
