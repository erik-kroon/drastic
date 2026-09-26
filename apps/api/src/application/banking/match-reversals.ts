import * as Accounting from "@open-erp/contracts/accounting";
import * as Reversal from "@open-erp/contracts/bank-match-reversals";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import * as AllocationDb from "../../db/banking/allocations";
import * as ReversalDb from "../../db/banking/match-reversals";
import * as BankDb from "../../db/banking/shared";
import type { Transaction } from "../../db/transaction";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;
type Json = Schema.Json;
type JsonObject = Schema.JsonObject;
type FailureCode = typeof Accounting.FailureCode.Type;

const PlanSchema = Reversal.BankMatchReversalPlan;
const ApprovalSchema = Reversal.BankMatchReversalApproval;
const RevocationSchema = Reversal.BankMatchReversalRevocation;
const ExecutionSchema = Reversal.BankMatchReversalExecution;
const ViewSchema = Reversal.BankMatchReversalView;
const ListSchema = Reversal.BankMatchReversalList;

const reversalTables = [
  "books",
  "accounts",
  "bank_sources",
  "periods",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "bank_allocation_plans",
  "bank_allocation_executions",
  "bank_match_reversal_plans",
  "bank_match_reversal_approvals",
  "bank_match_reversal_revocations",
  "bank_match_reversals",
  "memberships",
  "vouchers",
  "journal_lines",
  "evidence",
  "command_receipts",
];
const approvalWindowMs = 60 * 60 * 1000;
const maximumLegs = 100;
const pageSize = 25;
const exhaustedRevision = 9223372036854775807n;

function lockBook(transaction: Transaction, bookId: string) {
  return BankDb.lockBook(transaction, bookId, "update").pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];
      return book ? Effect.succeed(book) : failure("Forbidden");
    }),
  );
}

function readPlan(transaction: Transaction, bookId: string, planId: string) {
  return ReversalDb.readReversalPlan(transaction, bookId, planId).pipe(
    Effect.flatMap((rows) => {
      const plan = rows[0];
      return plan ? Effect.succeed(plan) : failure("NotFound");
    }),
  );
}

function readReversalTarget(transaction: Transaction, bookId: string, target: JsonObject) {
  return Effect.gen(function* () {
    const kind = Shared.textField(target, "kind");
    if (kind === "allocation") {
      const allocationPlanId = Shared.textField(target, "allocationPlanId");
      if (allocationPlanId === undefined) return yield* failure("InvalidJournal");
      const row = (yield* ReversalDb.readAllocationTarget(
        transaction,
        bookId,
        allocationPlanId,
      ))[0];
      if (!row?.accountId) return yield* failure("NotFound");
      if (row.legCount < 1 || row.legCount > maximumLegs) return yield* Shared.unsupported();
      return { accountId: row.accountId, original: row.original ?? {}, legs: row.legs };
    }
    if (kind === "exact_match") {
      const statementId = Shared.textField(target, "statementId");
      const rowOrdinal = Shared.numberField(target, "rowOrdinal");
      if (statementId === undefined || rowOrdinal === undefined) {
        return yield* failure("InvalidJournal");
      }
      if (!Number.isSafeInteger(rowOrdinal) || rowOrdinal < 1 || rowOrdinal > 10000) {
        return yield* failure("InvalidJournal");
      }
      const row = (yield* ReversalDb.readExactMatchTarget(
        transaction,
        bookId,
        statementId,
        rowOrdinal,
      ))[0];
      if (!row?.accountId) return yield* failure("NotFound");
      return { accountId: row.accountId, original: row.original ?? {}, legs: row.legs };
    }
    return yield* Shared.unsupported();
  });
}

function reversalSnapshot(
  transaction: Transaction,
  bookId: string,
  accountId: string,
  original: JsonObject,
  legs: Json,
) {
  return Effect.gen(function* () {
    if (
      (yield* ReversalDb.readReversedVoucherPresence(transaction, bookId, legs))[0]?.present ===
      true
    ) {
      return yield* Shared.unsupported();
    }
    const captured = (yield* ReversalDb.readReversalDates(transaction, bookId, legs))[0];
    for (const entry of Shared.arrayField(captured?.dates ?? null, "date")) {
      if (Shared.numberField(entry, "periodCount") !== 1) return yield* Shared.unsupported();
      if (Shared.booleanField(entry, "locked") === true) return yield* failure("PeriodLocked");
    }
    const versions = (yield* BankDb.readVersions(transaction, bookId, accountId))[0]?.versions;
    if (versions === undefined) return yield* failure("StaleDependency");
    return Object.assign(
      {},
      {
        accountId,
        original,
        legs,
        periods: captured?.periods ?? null,
        versions,
        capacities: captured?.capacities ?? null,
      },
    ) satisfies JsonObject;
  });
}

const toleratedSnapshotFailures: ReadonlyArray<FailureCode> = [
  "StaleDependency",
  "PeriodLocked",
  "UnsupportedProfile",
  "NotFound",
];

function currentReversalSnapshot(transaction: Transaction, bookId: string, planBody: JsonObject) {
  return Effect.gen(function* () {
    const snapshot = Shared.objectField(planBody, "snapshot");
    const accountId = Shared.textField(snapshot, "accountId");
    if (accountId === undefined) return yield* failure("InternalError");
    const plan = yield* Shared.decode(PlanSchema, planBody);
    return yield* reversalSnapshot(
      transaction,
      bookId,
      accountId,
      Shared.objectField(snapshot, "original"),
      yield* Shared.toJsonObject(plan.snapshot.legs),
    );
  });
}

// A read reports staleness; it never fails a review that is merely out of date.
function snapshotIsCurrent(transaction: Transaction, bookId: string, planBody: JsonObject) {
  return currentReversalSnapshot(transaction, bookId, planBody).pipe(
    Effect.flatMap((current) =>
      Shared.sameCanonical(current, Shared.objectField(planBody, "snapshot")),
    ),
    Effect.catchIf(
      (error) =>
        error instanceof Accounting.AccountingError &&
        toleratedSnapshotFailures.includes(error.code),
      () => Effect.succeed(false),
    ),
  );
}

export const prepareBankMatchReversal = Effect.fn("banking.reversal.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Reversal.PrepareBankMatchReversal.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, reversalTables, [
        "bank_match_reversal_plans",
        "command_receipts",
      ]);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* lockBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_bank_match_reversal",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        PlanSchema,
      );
      if (request.previous) return request.previous;
      if (command.input.reason.trim().length === 0) return yield* failure("InvalidJournal");

      const target = yield* Shared.toJsonObject(command.input.target);
      const found = yield* readReversalTarget(transaction, command.scope.bookId, target);
      const targetKey = yield* digest(target);
      if (
        (yield* ReversalDb.readReversedTarget(transaction, command.scope.bookId, targetKey))[0]
          ?.present === true
      ) {
        return yield* failure("StaleDependency");
      }
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);
      const snapshot = yield* reversalSnapshot(
        transaction,
        command.scope.bookId,
        found.accountId,
        found.original,
        found.legs,
      );

      const body = Object.assign({}, {
        id: newId("bankunmatch"),
        version: 1,
        scope: command.scope,
        input: yield* Shared.toJsonObject(command.input),
        snapshot: yield* Shared.toJsonObject(snapshot),
        currency: book.currency,
        currencyScale: book.currencyScale,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
      } satisfies JsonObject);
      const sealed = Object.assign({}, body, { digest: yield* digest(body) });
      const plan = yield* Shared.decode(PlanSchema, sealed);
      yield* ReversalDb.insertReversalPlan(transaction, {
        bookId: command.scope.bookId,
        id: plan.id,
        targetKey,
        body: sealed,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_bank_match_reversal",
        principal.actorId,
        yield* Shared.toJsonObject(plan),
      );
      return plan;
    }),
  );
});

export const approveBankMatchReversal = Effect.fn("banking.reversal.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Reversal.ApproveBankMatchReversal.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, reversalTables, [
        "bank_match_reversal_approvals",
        "command_receipts",
      ]);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* lockBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "approve_bank_match_reversal",
        principal.actorId,
        {
          planId: command.planId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        ApprovalSchema,
      );
      if (request.previous) return request.previous;

      const plan = yield* readPlan(transaction, command.scope.bookId, command.planId);
      if (command.input.digest !== Shared.textField(plan.body, "digest")) {
        return yield* failure("StaleDependency");
      }
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);

      const snapshot = yield* currentReversalSnapshot(transaction, command.scope.bookId, plan.body);
      if (!(yield* Shared.sameCanonical(snapshot, Shared.objectField(plan.body, "snapshot")))) {
        return yield* failure("StaleDependency");
      }

      const now = (yield* ReversalDb.readDatabaseTime(transaction))[0]?.now;
      if (now === undefined) return yield* failure("InternalError");
      const body = yield* Shared.toJsonObject(
        Object.assign({}, command.input, {
          id: newId("unmatchapproval"),
          planId: command.planId,
          actorId: principal.actorId,
          expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "approve_bank_match_reversal",
            principal.actorId,
          ),
        }),
      );
      const approvalId = Shared.textField(body, "id");
      const expiresAt = Shared.textField(body, "expiresAt");
      if (approvalId === undefined || expiresAt === undefined) {
        return yield* failure("InternalError");
      }
      yield* ReversalDb.insertReversalApproval(transaction, {
        bookId: command.scope.bookId,
        id: approvalId,
        planId: command.planId,
        actorId: principal.actorId,
        expiresAt,
        body,
      });
      const approval = yield* Shared.decode(ApprovalSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "approve_bank_match_reversal",
        principal.actorId,
        yield* Shared.toJsonObject(approval),
      );
      return approval;
    }),
  );
});

export const revokeBankMatchReversalApproval = Effect.fn("banking.reversal.revokeApproval")(
  function* (
    token: string,
    command: {
      readonly scope: Scope;
      readonly approvalId: string;
      readonly idempotencyKey: string;
      readonly input: typeof Reversal.RevokeBankMatchReversalApproval.Type;
    },
  ) {
    return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
      Effect.gen(function* () {
        yield* Shared.requireTables(transaction, reversalTables, [
          "bank_match_reversal_revocations",
          "command_receipts",
        ]);
        yield* lockBook(transaction, command.scope.bookId);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "revoke_bank_match_reversal_approval",
          principal.actorId,
          {
            approvalId: command.approvalId,
            input: yield* Shared.toJsonObject(command.input),
          } satisfies JsonObject,
          RevocationSchema,
        );
        if (request.previous) return request.previous;
        if (command.input.reason.trim().length === 0) return yield* failure("InvalidJournal");

        if (
          (yield* ReversalDb.readReversalApproval(
            transaction,
            command.scope.bookId,
            command.approvalId,
          )).length === 0
        ) {
          return yield* failure("NotFound");
        }
        const state = (yield* ReversalDb.readApprovalState(
          transaction,
          command.scope.bookId,
          command.approvalId,
        ))[0]?.state;
        if (state !== null && state !== undefined) return yield* failure("ApprovalRequired");

        const body = yield* Shared.toJsonObject({
          approvalId: command.approvalId,
          reason: command.input.reason,
          actorId: principal.actorId,
          revokedAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "revoke_bank_match_reversal_approval",
            principal.actorId,
          ),
        });
        yield* ReversalDb.insertReversalRevocation(
          transaction,
          command.scope.bookId,
          command.approvalId,
          body,
        );
        const revocation = yield* Shared.decode(RevocationSchema, body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "revoke_bank_match_reversal_approval",
          principal.actorId,
          yield* Shared.toJsonObject(revocation),
        );
        return revocation;
      }),
    );
  },
);

export const executeBankMatchReversal = Effect.fn("banking.reversal.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Reversal.ExecuteBankMatchReversal.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        reversalTables,
        ["bank_match_reversals", "command_receipts"],
        ["bank_sources"],
      );
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = yield* lockBook(transaction, command.scope.bookId);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "execute_bank_match_reversal",
        principal.actorId,
        {
          planId: command.planId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        ExecutionSchema,
      );
      if (request.previous) return request.previous;

      const plan = yield* readPlan(transaction, command.scope.bookId, command.planId);
      if (command.input.digest !== Shared.textField(plan.body, "digest")) {
        return yield* failure("StaleDependency");
      }
      const storedSnapshot = Shared.objectField(plan.body, "snapshot");
      const accountId = Shared.textField(storedSnapshot, "accountId");
      if (accountId === undefined) return yield* failure("InternalError");

      const committed = (yield* ReversalDb.readReversalExecution(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      if (committed) {
        if (Shared.textField(committed.body, "approvalId") !== command.input.approvalId) {
          return yield* failure("ApprovalRequired");
        }
        const recovered = yield* Shared.decode(ExecutionSchema, committed.body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "execute_bank_match_reversal",
          principal.actorId,
          yield* Shared.toJsonObject(recovered),
        );
        return recovered;
      }

      yield* Shared.requireNativeBankProfile(book.profile, book.authority);
      const current = yield* currentReversalSnapshot(transaction, command.scope.bookId, plan.body);
      if (!(yield* Shared.sameCanonical(current, storedSnapshot))) {
        return yield* failure("StaleDependency");
      }

      const now = (yield* ReversalDb.readDatabaseTime(transaction))[0]?.now;
      if (now === undefined) return yield* failure("InternalError");
      const approval = (yield* ReversalDb.readReversalApprovalForExecution(
        transaction,
        command.scope.bookId,
        command.planId,
        command.input.approvalId,
      ))[0];
      const state = (yield* ReversalDb.readApprovalState(
        transaction,
        command.scope.bookId,
        command.input.approvalId,
      ))[0]?.state;
      if (!approval || Date.parse(approval.expiresAt) <= Date.parse(now) || state !== null) {
        return yield* failure("ApprovalRequired");
      }
      if (
        (yield* AllocationDb.readOperatorMembership(
          transaction,
          command.scope.bookId,
          approval.actorId,
        ))[0]?.present !== true
      ) {
        return yield* failure("ApprovalRequired");
      }

      const revision = (yield* BankDb.lockSourceRevision(
        transaction,
        command.scope.bookId,
        accountId,
      ))[0]?.revision;
      const currentRevision = Shared.minor(revision);
      if (currentRevision === undefined) return yield* failure("NotFound");
      if (currentRevision === exhaustedRevision) return yield* Shared.unsupported();

      const target = Shared.objectField(Shared.objectField(plan.body, "input"), "target");
      const body = yield* Shared.toJsonObject({
        planId: command.planId,
        digest: command.input.digest,
        version: 1,
        approvalId: approval.id,
        scope: command.scope,
        target,
        reason: Shared.textField(Shared.objectField(plan.body, "input"), "reason") ?? "",
        accountId,
        releasedLegs: Shared.objectField(storedSnapshot, "legs"),
        sourceRevision: Shared.signedText(currentRevision + 1n),
        executedAt: new Date(Date.parse(now)).toISOString(),
        receipt: Shared.receipt(
          command.idempotencyKey,
          "execute_bank_match_reversal",
          principal.actorId,
        ),
      } satisfies JsonObject);
      const execution = yield* Shared.decode(ExecutionSchema, body);
      yield* ReversalDb.insertReversal(transaction, {
        bookId: command.scope.bookId,
        planId: command.planId,
        approvalId: approval.id,
        targetKey: plan.targetKey,
        allocationPlanId: Shared.textField(target, "allocationPlanId") ?? null,
        statementId: Shared.textField(target, "statementId") ?? null,
        rowOrdinal: Shared.numberField(target, "rowOrdinal") ?? null,
        body,
      });
      yield* BankDb.bumpSourceRevision(transaction, command.scope.bookId, accountId);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "execute_bank_match_reversal",
        principal.actorId,
        yield* Shared.toJsonObject(execution),
      );
      return execution;
    }),
  );
});

export const getBankMatchReversal = Effect.fn("banking.reversal.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly planId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, reversalTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const plan = yield* readPlan(transaction, command.scope.bookId, command.planId);
      const execution = (yield* ReversalDb.readReversalExecution(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      const approval = (yield* ReversalDb.readCurrentReversalApproval(
        transaction,
        command.scope.bookId,
        command.planId,
      ))[0];
      return yield* Shared.decode(ViewSchema, {
        plan: yield* Shared.decode(PlanSchema, plan.body),
        approval:
          execution === undefined && approval !== undefined
            ? yield* Shared.decode(ApprovalSchema, approval.body)
            : null,
        execution: execution ? yield* Shared.decode(ExecutionSchema, execution.body) : null,
        dependenciesCurrent:
          execution === undefined &&
          (yield* snapshotIsCurrent(transaction, command.scope.bookId, plan.body)),
      });
    }),
  );
});

export const listBankMatchReversals = Effect.fn("banking.reversal.list")(function* (
  token: string,
  command: { readonly scope: Scope; readonly after?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, reversalTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];
      if (!book) return yield* failure("Forbidden");
      const after = command.after ?? null;
      if (after !== null && !Shared.identifierPattern.test(after)) {
        return yield* failure("InvalidJournal");
      }
      const rows = yield* ReversalDb.listReversalPlans(
        transaction,
        command.scope.bookId,
        after,
        pageSize,
      );
      const items = yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const input = Shared.objectField(row.body, "input");
          return {
            id: row.id,
            target: Shared.objectField(input, "target"),
            reason: Shared.textField(input, "reason") ?? "",
            createdAt: Shared.textField(row.body, "createdAt") ?? "",
            execution: row.execution ? yield* Shared.decode(ExecutionSchema, row.execution) : null,
          };
        }),
      );
      const last = rows[rows.length - 1]?.id;
      const next =
        last !== undefined &&
        (yield* ReversalDb.readReversalPlanTail(transaction, command.scope.bookId, last))[0]
          ?.present === true
          ? last
          : null;
      return yield* Shared.decode(ListSchema, { items, next });
    }),
  );
});
