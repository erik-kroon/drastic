import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as Db from "../../db/sie-import";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, requireInsertAccess, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { checkControls } from "./source-controls";

type Identified = { readonly scope: Scope; readonly id: string };
type Command = Identified & { readonly idempotencyKey: string };

function readPreview(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readPreview(transaction, scope.bookId, id))[0];
    if (!row) return yield* failure("NotFound");
    return yield* decode(Sie.SiePreview, row.body);
  });
}

function readPlan(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readPlan(transaction, scope.bookId, id))[0];
    if (!row) return yield* failure("NotFound");
    return yield* decode(Sie.SiePlan, row.body);
  });
}

function readRun(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readRun(transaction, scope.bookId, id))[0];
    if (!row) return yield* failure("NotFound");
    return {
      ...row,
      leaseUntil: row.leaseUntil === null ? null : new Date(row.leaseUntil).toISOString(),
    };
  });
}

export const listSourcePreviews = Effect.fn("sie.listSourcePreviews")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    if (!(yield* Db.readSource(transaction, command.scope.bookId, command.id))[0])
      return yield* failure("NotFound");
    const rows = yield* Db.listPreviews(transaction, command.scope.bookId, command.id);
    if (rows.length > 50) return yield* failure("UnsupportedProfile");
    const items = yield* Effect.forEach(rows, (row) =>
      decode(Sie.SiePreview, row.body).pipe(
        Effect.map((preview) => ({
          id: preview.id,
          ordinal: preview.ordinal,
          encoding: preview.encoding,
          ready: preview.ready,
          createdAt: preview.createdAt,
          planId: row.planId,
          runId: row.runId,
        })),
      ),
    );
    return yield* decode(Sie.SiePreviewInventory, {
      scope: command.scope,
      occurrenceId: command.id,
      items,
    });
  });
});

export const captureSource = Effect.fn("sie.captureSource")(function* (
  token: string,
  command: Command & { readonly input: Schema.JsonObject },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const { scope, id, idempotencyKey, input } = command;
      const operation = "capture_sie_source";
      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { occurrenceId: id, preview: input },
        Sie.SiePreview,
      );
      if (request.previous) return request.previous;
      yield* requireInsertAccess(transaction, ["sie_source_previews", "command_receipts"]);
      const source = (yield* Db.readSource(transaction, scope.bookId, id))[0];
      if (!source) return yield* failure("NotFound");
      if (source.sha256 !== input.sourceSha256) return yield* failure("StaleDependency");
      const history = yield* Db.listPreviews(transaction, scope.bookId, id);
      if (history.some((row) => row.runId !== null)) return yield* failure("IdempotencyConflict");
      if (history.length >= 50) return yield* failure("UnsupportedProfile");
      const previous = history[0] ? yield* decode(Sie.SiePreview, history[0].body) : undefined;
      const body = Object.assign({}, input, {
        id: newId("siepreview"),
        scope,
        occurrenceId: id,
        createdBy: principal.actorId,
        ordinal: (previous?.ordinal ?? 0) + 1,
        createdAt: yield* isoNow(transaction),
      });
      const result = yield* decode(
        Sie.SiePreview,
        Object.assign({}, body, {
          digest: yield* digest(body),
          receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
        }),
      );
      if (
        result.records.length > 4000 ||
        result.vouchers.length > 500 ||
        new TextEncoder().encode(JSON.stringify(input)).length > 1048576
      )
        return yield* failure("UnsupportedProfile");
      yield* Db.insertPreview(transaction, scope.bookId, result.id, id, result.ordinal, result);
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const getSource = Effect.fn("sie.getSource")(function* (token: string, command: Identified) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    return yield* readPreview(transaction, command.scope, command.id);
  });
});

export const sealSourcePlan = Effect.fn("sie.sealSourcePlan")(function* (
  token: string,
  command: Command & { readonly input: typeof Sie.SealSiePlan.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { scope, id, idempotencyKey, input } = command;
      const operation = "seal_sie_source_plan";
      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { previewId: id, input },
        Sie.SiePlan,
      );
      if (request.previous) return request.previous;
      yield* requireInsertAccess(transaction, ["sie_source_plans", "command_receipts"]);
      const preview = yield* readPreview(transaction, scope, id);
      const source = (yield* Db.readSource(transaction, scope.bookId, preview.occurrenceId))[0];
      if (!source) return yield* failure("MissingEvidence");
      if (source.sourceSystem.startsWith("synthetic_") !== (input.sourceKind === "synthetic"))
        return yield* failure("UnsupportedProfile");
      const history = yield* Db.listPreviews(transaction, scope.bookId, preview.occurrenceId);
      if (history[0]?.body.id !== id) return yield* failure("StaleDependency");
      if (!preview.ready || input.digest !== preview.digest)
        return yield* failure("ApprovalRequired");
      if (history.some((row) => row.body.id === id && row.planId !== null))
        return yield* failure("IdempotencyConflict");
      const accounts = yield* PostingDb.readAccounts(transaction, scope.bookId, [
        ...new Set(input.mappings.map((m) => m.accountId)),
      ]);
      if (input.mappings.some((m) => !accounts.some((a) => a.id === m.accountId)))
        return yield* failure("InvalidJournal");
      yield* checkControls(preview, input);
      const body = {
        id: newId("sieplan"),
        scope,
        previewId: id,
        previewDigest: preview.digest,
        sourceSha256: preview.sourceSha256,
        input,
        voucherCount: preview.vouchers.length,
        createdBy: principal.actorId,
        createdAt: yield* isoNow(transaction),
        financialAdmission: "unsupported" as const,
        unreconstructableDetail: true as const,
      };
      const result = yield* decode(Sie.SiePlan, {
        ...body,
        digest: yield* digest(body),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      });
      yield* Db.insertPlan(transaction, scope.bookId, result.id, id, result);
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const getSourcePlan = Effect.fn("sie.getSourcePlan")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    return yield* readPlan(transaction, command.scope, command.id);
  });
});

export const startSourceRun = Effect.fn("sie.startSourceRun")(function* (
  token: string,
  command: Command & { readonly digest: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { scope, id, idempotencyKey } = command;
      const operation = "start_sie_source_run";
      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { planId: id, digest: command.digest },
        Sie.SieRunStart,
      );
      if (request.previous) return request.previous;
      yield* requireInsertAccess(transaction, ["sie_source_runs", "command_receipts"]);
      const plan = yield* readPlan(transaction, scope, id);
      if (plan.digest !== command.digest) return yield* failure("StaleDependency");
      const preview = yield* readPreview(transaction, scope, plan.previewId);
      const history = yield* Db.listPreviews(transaction, scope.bookId, preview.occurrenceId);
      if (history[0]?.body.id !== preview.id) return yield* failure("StaleDependency");
      if (history.some((row) => row.runId !== null)) return yield* failure("IdempotencyConflict");
      const row = {
        id: newId("sierun"),
        planId: id,
        nextOrdinal: 1,
        fence: "1",
        leaseUntil: new Date(Date.parse(yield* isoNow(transaction)) + 900000).toISOString(),
        status: "running" as const,
      };
      const result = yield* decode(Sie.SieRunStart, {
        ...row,
        planDigest: plan.digest,
        financialAdmission: "unsupported",
      });
      yield* Db.insertRun(transaction, scope.bookId, row);
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const getSourceRun = Effect.fn("sie.getSourceRun")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    const run = yield* readRun(transaction, command.scope, command.id);
    const plan = yield* readPlan(transaction, command.scope, run.planId);
    const chunks = yield* Db.listChunks(transaction, command.scope.bookId, run.id);
    return yield* decode(Sie.SieRun, {
      ...run,
      planDigest: plan.digest,
      voucherCount: plan.voucherCount,
      chunks: chunks.map((c) => c.body),
      financialAdmission: "unsupported",
    });
  });
});

export const advanceSourceRun = Effect.fn("sie.advanceSourceRun")(function* (
  token: string,
  command: Command & {
    readonly input: {
      readonly fence: string;
      readonly planDigest: string;
      readonly firstOrdinal: number;
    };
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { scope, id, idempotencyKey, input } = command;
      const operation = "advance_sie_source_run";
      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { runId: id, input },
        Sie.SieChunk,
      );
      if (request.previous) return request.previous;
      yield* requireInsertAccess(transaction, [
        "sie_source_vouchers",
        "sie_source_chunks",
        "command_receipts",
      ]);
      const run = yield* readRun(transaction, scope, id);
      const plan = yield* readPlan(transaction, scope, run.planId);
      const preview = yield* readPreview(transaction, scope, plan.previewId);
      const now = Date.parse(yield* isoNow(transaction));
      if (
        run.status !== "running" ||
        run.leaseUntil === null ||
        Date.parse(run.leaseUntil) <= now ||
        input.fence !== run.fence ||
        input.planDigest !== plan.digest ||
        input.firstOrdinal !== run.nextOrdinal
      )
        return yield* failure("StaleDependency");
      const firstOrdinal = run.nextOrdinal;
      const lastOrdinal = Math.min(plan.voucherCount, firstOrdinal + 199);
      if (firstOrdinal > plan.voucherCount) return yield* failure("IdempotencyConflict");
      const vouchers = preview.vouchers
        .filter((v) => v.ordinal >= firstOrdinal && v.ordinal <= lastOrdinal)
        .sort((a, b) => a.ordinal - b.ordinal);
      if (
        vouchers.length !== lastOrdinal - firstOrdinal + 1 ||
        vouchers.some((v, i) => v.ordinal !== firstOrdinal + i)
      )
        return yield* failure("MissingEvidence");
      if (vouchers.reduce((sum, v) => sum + v.transactions.length, 0) > 2000)
        return yield* failure("UnsupportedProfile");
      const result = yield* decode(Sie.SieChunk, {
        runId: id,
        planDigest: plan.digest,
        firstOrdinal,
        lastOrdinal,
        fence: run.fence,
        voucherCount: vouchers.length,
        membershipDigest: yield* digest(vouchers),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      });
      yield* Db.insertVouchers(transaction, scope.bookId, id, vouchers);
      yield* Db.insertChunk(transaction, scope.bookId, id, firstOrdinal, result);
      yield* Db.advanceRun(transaction, scope.bookId, {
        ...run,
        nextOrdinal: lastOrdinal + 1,
        leaseUntil: lastOrdinal === plan.voucherCount ? null : new Date(now + 900000).toISOString(),
        status: lastOrdinal === plan.voucherCount ? "staged" : "running",
      });
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});

export const reclaimSourceRun = Effect.fn("sie.reclaimSourceRun")(function* (
  token: string,
  command: Command & { readonly action: "pause" | "resume" },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { scope, id, idempotencyKey, action } = command;
      const operation = "reclaim_sie_source_run";
      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { runId: id, action },
        Sie.SieFence,
      );
      if (request.previous) return request.previous;
      const run = yield* readRun(transaction, scope, id);
      if (run.status === "staged") return yield* failure("InvalidJournal");
      if (BigInt(run.fence) >= 9223372036854775807n) return yield* failure("UnsupportedProfile");
      const updated = {
        ...run,
        fence: (BigInt(run.fence) + 1n).toString(),
        status: action === "pause" ? ("paused" as const) : ("running" as const),
        leaseUntil:
          action === "pause"
            ? null
            : new Date(Date.parse(yield* isoNow(transaction)) + 900000).toISOString(),
      };
      const result = yield* decode(Sie.SieFence, updated);
      yield* Db.advanceRun(transaction, scope.bookId, updated);
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );
      return result;
    },
    "update",
  );
});
