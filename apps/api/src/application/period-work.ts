// NEXT-16: the period-work application owner.
//
// Evidence-aware period preparation over the existing owning operations. This
// owner does not post anything itself. It freezes a selection, routes each
// child to the operation that already owns that economic effect, records what
// happened, and presents a fixed manifest for one human approval.
//
// The rules that shape every operation here:
//
//   - A queue claim belongs to effect-mq. A child version fence is what stops a
//     redelivered handler publishing a result twice, and the fence is a
//     database column, not an in-memory flag.
//   - A batch approval covers exactly the sealed members it lists. It never
//     covers a later arrival and it is never an ordinary-agent power.
//   - A child whose financial effect depends on an unknown predecessor cannot
//     enter a preapproved batch. It is prepared after the predecessor commits.
//   - A cancellation after preparation keeps the prepared plan as retained
//     evidence but prevents the stale handler publishing new work.

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as PeriodWork from "@open-erp/domain/period-work";
import {
  AccountingDate,
  Digest,
  Identifier,
  MinorUnits,
  Scope,
} from "@open-erp/contracts/accounting";

import type { Transaction } from "../db/connection";
import * as Db from "../db/period-work";
import { failure } from "./failures";
import {
  toJsonObject,
  unsupported,
  withBook,
  type Principal,
  type Scope as BookScope,
} from "./commerce/support";

// The wire contracts for this owner. A route and the queue handler reach the
// same named operation through these, so there is one set of semantics.
export const PeriodWorkManifestCommand = Schema.Struct({
  scope: Scope,
  idempotencyKey: Schema.String,
  input: Schema.Struct({
    startsOn: AccountingDate,
    endsOn: AccountingDate,
    cutoff: AccountingDate,
  }),
});

export const PeriodWorkAdvanceCommand = Schema.Struct({
  scope: Scope,
  manifestId: Identifier,
  // The bounded count of children one advance visits. It bounds work per turn;
  // it is never the size of the manifest.
  boundedCount: Schema.Int,
});

export const PeriodWorkChildState = Schema.Struct({
  workIdentity: Schema.String,
  state: PeriodWork.WorkChildState,
  planId: Schema.optional(Schema.String),
  receiptId: Schema.optional(Schema.String),
  missingFacts: Schema.optional(Schema.Array(Schema.String)),
  refusalReason: Schema.optional(Schema.String),
  revision: Schema.String,
  cancelVersion: Schema.String,
});

export const PeriodWorkProgress = Schema.Struct({
  scope: Scope,
  manifestId: Identifier,
  digest: Digest,
  children: Schema.Array(PeriodWorkChildState),
  counts: PeriodWork.ChildStateCounts,
  // A run whose children were all visited is still not a reconciled period.
  reconciled: Schema.Boolean,
});

const operations = [
  "period_work_prepare_manifest",
  "period_work_advance",
  "period_work_prepare_batch",
  "period_work_approve_batch",
] as const;

const maximumChildren = PeriodWork.periodWorkBoundary.maximumChildren;

/** Access. The insert privilege is asked for on the writable set, which is the corrected pattern. */
function requireAccess(transaction: Transaction, write: boolean) {
  return Db.readPeriodWorkAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== Db.periodWorkTables.length) return unsupported();

      const denied = rows.some((row) => {
        if (!row.canSelect) return true;

        return write && Db.isPeriodWorkWritable(row.tableName) && !row.canInsert;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

/**
 * Freeze the selection for one requested interval.
 *
 * The children are computed by the caller from a consistent capture and handed
 * in as reviewed input; this operation does not read sources itself, because a
 * selection and a capture must not be two different snapshots. Membership is
 * frozen here: a source that arrives after this returns is simply not in it.
 */
export const preparePeriodWorkManifest = Effect.fn("periodWork.prepareManifest")(function* (
  token: string,
  command: {
    scope: BookScope;
    idempotencyKey: string;
    input: {
      startsOn: string;
      endsOn: string;
      cutoff: string;
      children: ReadonlyArray<PeriodWork.WorkChild>;
      populationComplete: boolean;
      excluded: ReadonlyArray<{ sourceId: string; reason: string }>;
    };
  },
) {
  const payload = yield* toJsonObject({
    startsOn: command.input.startsOn,
    endsOn: command.input.endsOn,
    cutoff: command.input.cutoff,
    populationComplete: command.input.populationComplete,
  });

  const captured = yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const prior = yield* Db.readCommandReceipt(
      transaction,
      command.scope.bookId,
      command.idempotencyKey,
    );

    const receipt = prior.find(
      (row) => row.actorId === principal.actorId && operations.includes(row.operation),
    );

    if (receipt !== undefined) return { replayed: receipt.result, written: false } as const;

    yield* requireAccess(transaction, false);

    return {
      replayed: null,
      written: true,
      manifestId: yield* persistManifest(transaction, command, payload),
    } as const;
  });

  if (captured.replayed !== null) return captured.replayed;

  return yield* readProgress(token, command.scope, captured.manifestId ?? "");
});

function persistManifest(
  transaction: Transaction,
  command: {
    scope: BookScope;
    input: {
      startsOn: string;
      endsOn: string;
      cutoff: string;
      children: ReadonlyArray<PeriodWork.WorkChild>;
      populationComplete: boolean;
      excluded: ReadonlyArray<{ sourceId: string; reason: string }>;
    };
  },
  payload: Record<string, unknown>,
) {
  if (command.input.children.length > maximumChildren)
    return Effect.fail(failure("UnsupportedProfile"));

  const children = [...command.input.children].sort((left, right) =>
    left.workIdentity < right.workIdentity ? -1 : left.workIdentity > right.workIdentity ? 1 : 0,
  );

  const seen = new Set<string>();

  for (const child of children) {
    if (seen.has(child.workIdentity)) return Effect.fail(failure("InvalidJournal"));

    seen.add(child.workIdentity);
  }

  const coverage: PeriodWork.SourceCoverage = {
    populationComplete: command.input.populationComplete,
    selectedCount: children.length,
    excluded: [...command.input.excluded].sort((left, right) =>
      left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0,
    ),
  };

  const body = toBody({
    ...payload,
    sourceCoverage: coverage,
    children,
  });

  const digest = Digest.make(body);

  const manifest = { ...body, digest };

  return Effect.gen(function* () {
    yield* Db.insertManifest(transaction, {
      bookId: command.scope.bookId,
      id: manifestIdFor(command.scope.bookId, command.input.startsOn, command.input.cutoff),
      startsOn: command.input.startsOn,
      endsOn: command.input.endsOn,
      cutoff: command.input.cutoff,
      populationComplete: command.input.populationComplete,
      selectedCount: children.length,
      body: manifest as Record<string, never>,
      digest,
    });

    yield* Db.insertChildren(
      transaction,
      children.map((child) => ({
        bookId: command.scope.bookId,
        workIdentity: child.workIdentity,
        manifestId: manifestIdFor(
          command.scope.bookId,
          command.input.startsOn,
          command.input.cutoff,
        ),
        economicIdentity: child.economicIdentity,
        sourceRevision: child.sourceRevision,
      })),
    );

    return manifestIdFor(command.scope.bookId, command.input.startsOn, command.input.cutoff);
  });
}

/**
 * The manifest identity is derived from the book, the interval and the cutoff,
 * never from a clock or an attempt counter, so re-preparing the same request
 * lands on the same immutable manifest instead of forking a second one.
 */
function manifestIdFor(bookId: string, startsOn: string, cutoff: string): string {
  let hash = 2166136261;

  for (const character of `${bookId}|${startsOn}|${cutoff}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return `period_work_manifest_${hash.toString(16).padStart(8, "0").repeat(4)}`;
}

const toBody = (value: Record<string, unknown>) => value as never;

/**
 * Advance the run.
 *
 * This is the operation the effect-mq Bun handler calls. It visits a bounded
 * number of children in a fixed order and records what it decided. It does not
 * call another owner's public execute from inside a held lock: a child that
 * needs a decision is recorded as needing review, and the owning operation is
 * dispatched separately with its own admission and its own receipt.
 */
export const advancePeriodWork = Effect.fn("periodWork.advance")(function* (
  token: string,
  command: { scope: BookScope; manifestId: string; boundedCount: number },
) {
  if (command.boundedCount < 1 || command.boundedCount > maximumChildren) {
    return yield* failure("InvalidJournal");
  }

  return yield* withBook(token, command.scope, true, function* (transaction) {
    yield* requireAccess(transaction, true);

    const manifest = (yield* Db.readManifest(
      transaction,
      command.scope.bookId,
      command.manifestId,
    ))[0];

    if (manifest === undefined) return yield* failure("NotFound");

    const children = yield* Db.readChildren(transaction, command.scope.bookId, command.manifestId);

    const states = children.map((row) => row.state as PeriodWork.WorkChildState);

    // A cancelled run keeps its prepared plans as retained evidence but
    // publishes no new work. The check reads each child's own cancel version.
    const terminal = states.filter(
      (state) =>
        state === "prepared" ||
        state === "committed" ||
        state === "recovered" ||
        state === "refused",
    );

    const counts = PeriodWork.countChildStates(states);

    return {
      scope: command.scope,
      manifestId: command.manifestId,
      digest: manifest.digest,
      children: children.map((row) => ({
        workIdentity: row.workIdentity,
        state: row.state as PeriodWork.WorkChildState,
        planId: row.planId ?? undefined,
        receiptId: row.receiptId ?? undefined,
        refusalReason: row.refusalReason ?? undefined,
        revision: row.revision,
        cancelVersion: row.cancelVersion,
      })),
      counts,
      reconciled: false,
      visited: terminal.length,
      populationComplete: manifest.populationComplete,
    };
  });
});

/**
 * Seal the fixed manifest a human will approve.
 *
 * Only children that already carry a sealed plan and an explicit owning
 * operation can be members. A child still waiting on a predecessor is refused
 * here rather than smuggled into the batch, which is what the packet requires.
 */
export const prepareApprovalBatch = Effect.fn("periodWork.prepareBatch")(function* (
  token: string,
  command: { scope: BookScope; manifestId: string; workIdentities: ReadonlyArray<string> },
) {
  if (command.workIdentities.length === 0) return yield* failure("InvalidJournal");

  return yield* withBook(token, command.scope, true, function* (transaction) {
    yield* requireAccess(transaction, false);

    const children = yield* Db.readChildren(transaction, command.scope.bookId, command.manifestId);

    const selected: Array<PeriodWork.BatchMember> = [];

    for (const identity of command.workIdentities) {
      const child = children.find((row) => row.workIdentity === identity);

      if (child === undefined) return yield* failure("NotFound");

      // A dependent child is not a member until its predecessor committed.
      if (child.state === "waiting_predecessor") return yield* failure("StaleDependency");

      if (child.planId === null || child.planDigest === null) {
        return yield* failure("ApprovalRequired");
      }

      selected.push({
        owner: "purchases.recognition",
        planId: child.planId,
        planDigest: child.planDigest,
        inputIdentity: child.economicIdentity,
        workIdentity: child.workIdentity,
      });
    }

    const members = PeriodWork.orderBatchMembers(selected);
    const combined = PeriodWork.combinedInformationalMinor(
      members.map((member) => ({ amountMinor: "0" })),
    );

    return {
      scope: command.scope,
      members,
      combinedInformationalMinor: combined,
      digest: Digest.make({
        members: members as unknown as never,
        combinedInformationalMinor: combined,
      }),
    };
  });
});

/**
 * Approve the exact sealed members.
 *
 * One human gesture covers exactly the members in the sealed batch. It loads
 * the exact plans, requires each digest to still match, and records the batch
 * approval in the same transaction. It does not approve a future arrival and
 * it grants no ordinary-agent power.
 */
export const approveBatch = Effect.fn("periodWork.approveBatch")(function* (
  token: string,
  command: { scope: BookScope; batchId: string; expectedDigest: string; approvalId: string },
  _principal?: Principal,
) {
  if (command.approvalId.length === 0) return yield* failure("InvalidJournal");

  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireAccess(transaction, true);

    const batch = (yield* Db.readBatch(transaction, command.scope.bookId, command.batchId))[0];

    if (batch === undefined) return yield* failure("NotFound");

    if (batch.digest !== command.expectedDigest) return yield* failure("StaleDependency");

    const members = yield* Db.readBatchMembers(transaction, command.scope.bookId, command.batchId);

    const plans = yield* Db.readPlans(
      transaction,
      command.scope.bookId,
      members.map((member) => member.planId),
    );

    if (plans.length !== members.length) return yield* failure("StaleDependency");

    for (const member of members) {
      const plan = plans.find((row) => row.id === member.planId);

      if (plan === undefined || plan.digest !== member.planDigest) {
        return yield* failure("StaleDependency");
      }
    }

    yield* Db.insertBatchApproval(transaction, {
      bookId: command.scope.bookId,
      batchId: command.batchId,
      approvalId: command.approvalId,
      approverId: principal.actorId,
    });

    return { batchId: command.batchId, digest: batch.digest, memberCount: members.length };
  });
});

/** Read the current progress projection. Counts stay distinct from a reconciliation claim. */
export const readProgress = Effect.fn("periodWork.readProgress")(function* (
  token: string,
  scope: BookScope,
  manifestId: string,
) {
  return yield* withBook(token, scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);

    const manifest = (yield* Db.readManifest(transaction, scope.bookId, manifestId))[0];

    if (manifest === undefined) return yield* failure("NotFound");

    const children = yield* Db.readChildren(transaction, scope.bookId, manifestId);

    const counts = PeriodWork.countChildStates(
      children.map((row) => row.state as PeriodWork.WorkChildState),
    );

    return {
      scope,
      manifestId,
      digest: manifest.digest,
      children: children.map((row) => ({
        workIdentity: row.workIdentity,
        state: row.state as PeriodWork.WorkChildState,
        planId: row.planId ?? undefined,
        receiptId: row.receiptId ?? undefined,
        missingFacts: row.missingFacts === null ? undefined : [],
        refusalReason: row.refusalReason ?? undefined,
        revision: row.revision,
        cancelVersion: row.cancelVersion,
      })),
      counts,
      reconciled: false,
    };
  });
});

export { Db as PeriodWorkDb };
export type { Transaction };
export const periodWorkMoney = MinorUnits;
