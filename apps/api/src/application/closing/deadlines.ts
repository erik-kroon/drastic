import * as Accounting from "@open-erp/contracts/accounting";
import * as Deadlines from "@open-erp/contracts/deadlines";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { decode, toJsonObject, unsupported, withBook } from "../commerce/support";
import * as Db from "../../db/deadlines";
import { hashToken } from "../../db/human-actor";
import type { Transaction } from "../../db/transaction";

type Scope = typeof Accounting.Scope.Type;
type JsonObject = Schema.JsonObject;
type SaveInput = typeof Deadlines.DeadlineInput.Type;

const DeadlineSchema = Deadlines.Deadline;
const FeedSchema = Deadlines.DeadlineFeed;
const RevokedSchema = Deadlines.RevokedDeadlineFeed;
const outcomeKinds = ["prepared", "submitted", "accepted"] as const;
const activityActions = ["dismiss_reminder", "record_outcome"] as const;
const maximumReference = 500;
const defaultRevisionReason = "Updated obligation details";

function requireDeadlineAccess(transaction: Transaction, write: boolean) {
  const readTables = [...Db.deadlineReadTables];
  const insertTables = new Set<string>(Db.deadlineInsertTables);
  const updateColumns = [...Db.deadlineUpdateColumns];
  return Effect.gen(function* () {
    const rows = yield* Db.readDeadlineAccess(transaction);
    if (rows.length !== readTables.length) return yield* unsupported();
    if (rows.some((row) => !row.canSelect)) return yield* unsupported();
    if (!write) return;
    if (rows.some((row) => insertTables.has(row.tableName) && !row.canInsert))
      return yield* unsupported();
    const columns = yield* Db.readDeadlineColumnAccess(transaction);
    if (columns.length !== updateColumns.length) return yield* unsupported();
    if (columns.some((row) => !row.canUpdate)) return yield* unsupported();
  });
}

function text(value: JsonObject, key: string) {
  const found = value[key];
  return typeof found === "string" ? found : null;
}

function validateInput(input: JsonObject) {
  return Effect.gen(function* () {
    if (text(input, "title") === null) return yield* failure("InvalidJournal");
    if (text(input, "periodId") === null) return yield* failure("InvalidJournal");
    if (text(input, "responsibleActorId") === null) return yield* failure("InvalidJournal");
    if (text(input, "dueAt") === null) return yield* failure("InvalidJournal");
    if (text(input, "timeZone") === null) return yield* failure("InvalidJournal");
    if (text(input, "sourceReference") === null) return yield* failure("InvalidJournal");
    if (text(input, "sourceRevision") === null) return yield* failure("InvalidJournal");
    const kind = text(input, "outcomeKind");
    if (kind === null || !outcomeKinds.some((choice) => choice === kind)) {
      return yield* failure("InvalidJournal");
    }
  });
}

function decodeObligationList(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.Array(DeadlineSchema))(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

export const listObligations = Effect.fn("deadlines.listObligations")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireDeadlineAccess(transaction, false);
    const rows = yield* Db.listObligations(transaction, command.scope.bookId);
    return yield* decodeObligationList(rows.map((row) => row.body));
  });
});

export const saveObligation = Effect.fn("deadlines.saveObligation")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    expectedRevision: number | null;
    input: SaveInput;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({
        id: command.id,
        expectedRevision: command.expectedRevision,
        input: command.input,
      });
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "deadline_save",
        principal.actorId,
        payload,
        DeadlineSchema,
      );
      if (request.previous) return request.previous;
      yield* requireDeadlineAccess(transaction, true);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(command.id)) return yield* failure("InvalidJournal");
      const input = yield* toJsonObject(command.input);
      yield* validateInput(input);
      const dueAt = text(input, "dueAt")!;
      if (Number.isNaN(Date.parse(dueAt))) return yield* failure("InvalidJournal");
      const timeZone = text(input, "timeZone")!;
      if ((yield* Db.knownTimeZone(transaction, timeZone))[0]?.present !== true) {
        return yield* failure("InvalidJournal");
      }
      const responsibleActorId = text(input, "responsibleActorId")!;
      if (
        (yield* Db.responsibleMember(transaction, command.scope.bookId, responsibleActorId))[0]
          ?.present !== true
      ) {
        return yield* failure("Forbidden");
      }
      const overrideReason = text(input, "overrideReason");
      const existing = (yield* Db.readObligation(
        transaction,
        command.scope.bookId,
        command.id,
        true,
      ))[0];
      if (existing) {
        if (
          command.expectedRevision === null ||
          Number(existing.revision) !== command.expectedRevision
        ) {
          return yield* failure("StaleDependency");
        }
        const changed = (yield* Db.sourceChanged(
          transaction,
          command.scope.bookId,
          command.id,
          dueAt,
          text(input, "sourceReference")!,
          text(input, "sourceRevision")!,
        ))[0]?.changed;
        if (changed === undefined) return yield* failure("InternalError");
        if (changed && (overrideReason === null || overrideReason.length === 0)) {
          return yield* failure("InvalidJournal");
        }
        yield* Db.insertRevision(transaction, {
          bookId: command.scope.bookId,
          obligationId: command.id,
          revision: String(Number(existing.revision) + 1),
          changedBy: principal.actorId,
          priorDueAt: existing.dueAt,
          priorSourceReference: existing.sourceReference,
          priorSourceRevision: existing.sourceRevision,
          reason: overrideReason ?? defaultRevisionReason,
        });
        yield* Db.updateObligation(transaction, {
          bookId: command.scope.bookId,
          id: command.id,
          title: text(input, "title")!,
          periodId: text(input, "periodId")!,
          responsibleActorId,
          dueAt,
          timeZone,
          sourceReference: text(input, "sourceReference")!,
          sourceRevision: text(input, "sourceRevision")!,
          overrideReason:
            overrideReason === null || overrideReason.length === 0 ? null : overrideReason,
          outcomeKind: text(input, "outcomeKind")!,
        });
      } else {
        if (command.expectedRevision !== null) return yield* failure("StaleDependency");
        yield* Db.insertObligation(transaction, {
          bookId: command.scope.bookId,
          id: command.id,
          title: text(input, "title")!,
          periodId: text(input, "periodId")!,
          responsibleActorId,
          dueAt,
          timeZone,
          sourceReference: text(input, "sourceReference")!,
          sourceRevision: text(input, "sourceRevision")!,
          overrideReason:
            overrideReason === null || overrideReason.length === 0 ? null : overrideReason,
          outcomeKind: text(input, "outcomeKind")!,
        });
      }
      const result = yield* decode(
        DeadlineSchema,
        (yield* Db.readProjection(transaction, command.scope.bookId, command.id))[0]!.body,
      );
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "deadline_save",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const recordActivity = Effect.fn("deadlines.recordActivity")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    action: typeof Deadlines.DeadlineActivity.Type.action;
    reference: typeof Deadlines.DeadlineActivity.Type.reference;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({
        id: command.id,
        action: command.action,
        reference: command.reference,
      });
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "deadline_activity",
        principal.actorId,
        payload,
        DeadlineSchema,
      );
      if (request.previous) return request.previous;
      yield* requireDeadlineAccess(transaction, true);
      if (!activityActions.some((choice) => choice === command.action)) {
        return yield* failure("InvalidJournal");
      }
      const existing = (yield* Db.readObligation(
        transaction,
        command.scope.bookId,
        command.id,
        true,
      ))[0];
      if (!existing) return yield* failure("NotFound");
      const recordedAt = yield* isoNow(transaction);
      if (command.action === "dismiss_reminder" && command.reference === undefined) {
        yield* Db.insertActivity(transaction, {
          bookId: command.scope.bookId,
          obligationId: command.id,
          id: newId("deadline_activity"),
          action: "dismiss_reminder",
          reference: null,
          outcomeKind: null,
          recordedBy: principal.actorId,
          recordedAt,
        });
        yield* Db.dismissReminder(transaction, command.scope.bookId, command.id, recordedAt);
      } else if (
        command.action === "record_outcome" &&
        command.reference !== undefined &&
        command.reference.length >= 1 &&
        command.reference.length <= maximumReference
      ) {
        yield* Db.insertActivity(transaction, {
          bookId: command.scope.bookId,
          obligationId: command.id,
          id: newId("deadline_activity"),
          action: "record_outcome",
          reference: command.reference,
          outcomeKind: existing.outcomeKind,
          recordedBy: principal.actorId,
          recordedAt,
        });
        yield* Db.recordOutcome(
          transaction,
          command.scope.bookId,
          command.id,
          command.reference,
          recordedAt,
        );
      } else {
        return yield* failure("InvalidJournal");
      }
      const result = yield* decode(
        DeadlineSchema,
        (yield* Db.readProjection(transaction, command.scope.bookId, command.id))[0]!.body,
      );
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "deadline_activity",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const createFeed = Effect.fn("deadlines.createFeed")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireDeadlineAccess(transaction, true);
      const secret = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
      yield* Db.insertFeed(transaction, {
        bookId: command.scope.bookId,
        id: command.id,
        tokenHash: yield* hashToken(secret),
        createdBy: principal.actorId,
      });
      return yield* decode(FeedSchema, { id: command.id, secret });
    },
    "update",
  );
});

export const revokeFeed = Effect.fn("deadlines.revokeFeed")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({ id: command.id });
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "deadline_feed_revoke",
        principal.actorId,
        payload,
        RevokedSchema,
      );
      if (request.previous) return request.previous;
      yield* requireDeadlineAccess(transaction, true);
      if ((yield* Db.revokeFeed(transaction, command.scope.bookId, command.id)).length === 0) {
        return yield* failure("NotFound");
      }
      const result = yield* decode(RevokedSchema, { id: command.id, revoked: true });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "deadline_feed_revoke",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});
