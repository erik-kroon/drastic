import * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { isoNow, newId, replay, saveCommand } from "./posting";
import {
  decode,
  requireInsertAccess,
  requireTableAccess,
  toJsonObject,
  withBook,
} from "./commerce/support";
import * as Db from "../db/workspace";
import * as PostingDb from "../db/posting";
import type { Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;

const CoordinationSchema = Workspace.Coordination;
const SavedViewResultSchema = Workspace.SavedViewResult;
const DeletedViewSchema = Workspace.DeletedView;
const AssignmentResultSchema = Workspace.AssignmentResult;
const WorkPageSchema = Workspace.WorkPage;
const AttentionPageSchema = Workspace.AttentionPage;
const statuses = ["all", "open", "completed"] as const;
const sorts = ["newest", "oldest"] as const;
const workKinds = ["journal", "invoice", "expense"] as const;
const attentionKinds = ["all", ...workKinds] as const;
const filterKeys = ["kind", "period", "status", "sort", "q"] as const;
const maximumTeamSize = 200;
const maximumViews = 50;
const maximumSearch = 200;
const viewInserts = ["workspace_views", "command_receipts"];
const assignmentInserts = ["workspace_assignments", "command_receipts"];
const receiptInserts = ["command_receipts"];

function requireWorkspaceAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    yield* requireTableAccess(transaction, [...Db.workspaceTables], false);
    yield* requireInsertAccess(transaction, inserts);
  });
}

function trimmed(value: string | undefined) {
  return value === undefined ? "" : value.trim();
}

function calendarDate(value: string | undefined) {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10) === value ? value : undefined;
}

function oneOf<C extends string>(value: string, choices: ReadonlyArray<C>) {
  return choices.find((choice) => choice === value) ?? null;
}

function viewFilters(input: typeof Workspace.ViewFilters.Type) {
  return Effect.gen(function* () {
    const filters: Schema.MutableJsonObject = {};
    if (input.kind !== undefined) filters.kind = input.kind;
    if (input.period !== undefined) filters.period = input.period;
    if (input.status !== undefined) filters.status = input.status;
    if (input.sort !== undefined) filters.sort = input.sort;
    if (input.q !== undefined) filters.q = input.q;
    if (Object.keys(filters).some((key) => !filterKeys.find((allowed) => allowed === key))) {
      return yield* failure("InvalidJournal");
    }
    if (typeof filters.kind === "string" && oneOf(filters.kind, attentionKinds) === null) {
      return yield* failure("InvalidJournal");
    }
    if (typeof filters.status === "string" && oneOf(filters.status, statuses) === null) {
      return yield* failure("InvalidJournal");
    }
    if (typeof filters.sort === "string" && oneOf(filters.sort, sorts) === null) {
      return yield* failure("InvalidJournal");
    }
    if (typeof filters.q === "string" && filters.q.length > maximumSearch) {
      return yield* failure("InvalidJournal");
    }
    return yield* toJsonObject(filters);
  });
}

function assignmentView(row: Db.AssignmentRow) {
  const kind = oneOf(row.kind, workKinds);
  if (kind === null) {
    throw new Error("retained assignment kind is outside the supported contract");
  }
  return {
    kind,
    recordId: row.recordId,
    assigneeId: row.assigneeId,
    dueOn: row.dueOn,
    note: row.note,
    revision: Number(row.revision),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  } satisfies typeof Workspace.Assignment.Type;
}

export const coordination = Effect.fn("workspace.coordination")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireWorkspaceAccess(transaction, []);
    if (
      (yield* Db.countBookMembers(transaction, command.scope.bookId))[0]!.total > maximumTeamSize
    ) {
      return yield* failure("Unavailable");
    }
    const members = yield* Db.listBookMembers(transaction, command.scope.bookId);
    const views = yield* Db.listVisibleViews(transaction, command.scope.bookId, principal.actorId);
    return yield* decode(CoordinationSchema, {
      scope: command.scope,
      actorId: principal.actorId,
      members: members.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
      })),
      views: yield* Effect.forEach(views, (row) =>
        Effect.map(decode(Workspace.ViewFilters, row.filters), (filters) => ({
          id: row.id,
          ownerId: row.ownerId,
          name: row.name,
          visibility: row.visibility,
          filters,
        })),
      ),
    });
  });
});

export const saveView = Effect.fn("workspace.saveView")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Workspace.SaveView.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    command.input.visibility === "team",
    function* (transaction, principal) {
      yield* requireWorkspaceAccess(transaction, viewInserts);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "workspace_save_view",
        principal.actorId,
        yield* toJsonObject(command.input),
        SavedViewResultSchema,
      );
      if (request.previous) return request.previous;
      const name = command.input.name.trim();
      if (name.length < 1 || name.length > 80) return yield* failure("InvalidJournal");
      const filters = yield* viewFilters(command.input.filters);
      const period = command.input.filters.period;
      if (
        period !== undefined &&
        (yield* Db.readPeriod(transaction, command.scope.bookId, period)).length === 0
      ) {
        return yield* failure("NotFound");
      }
      if (
        (yield* Db.countViews(
          transaction,
          command.scope.bookId,
          command.input.visibility,
          principal.actorId,
        ))[0]!.total >= maximumViews
      ) {
        return yield* failure("InvalidJournal");
      }
      const id = newId("view");
      yield* Db.insertView(transaction, {
        bookId: command.scope.bookId,
        id,
        ownerId: principal.actorId,
        name,
        visibility: command.input.visibility,
        filters,
      });
      const result = yield* decode(SavedViewResultSchema, {
        scope: command.scope,
        view: {
          id,
          ownerId: principal.actorId,
          name,
          visibility: command.input.visibility,
          filters: yield* toJsonObject(command.input.filters),
        },
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "workspace_save_view",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const deleteView = Effect.fn("workspace.deleteView")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Workspace.DeleteView.Type;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireWorkspaceAccess(transaction, receiptInserts);
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "workspace_delete_view",
      principal.actorId,
      yield* toJsonObject(command.input),
      DeletedViewSchema,
    );
    if (request.previous) return request.previous;
    const target = (yield* Db.readOwnedView(
      transaction,
      command.scope.bookId,
      principal.actorId,
      command.input.id,
    ))[0];
    if (!target) return yield* failure("NotFound");
    if (target.visibility === "team") {
      const membership = (yield* Db.readBookMembershipRole(
        transaction,
        command.scope.bookId,
        principal.actorId,
      ))[0];
      if (membership?.role !== "operator") return yield* failure("Forbidden");
    }
    yield* Db.deleteView(transaction, command.scope.bookId, command.input.id);
    const result = yield* decode(DeletedViewSchema, { scope: command.scope, id: command.input.id });
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "workspace_delete_view",
      principal.actorId,
      result,
    );
    return result;
  }, "update");
});

export const assignWork = Effect.fn("workspace.assignWork")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Workspace.AssignWork.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireWorkspaceAccess(transaction, assignmentInserts);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "workspace_assign_work",
        principal.actorId,
        yield* toJsonObject(command.input),
        AssignmentResultSchema,
      );
      if (request.previous) return request.previous;
      if (command.input.note.length > 2000) return yield* failure("InvalidJournal");
      const dueOn = calendarDate(command.input.dueOn ?? undefined);
      if (dueOn === undefined) return yield* failure("InvalidJournal");
      if (
        (yield* Db.readWorkItem(
          transaction,
          command.scope.bookId,
          command.input.kind,
          command.input.recordId,
        ))[0]?.present !== true
      ) {
        return yield* failure("NotFound");
      }
      if (command.input.assigneeId !== null) {
        if (
          (yield* Db.readBookMembershipRole(
            transaction,
            command.scope.bookId,
            command.input.assigneeId,
          )).length === 0
        ) {
          return yield* failure("InvalidJournal");
        }
      }
      const current = (yield* Db.readAssignmentRevision(
        transaction,
        command.scope.bookId,
        command.input.kind,
        command.input.recordId,
      ))[0]?.revision;
      if (current === undefined) return yield* failure("InternalError");
      if (Number(current) !== command.input.expectedRevision) {
        return yield* failure("StaleDependency");
      }
      const saved = (yield* Db.insertAssignment(transaction, {
        bookId: command.scope.bookId,
        kind: command.input.kind,
        recordId: command.input.recordId,
        revision: String(command.input.expectedRevision + 1),
        assigneeId: command.input.assigneeId,
        dueOn,
        note: command.input.note,
        updatedBy: principal.actorId,
        updatedAt: yield* isoNow(transaction),
      }))[0];
      if (!saved) return yield* failure("InternalError");
      const result = yield* decode(AssignmentResultSchema, {
        scope: command.scope,
        assignment: assignmentView(saved),
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "workspace_assign_work",
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const listWork = Effect.fn("workspace.listWork")(function* (
  token: string,
  command: { scope: Scope } & typeof Workspace.WorkQuery.Type,
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireWorkspaceAccess(transaction, []);
    const period = command.period ?? null;
    const status = command.status ?? "open";
    const sort = command.sort ?? "newest";
    const search = trimmed(command.q);
    if (search.length > maximumSearch) return yield* failure("InvalidJournal");
    if (
      period !== null &&
      (yield* Db.readPeriod(transaction, command.scope.bookId, period)).length === 0
    ) {
      return yield* failure("NotFound");
    }
    const anchor =
      command.after === undefined
        ? null
        : ((yield* Db.readWorkAnchor(transaction, command.scope.bookId, command.after))[0] ?? null);
    if (command.after !== undefined && !anchor) return yield* failure("NotFound");
    const filters = { period, status, sort, search, anchor } satisfies Db.WorkFilters;
    const rows = yield* Db.listWorkItems(transaction, command.scope.bookId, filters);
    const counts = (yield* Db.countWorkItems(transaction, command.scope.bookId, filters))[0];
    if (!counts) return yield* failure("InternalError");
    const page = rows.slice(0, 50);
    const book = (yield* PostingDb.readBook(transaction, command.scope))[0];
    if (!book) return yield* failure("NotFound");
    if (
      page.some(
        (row) =>
          row.description === null ||
          row.postingDate === null ||
          row.periodId === null ||
          row.currency === null,
      )
    ) {
      return yield* failure("InternalError");
    }
    return yield* decode(WorkPageSchema, {
      scope: command.scope,
      actorId: principal.actorId,
      checkedAt: yield* isoNow(transaction),
      sequence: book.committedSequence.toString(),
      currencyScale: book.currencyScale,
      filters: { period, status, sort, q: search },
      coverage: "journal_proposals_only",
      total: counts.total,
      counts: { open: counts.open, completed: counts.completed },
      items: page.map((row) => ({
        kind: "journal_proposal",
        id: row.id,
        revision: row.revision,
        description: row.description!,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        postingDate: row.postingDate!,
        periodId: row.periodId!,
        amountMinor: row.amountMinor,
        currency: row.currency!,
        state:
          row.postingStatus === "unposted_at_check"
            ? "unposted"
            : row.postingStatus === "posted"
              ? "posted"
              : "posted_elsewhere",
        receiptId: row.receiptId,
      })),
      next: rows.length > 50 ? (page.at(-1)?.id ?? null) : null,
    });
  });
});

export const listAttention = Effect.fn("workspace.listAttention")(function* (
  token: string,
  command: { scope: Scope } & typeof Workspace.AttentionQuery.Type,
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireWorkspaceAccess(transaction, []);
    const kind = command.kind ?? "all";
    const status = command.status ?? "open";
    const sort = command.sort ?? "newest";
    const search = trimmed(command.q);
    if (search.length > maximumSearch) return yield* failure("InvalidJournal");
    const period = command.period ?? null;
    const starts =
      period === null
        ? null
        : ((yield* Db.readPeriod(transaction, command.scope.bookId, period))[0]?.startsOn ?? null);
    const ends =
      period === null
        ? null
        : ((yield* Db.readPeriod(transaction, command.scope.bookId, period))[0]?.endsOn ?? null);
    if (period !== null && starts === null) return yield* failure("NotFound");
    const after = command.after ?? null;
    const filters = { kind, period, status, sort, search, after } satisfies Db.AttentionFilters;
    if (
      after !== null &&
      (yield* Db.readAttentionAnchor(
        transaction,
        command.scope.bookId,
        kind,
        period,
        search,
        starts,
        ends,
        after,
      ))[0]?.key !== after
    ) {
      return yield* failure("NotFound");
    }
    const rows = yield* Db.listAttentionItems(
      transaction,
      command.scope.bookId,
      filters,
      starts,
      ends,
    );
    const counts = (yield* Db.countAttentionItems(
      transaction,
      command.scope.bookId,
      filters,
      starts,
      ends,
    ))[0];
    if (!counts) return yield* failure("InternalError");
    const page = rows.slice(0, 50);
    return yield* decode(AttentionPageSchema, {
      scope: command.scope,
      checkedAt: yield* isoNow(transaction),
      coverage: "journals_invoice_drafts_expense_reviews",
      filters: { kind, period, status, sort, q: search },
      counts: { open: counts.open, completed: counts.completed },
      total: counts.total,
      items: page.map((row) => ({
        key: row.key,
        assignment:
          row.assignmentKind === null
            ? null
            : {
                kind: row.assignmentKind,
                recordId: row.assignmentRecordId ?? row.id,
                assigneeId: row.assignmentAssigneeId,
                dueOn: row.assignmentDueOn,
                note: row.assignmentNote ?? "",
                revision: Number(row.assignmentRevision ?? "0"),
                updatedAt: row.assignmentUpdatedAt ?? "",
                updatedBy: row.assignmentUpdatedBy ?? "",
              },
        kind: row.kind,
        id: row.id,
        revision: row.revision,
        title: row.title ?? "",
        date: row.date,
        updatedAt: row.updatedAt,
        amountMinor: row.amountMinor,
        currency: row.currency,
        currencyScale: row.currencyScale,
        state: row.state,
        reason: row.reason,
      })),
      next: rows.length > 50 ? (page.at(-1)?.key ?? null) : null,
    });
  });
});
