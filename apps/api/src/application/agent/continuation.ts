import { runBookCommandWithReceipt } from "../book-commands";
import * as Workspace from "@open-erp/contracts/workspace";
import * as Effect from "effect/Effect";
import * as Context from "@open-erp/domain/agent-context";
import * as Result from "effect/Result";
import { readContextResolutions } from "../../db/workspace";
import * as Db from "../../db/agent-context";
import type { Transaction } from "../../db/transaction";
import { decode, toJsonObject, withBook, type Principal, type Scope } from "../commerce/support";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { failure } from "../failures";
import { captureBookContextInTransaction } from "./context";

type View = typeof Workspace.BookContextView.Type;

type Capture = typeof Workspace.ContextCapture.Type;

type Progress = typeof Workspace.ContextProgress.Type;

const pageSize = 50;

function inventoryBasis(view: View) {
  const snapshot = Object.fromEntries(
    Object.entries(view.snapshot).filter(
      ([name]) => !["recordedCutoff", "contentDigest", "id"].includes(name),
    ),
  );

  return { scope: view.scope, snapshot, ranked: view.ranked };
}

const retained = Effect.fn("agent.context.retained")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  captureId: string,
) {
  const row = (yield* Db.readCapture(tx, scope.bookId, principal.actorId, captureId))[0];

  if (!row) return yield* failure("NotFound");
  const capture = yield* decode(Workspace.ContextCapture, row.body);
  const inventory = yield* decode(Workspace.BookContextView, row.inventory);

  if (
    capture.scope.entityId !== scope.entityId ||
    capture.actorId !== principal.actorId ||
    capture.digest !== (yield* digest(inventoryBasis(inventory)))
  )
    return yield* failure("StaleDependency");

  const saved = (yield* Db.readProgress(tx, scope.bookId, principal.actorId, captureId))[0];

  const progress = saved
    ? yield* decode(Workspace.ContextProgress, saved.body)
    : {
        captureId,
        revision: "0",
        position: "0",
        recordedAt: capture.createdAt,
      };

  return { capture, inventory, progress };
});

const page = Effect.fn("agent.context.page")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  stored: { capture: Capture; inventory: View; progress: Progress },
  after?: string,
) {
  const offset = BigInt(after ?? stored.progress.position);
  const ordered = stored.inventory.snapshot.work;

  if (
    offset < 0n ||
    offset > BigInt(ordered.length) ||
    (offset % BigInt(pageSize) !== 0n && offset !== BigInt(ordered.length))
  )
    return yield* failure("InvalidJournal");

  const items = ordered.slice(Number(offset), Number(offset) + pageSize);
  const end = Number(offset) + items.length;

  const fresh = yield* captureBookContextInTransaction(tx, principal, {
    scope,
    input: stored.capture.query,
  });

  const current = (yield* digest(inventoryBasis(fresh))) === stored.capture.digest;
  const next = end < ordered.length ? String(end) : null;
  const remaining = ordered.slice(end);

  return yield* decode(
    Workspace.ContextPage,
    yield* toJsonObject({
      capture: stored.capture,
      offset: offset.toString(),
      items,
      next,
      current,
      pageDigest: yield* digest({
        captureId: stored.capture.id,
        digest: stored.capture.digest,
        offset: offset.toString(),
        items,
        next,
      }),
      progress: stored.progress,
      modules: stored.inventory.snapshot.modules.map((module) => ({
        ...module,
        hasContinuation: remaining.some(
          (item) =>
            item.owner === module.owner ||
            (module.owner === "journal" && item.owner === "change_sets"),
        ),
      })),
      ranked: {
        orderedIdentities: stored.inventory.ranked.orderedIdentities.filter((id) =>
          items.some((item) => item.identity === id),
        ),
        questions: stored.inventory.ranked.questions
          .map((question) => ({
            ...question,
            affectedRefs: question.affectedRefs.filter((id) =>
              items.some((item) => item.immutableRef === id),
            ),
          }))
          .filter((question) => question.affectedRefs.length > 0)
          .map((question) => ({
            ...question,
            distinctEffects: String(question.affectedRefs.length),
          })),
      },
    }),
  );
});

export const captureAgentContext = Effect.fn("agent.context.capture")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Workspace.AgentContextQuery.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const operation = "capture_agent_context";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: command.input,
        },
        Workspace.ContextCapture,
        Effect.gen(function* () {
          const inventory = yield* captureBookContextInTransaction(tx, principal, command);

          const capture = yield* decode(
            Workspace.ContextCapture,
            yield* toJsonObject({
              id: newId("context_capture"),
              scope: command.scope,
              actorId: principal.actorId,
              query: command.input,
              digest: yield* digest(inventoryBasis(inventory)),
              createdAt: yield* isoNow(tx),
              total: String(inventory.snapshot.work.length),
            }),
          );

          yield* Db.insertCapture(tx, {
            bookId: command.scope.bookId,
            id: capture.id,
            actorId: principal.actorId,
            body: yield* toJsonObject(capture),
            inventory: yield* toJsonObject(inventory),
          });

          return { receipt: yield* toJsonObject(capture), result: capture };
        }),
      );
    },
    "update",
  );
});

export const getAgentContextPage = Effect.fn("agent.context.getPage")(function* (
  token: string,
  command: { scope: Scope; captureId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    const stored = yield* retained(tx, principal, command.scope, command.captureId);

    return yield* page(tx, principal, command.scope, stored, command.after);
  });
});

export const getAgentContextDelta = Effect.fn("agent.context.delta")(function* (
  token: string,
  command: { scope: Scope; captureId: string; targetId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    const base = yield* retained(tx, principal, command.scope, command.captureId);
    const target = yield* retained(tx, principal, command.scope, command.targetId);

    if (
      base.capture.query.goal !== target.capture.query.goal ||
      base.capture.query.period !== target.capture.query.period
    )
      return yield* failure("StaleDependency");

    const fresh = yield* captureBookContextInTransaction(tx, principal, {
      scope: command.scope,
      input: target.capture.query,
    });

    if ((yield* digest(inventoryBasis(fresh))) !== target.capture.digest)
      return yield* failure("StaleDependency");

    const keyOf = (item: Context.WorkRef) => `${item.owner}\u0000${item.identity}`;

    const keys = [
      ...new Set([...base.inventory.snapshot.work, ...target.inventory.snapshot.work].map(keyOf)),
    ].sort();

    const offset = BigInt(command.after ?? "0");

    if (offset > BigInt(keys.length) || offset % 50n !== 0n)
      return yield* failure("InvalidJournal");

    const selected = new Set(keys.slice(Number(offset), Number(offset) + pageSize));
    const baseWork = base.inventory.snapshot.work.filter((item) => selected.has(keyOf(item)));
    const targetWork = target.inventory.snapshot.work.filter((item) => selected.has(keyOf(item)));

    const absent = baseWork.filter(
      (item) => !targetWork.some((entry) => keyOf(entry) === keyOf(item)),
    );

    const completed =
      absent.length === 0
        ? []
        : yield* readContextResolutions(
            tx,
            command.scope.bookId,
            absent.map((item) => item.identity),
          );

    const resolved = absent
      .filter((item) =>
        completed.some(
          (row) =>
            row.id === item.identity &&
            row.kind === (item.owner === "change_sets" ? "journal" : item.owner),
        ),
      )
      .map((item) => item.immutableRef);

    const delta = Context.getContextDelta({
      base: { ...base.inventory.snapshot, work: baseWork },
      target: { ...target.inventory.snapshot, work: targetWork },
      ownerReportedResolved: resolved,
      confirmedScopeChanges: [],
    });

    if (Result.isFailure(delta) || delta.success.kind !== "delta")
      return yield* failure("StaleDependency");

    const end = Number(offset) + selected.size;

    return yield* decode(
      Workspace.ContextDeltaPage,
      yield* toJsonObject({
        baseId: base.capture.id,
        targetId: target.capture.id,
        baseDigest: base.capture.digest,
        targetDigest: target.capture.digest,
        offset: offset.toString(),
        entries: delta.success.entries,
        next: end < keys.length ? String(end) : null,
      }),
    );
  });
});

export const advanceAgentContext = Effect.fn("agent.context.advance")(function* (
  token: string,
  command: {
    scope: Scope;
    captureId: string;
    idempotencyKey: string;
    input: typeof Workspace.AdvanceContext.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const operation = "advance_agent_context";

      return yield* runBookCommandWithReceipt(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { id: command.captureId, input: command.input },
        },
        Workspace.ContextProgress,
        Effect.gen(function* () {
          const stored = yield* retained(tx, principal, command.scope, command.captureId);

          if (stored.progress.revision !== command.input.expectedRevision)
            return yield* failure("StaleDependency");

          const next = yield* page(tx, principal, command.scope, stored);

          if (!next.current || next.pageDigest !== command.input.pageDigest)
            return yield* failure("StaleDependency");

          const position = BigInt(next.offset) + BigInt(next.items.length);

          if (position === BigInt(stored.progress.position)) return yield* failure("AlreadyPosted");

          const progress = yield* decode(
            Workspace.ContextProgress,
            yield* toJsonObject({
              captureId: command.captureId,
              revision: (BigInt(stored.progress.revision) + 1n).toString(),
              position: position.toString(),
              recordedAt: yield* isoNow(tx),
            }),
          );

          yield* Db.insertProgress(tx, {
            bookId: command.scope.bookId,
            captureId: command.captureId,
            actorId: principal.actorId,
            revision: BigInt(progress.revision),
            position,
            body: yield* toJsonObject(progress),
          });

          return { receipt: yield* toJsonObject(progress), result: progress };
        }),
      );
    },
    "update",
  );
});
