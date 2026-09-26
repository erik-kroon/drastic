import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import { failure } from "./failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "./identity";
import {
  approveChangeInTransaction,
  createEvidenceInTransaction,
  digest,
  executeChangeInTransaction,
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
  validatePlan,
} from "./posting";
import * as Db from "../db/posting";
import * as RecoveryDb from "../db/posting-recovery";
import * as CorrectionDb from "../db/posting-corrections";
import { databaseFailure, type Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

type SavedCommand = typeof Recovery.SavedPostingCommand.Type;

type JsonObject = Schema.JsonObject;

type SavedResult =
  | typeof Accounting.Evidence.Type
  | typeof Accounting.ChangeSet.Type
  | typeof Accounting.Approval.Type
  | typeof Accounting.ExecutionReceipt.Type
  | typeof Recovery.ApprovalRevocation.Type;

const ApprovalSchema = Accounting.Approval;

type RecoveryRequest = typeof Recovery.RecoveryRequest.Type;

type RecoveredRequest = typeof Recovery.RecoveredPostingRequest.Type;

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  lockMode: AuthorityLockMode,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown>,
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

function operationForSavedCommand(command: SavedCommand) {
  return command.operation;
}

function resultSchema(operation: string): Schema.Decoder<SavedResult> {
  if (operation === "create_evidence") return Accounting.Evidence;

  if (operation === "prepare_journal" || operation === "prepare_correction") {
    return Accounting.ChangeSet;
  }

  if (operation === "approve_change") return Accounting.Approval;

  if (operation === "execute_change") return Accounting.ExecutionReceipt;

  return Recovery.ApprovalRevocation;
}

function recoveredResultSchema(
  operation: string,
): Schema.Decoder<
  | typeof Accounting.ChangeSet.Type
  | typeof Accounting.Approval.Type
  | typeof Accounting.ValidationReport.Type
  | typeof Accounting.ExecutionReceipt.Type
> {
  if (operation === "approve_change") return Accounting.Approval;

  if (operation === "execute_change") return Accounting.ExecutionReceipt;

  if (operation === "validate_change") return Accounting.ValidationReport;

  return Accounting.ChangeSet;
}

function summaryForCommand(
  row: RecoveryDb.SavedRequestRow,
  state: "unknown" | "committed" | "refused",
  command: SavedCommand,
) {
  return {
    key: row.key,
    actorId: row.actorId,
    operation: operationForSavedCommand(command),
    requestDigest: row.digest,
    commandKey: row.commandKey,
    savedAt: row.savedAt,
    state,
  } satisfies typeof Recovery.SavedPostingSummary.Type;
}

function savedView(
  transaction: Transaction,
  scope: Scope,
  row: RecoveryDb.SavedRequestRow,
  actorId: string,
) {
  return Effect.gen(function* () {
    const command = yield* decode(Recovery.SavedPostingCommand, row.command);
    const outcomeRow = (yield* RecoveryDb.readSavedOutcome(transaction, scope, row.key))[0];

    const outcome = outcomeRow
      ? yield* decode(Recovery.SavedPostingOutcome, {
          state: outcomeRow.state,
          result: outcomeRow.result,
          refusal: outcomeRow.refusal,
          recordedAt: outcomeRow.recordedAt,
        } satisfies JsonObject)
      : null;

    return {
      scope,
      checkedAt: yield* isoNow(transaction),
      request: summaryForCommand(row, outcome?.state ?? "unknown", command),
      command,
      sameActor: row.actorId === actorId,
      outcome,
    } satisfies typeof Recovery.SavedPostingRequest.Type;
  });
}

function savedResult(operation: string, result: JsonObject) {
  return decode(resultSchema(operation), result);
}

function isPersistableRefusal(error: Accounting.AccountingError) {
  return [
    "InvalidJournal",
    "MissingEvidence",
    "PeriodLocked",
    "StaleDependency",
    "IdempotencyConflict",
    "AlreadyPosted",
    "ApprovalRequired",
    "UnsupportedProfile",
    "NotFound",
  ].includes(error.code);
}

function runWithSavepoint<A>(
  transaction: Transaction,
  operation: Effect.Effect<A, unknown, never>,
): Effect.Effect<
  | { readonly state: "committed"; readonly result: A }
  | { readonly state: "refused"; readonly error: Accounting.AccountingError },
  Accounting.AccountingError
> {
  return Effect.gen(function* () {
    yield* transaction
      .execute(sql`SAVEPOINT posting_saved_request`)
      .pipe(Effect.mapError(databaseFailure));
    const mappedOperation = operation.pipe(Effect.mapError(databaseFailure));

    const result = yield* mappedOperation.pipe(
      Effect.map((value) => ({ state: "committed", result: value }) as const),
      Effect.catchIf(isPersistableRefusal, (error) =>
        transaction
          .execute(sql`ROLLBACK TO SAVEPOINT posting_saved_request`)
          .pipe(Effect.mapError(databaseFailure), Effect.as({ state: "refused", error } as const)),
      ),
    );

    yield* transaction
      .execute(sql`RELEASE SAVEPOINT posting_saved_request`)
      .pipe(Effect.mapError(databaseFailure));

    return result;
  });
}

export const savePostingRequest = Effect.fn("posting.saveRequest")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; command: SavedCommand },
) {
  return yield* savePostingRequestWithAuthority(token, command, false);
});

export const savePostingAuthorityRequest = Effect.fn("posting.saveAuthorityRequest")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    command: typeof Recovery.PostingAuthorityCommand.Type;
  },
) {
  return yield* savePostingRequestWithAuthority(token, command, true);
});

function savePostingRequestWithAuthority(
  token: string,
  command: { scope: Scope; idempotencyKey: string; command: SavedCommand },
  operatorOnly: boolean,
) {
  return withBook(token, command.scope, operatorOnly, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const decodedCommand = yield* decode(Recovery.SavedPostingCommand, command.command);

      const authorityCommand =
        decodedCommand.operation === "approve_change" ||
        decodedCommand.operation === "revoke_approval";

      if (authorityCommand !== operatorOnly) {
        return yield* failure("Forbidden");
      }

      const expected = yield* digest({
        scope: command.scope,
        actorId: principal.actorId,
        command: decodedCommand,
      });

      const existing = (yield* RecoveryDb.readSavedRequest(
        transaction,
        command.scope,
        command.idempotencyKey,
        "update",
      ))[0];

      if (existing) {
        if (existing.actorId !== principal.actorId || existing.digest !== expected) {
          return yield* failure("IdempotencyConflict");
        }

        return yield* savedView(transaction, command.scope, existing, principal.actorId);
      }

      const commandKey = newId("posting_command");

      if (
        (yield* Db.readCommandReceipt(transaction, command.scope.bookId, commandKey, "update"))
          .length > 0
      ) {
        return yield* failure("IdempotencyConflict");
      }

      const row: RecoveryDb.SavedRequestRow = {
        bookId: command.scope.bookId,
        key: command.idempotencyKey,
        actorId: principal.actorId,
        command: decodedCommand,
        digest: expected,
        commandKey,
        savedAt: yield* isoNow(transaction),
      };

      yield* RecoveryDb.insertSavedRequest(transaction, row);

      return yield* savedView(transaction, command.scope, row, principal.actorId);
    }),
  );
}

export const runPostingRequest = Effect.fn("posting.runRequest")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* runPostingRequestWithAuthority(token, command, false);
});

export const runPostingAuthorityRequest = Effect.fn("posting.runAuthorityRequest")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* runPostingRequestWithAuthority(token, command, true);
});

function runPostingRequestWithAuthority(
  token: string,
  command: { scope: Scope; key: string },
  operatorOnly: boolean,
) {
  return withBook(token, command.scope, operatorOnly, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const row = (yield* RecoveryDb.readSavedRequest(
        transaction,
        command.scope,
        command.key,
        "update",
      ))[0];

      if (!row) return yield* failure("NotFound");

      if (row.actorId !== principal.actorId) return yield* failure("Forbidden");
      const savedCommand = yield* decode(Recovery.SavedPostingCommand, row.command);

      const authorityCommand =
        savedCommand.operation === "approve_change" || savedCommand.operation === "revoke_approval";

      if (authorityCommand !== operatorOnly) {
        return yield* failure("Forbidden");
      }

      if (
        authorityCommand &&
        (yield* Db.readOperatorMembership(transaction, command.scope.bookId, principal.actorId))
          .length === 0
      ) {
        return yield* failure("Forbidden");
      }

      const prior = (yield* RecoveryDb.readSavedOutcome(transaction, command.scope, row.key))[0];

      if (prior) return yield* savedView(transaction, command.scope, row, principal.actorId);

      const operation = yield* runWithSavepoint(
        transaction,
        runSavedCommand(transaction, principal, command.scope, savedCommand, row.commandKey),
      );

      if (operation.state === "refused") {
        const refusal = { code: operation.error.code, message: operation.error.message };
        yield* RecoveryDb.insertSavedOutcome(transaction, {
          bookId: command.scope.bookId,
          key: row.key,
          state: "refused",
          result: null,
          refusal,
          recordedAt: yield* isoNow(transaction),
        });
      } else {
        const result = yield* savedResult(operation.result.operation, operation.result.result);
        yield* RecoveryDb.insertSavedOutcome(transaction, {
          bookId: command.scope.bookId,
          key: row.key,
          state: "committed",
          result,
          refusal: null,
          recordedAt: yield* isoNow(transaction),
        });
      }

      return yield* savedView(transaction, command.scope, row, principal.actorId);
    }),
  );
}

function runSavedCommand(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  command: SavedCommand,
  commandKey: string,
) {
  return Effect.gen(function* () {
    if (command.operation === "create_evidence") {
      return {
        operation: command.operation,
        result: yield* createEvidenceInTransaction(transaction, principal, {
          scope,
          idempotencyKey: commandKey,
          input: command.input,
        }),
      } as const;
    }

    if (command.operation === "prepare_journal") {
      return {
        operation: command.operation,
        result: yield* prepareJournalInTransaction(transaction, principal, {
          scope,
          idempotencyKey: commandKey,
          input: command.input,
        }),
      } as const;
    }

    if (command.operation === "approve_change") {
      return {
        operation: command.operation,
        result: yield* approveChangeInTransaction(transaction, principal, {
          scope,
          changeSetId: command.id,
          idempotencyKey: commandKey,
          input: command.input,
        }),
      } as const;
    }

    if (command.operation === "execute_change") {
      return {
        operation: command.operation,
        result: yield* executeChangeInTransaction(transaction, principal, {
          scope,
          changeSetId: command.id,
          idempotencyKey: commandKey,
          input: command.input,
        }),
      } as const;
    }

    return {
      operation: command.operation,
      result: yield* revokeApprovalInTransaction(transaction, principal, scope, {
        approvalId: command.id,
        idempotencyKey: commandKey,
        input: command.input,
      }),
    } as const;
  });
}

function revokeApprovalInTransaction(
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  command: { approvalId: string; idempotencyKey: string; input: { reason: string } },
) {
  return Effect.gen(function* () {
    const request = yield* replay(
      transaction,
      scope,
      command.idempotencyKey,
      "revoke_posting_approval",
      principal.actorId,
      { id: command.approvalId, input: command.input },
      Recovery.ApprovalRevocation,
    );

    if (request.previous) return request.previous;

    const approval = (yield* Db.readApproval(
      transaction,
      scope.bookId,
      command.approvalId,
      "update",
    ))[0];

    if (!approval) return yield* failure("NotFound");

    if (approval.consumedAt !== null) return yield* failure("AlreadyPosted");

    if ((yield* Db.readApprovalRevocation(transaction, scope.bookId, approval.id)).length > 0) {
      return yield* failure("ApprovalRequired");
    }

    const result = yield* decode(Recovery.ApprovalRevocation, {
      approvalId: approval.id,
      changeSetId: approval.changeSetId,
      planDigest: approval.digest,
      actorId: principal.actorId,
      reason: command.input.reason,
      revokedAt: yield* isoNow(transaction),
    });

    yield* RecoveryDb.insertApprovalRevocation(transaction, {
      bookId: scope.bookId,
      approvalId: approval.id,
      actorId: principal.actorId,
      reason: command.input.reason,
      revokedAt: result.revokedAt,
    });
    yield* saveCommand(
      transaction,
      scope,
      command.idempotencyKey,
      request.expected,
      "revoke_posting_approval",
      principal.actorId,
      result,
    );

    return result;
  });
}

export const getSavedPostingRequest = Effect.fn("posting.getSavedRequest")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* RecoveryDb.readSavedRequest(transaction, command.scope, command.key))[0];

      if (!row) return yield* failure("NotFound");

      return yield* savedView(transaction, command.scope, row, principal.actorId);
    }),
  );
});

export const listSavedPostingRequests = Effect.fn("posting.listSavedRequests")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      const anchor = command.after
        ? (yield* RecoveryDb.readSavedRequest(transaction, command.scope, command.after))[0]
        : undefined;

      if (command.after && !anchor) return yield* failure("NotFound");
      const rows = yield* RecoveryDb.listSavedRequests(transaction, command.scope, anchor);
      const page = rows.slice(0, 20);

      const items = yield* Effect.forEach(page, (row) =>
        Effect.gen(function* () {
          const outcome = (yield* RecoveryDb.readSavedOutcome(
            transaction,
            command.scope,
            row.key,
          ))[0];

          const state =
            outcome?.state === "committed" || outcome?.state === "refused"
              ? outcome.state
              : "unknown";

          return summaryForCommand(
            row,
            state,
            yield* decode(Recovery.SavedPostingCommand, row.command),
          );
        }),
      );

      return {
        scope: command.scope,
        actorId: principal.actorId,
        checkedAt: yield* isoNow(transaction),
        items,
        next: rows.length > 20 ? (page.at(-1)?.key ?? null) : null,
      } satisfies typeof Recovery.SavedPostingRequests.Type;
    }),
  );
});

function planFromRow(row: { plan: JsonObject }) {
  return decode(Accounting.ChangeSet, row.plan);
}

function recoverySummary(
  transaction: Transaction,
  scope: Scope,
  plan: typeof Accounting.ChangeSet.Type,
  createdBy: string,
) {
  return Effect.gen(function* () {
    const action = plan.groups[0]?.actions[0];

    if (!action) return yield* failure("InvalidJournal");
    const voucherIds = yield* Db.readVoucherByEconomicIdentity(transaction, scope.bookId, action);

    const candidates = yield* Effect.forEach(voucherIds, (row) =>
      Db.readExecutionReceiptByVoucher(transaction, scope.bookId, row.id),
    );

    const receiptRows = candidates.flat();

    const receipt = receiptRows[0]
      ? yield* decode(Accounting.ExecutionReceipt, receiptRows[0].body)
      : null;

    return {
      changeSetId: plan.id,
      planDigest: plan.planDigest,
      createdAt: plan.createdAt,
      createdBy,
      description: action.description,
      postingStatus: receipt
        ? receipt.changeSetId === plan.id
          ? ("posted" as const)
          : ("posted_by_other_proposal" as const)
        : ("unposted_at_check" as const),
      executionReceipt: receipt,
    };
  });
}

export const listPostingRecovery = Effect.fn("posting.listRecovery")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      const anchor = command.after
        ? (yield* RecoveryDb.readRecoveryAnchor(transaction, command.scope, command.after))[0]
        : undefined;

      if (command.after && !anchor) return yield* failure("NotFound");
      const rows = yield* RecoveryDb.listRecoveryPlans(transaction, command.scope, anchor);
      const page = rows.slice(0, 20);

      const items = yield* Effect.forEach(page, (row) =>
        Effect.gen(function* () {
          const plan = yield* planFromRow(row);

          return yield* recoverySummary(transaction, command.scope, plan, row.createdBy);
        }),
      );

      return {
        scope: command.scope,
        actorId: principal.actorId,
        checkedAt: yield* isoNow(transaction),
        sequence:
          (yield* Db.readBook(transaction, command.scope))[0]?.committedSequence.toString() ?? "0",
        items,
        next: rows.length > 20 ? (page.at(-1)?.id ?? null) : null,
      } satisfies typeof Recovery.RecoveryList.Type;
    }),
  );
});

export const getPostingRecovery = Effect.fn("posting.getRecovery")(function* (
  token: string,
  command: { scope: Scope; changeSetId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      const row = (yield* RecoveryDb.readRecoveryAnchor(
        transaction,
        command.scope,
        command.changeSetId,
      ))[0];

      if (!row) return yield* failure("NotFound");

      const bundle = yield* CorrectionDb.readBundleByChangeSet(
        transaction,
        command.scope.bookId,
        command.changeSetId,
      );

      if (bundle.length > 0) return yield* failure("UnsupportedProfile");

      const planRow = (yield* Db.readPlan(
        transaction,
        command.scope.bookId,
        command.changeSetId,
      ))[0];

      if (!planRow) return yield* failure("NotFound");
      const plan = yield* decode(Accounting.ChangeSet, planRow.plan);
      const summary = yield* recoverySummary(transaction, command.scope, plan, planRow.createdBy);

      const validation = yield* validatePlan(transaction, command.scope, plan).pipe(
        Effect.asVoid,
        Effect.mapError(databaseFailure),
        Effect.match({
          onFailure: (error) => ({
            status: "blocked" as const,
            blocker: { code: error.code, message: error.message },
          }),
          onSuccess: () => ({ status: "current" as const, blocker: null }),
        }),
      );

      const now = yield* Db.readDatabaseTime(transaction);
      const approvalRows = yield* Db.readApprovals(transaction, command.scope.bookId, plan.id);
      let availableApproval: typeof Accounting.Approval.Type | null = null;

      for (const approval of approvalRows) {
        if (
          approval.digest === plan.planDigest &&
          approval.consumedAt === null &&
          Date.parse(approval.expiresAt) > Date.parse(now.now) &&
          (yield* Db.readOperatorMembership(transaction, command.scope.bookId, approval.actorId))
            .length > 0 &&
          (yield* Db.readActorAdmission(transaction, approval.actorId))[0]?.enabled !== false &&
          (yield* Db.readApprovalRevocation(transaction, command.scope.bookId, approval.id))
            .length === 0
        ) {
          availableApproval = yield* decode(ApprovalSchema, {
            id: approval.id,
            changeSetId: approval.changeSetId,
            planDigest: approval.digest,
            actorId: approval.actorId,
            expiresAt: approval.expiresAt,
          });
          break;
        }
      }

      const requestAnchor = command.after
        ? (yield* RecoveryDb.readRecoveryRequestAnchor(
            transaction,
            command.scope,
            command.changeSetId,
            command.after,
          ))[0]
        : undefined;

      if (command.after && !requestAnchor) return yield* failure("NotFound");

      const requestRows = yield* RecoveryDb.listRecoveryRequests(
        transaction,
        command.scope,
        command.changeSetId,
        requestAnchor,
      );

      const requestPage = requestRows.slice(0, 20);

      const requests = yield* Effect.forEach(requestPage, (request) =>
        Effect.gen(function* () {
          const operation = yield* Schema.decodeUnknownEffect(Recovery.PostingOperation)(
            request.operation,
          ).pipe(Effect.mapError(() => failure("InternalError")));

          const metadata = yield* Schema.decodeEffect(
            Schema.Struct({
              id: Schema.optional(Accounting.Identifier),
              planDigest: Schema.optional(Accounting.Digest),
            }),
          )(request.result).pipe(Effect.mapError(() => failure("InternalError")));

          let approvalState: RecoveryRequest["approvalState"] = null;

          if (operation === "approve_change") {
            approvalState = request.approvalConsumedAt
              ? "consumed"
              : request.approvalRevoked
                ? "revoked"
                : request.approvalExpiresAt &&
                    Date.parse(request.approvalExpiresAt) <= Date.parse(now.now)
                  ? "expired"
                  : (yield* Db.readOperatorMembership(
                        transaction,
                        command.scope.bookId,
                        request.approvalActorId ?? "",
                      )).length === 0
                    ? "authority_lost"
                    : "unconsumed_at_check";
          }

          return {
            key: request.key,
            operation,
            actorId: request.actorId,
            requestDigest: request.requestDigest,
            recordedAt: request.recordedAt,
            resultId: metadata.id ?? null,
            planDigest: metadata.planDigest ?? null,
            approvalState,
          } satisfies RecoveryRequest;
        }),
      );

      return {
        scope: command.scope,
        actorId: principal.actorId,
        checkedAt: now.now,
        sequence:
          (yield* Db.readBook(transaction, command.scope))[0]?.committedSequence.toString() ?? "0",
        summary,
        plan,
        validation,
        availableApproval,
        requests,
        nextRequest: requestRows.length > 20 ? (requestPage.at(-1)?.key ?? null) : null,
      } satisfies typeof Recovery.PostingRecovery.Type;
    }),
  );
});

export const recoverPostingRequest = Effect.fn("posting.recoverRequest")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);

      const row = (yield* Db.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "share",
      )).find((item) =>
        [
          "prepare_journal",
          "prepare_correction",
          "validate_change",
          "approve_change",
          "execute_change",
        ].includes(item.operation),
      );

      if (!row) {
        return {
          scope: command.scope,
          key: command.key,
          checkedAt: yield* isoNow(transaction),
          state: "not_observed",
          operation: null,
          actorId: null,
          requestDigest: null,
          result: null,
          recordedAt: null,
          sameActor: null,
        } satisfies RecoveredRequest;
      }

      const operation = yield* Schema.decodeUnknownEffect(Recovery.PostingOperation)(
        row.operation,
      ).pipe(Effect.mapError(() => failure("InternalError")));

      const result = yield* decode(recoveredResultSchema(operation), row.result);

      return {
        scope: command.scope,
        key: command.key,
        checkedAt: yield* isoNow(transaction),
        state: "committed",
        operation,
        actorId: row.actorId,
        requestDigest: row.requestDigest,
        result,
        recordedAt: row.recordedAt,
        sameActor: row.actorId === principal.actorId,
      } satisfies RecoveredRequest;
    }),
  );
});
