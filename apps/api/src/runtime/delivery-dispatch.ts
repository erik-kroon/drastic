import { inArray, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type { JobStore } from "effect-mq";
import * as Accounting from "@open-erp/contracts/accounting";
import { Database } from "../db/connection";
import { jobAttempts, jobs } from "../db/schema";
import { databaseFailure } from "../db/transaction";
import { RequestEnvironment } from "./environment";

/**
 * What the queue already did to one durable record, and what the dispatcher may
 * do about it.
 *
 * Every job kind here carries a deterministic idempotency key, so the store
 * admits a repeat with `ON CONFLICT DO NOTHING` and reports it as a duplicate.
 * That is right for a redelivery and wrong for a recovery: after its attempts are
 * spent a job row is terminally `failed`, and every later enqueue is a silent
 * no-op that changes nothing and is reported nowhere. A dispatcher that only
 * enqueues therefore stops delivering while its own claim query keeps selecting
 * the intent forever, and for supplier extraction a reviewed counter grows until
 * its ceiling stops the claim transaction for every other request in the
 * installation.
 *
 * So the dispatcher reads the queue state and decides. It never acknowledges an
 * intent: acknowledgement is the statement that the effect happened, and only the
 * owning operation knows that.
 */

export type QueueRecord = {
  readonly state: string;
  readonly attemptsMade: number;
  readonly attemptsMax: number;
};

export type QueueSnapshot = {
  readonly records: ReadonlyMap<JobStore.JobId, QueueRecord>;
  readonly recorded: ReadonlyMap<JobStore.JobId, number>;
};

// Attempt history survives retries, so the recorded attempt rows, not the
// per-row counter a rearm resets, are what bounds automatic rearming. One
// constant, one meaning: a job may be rearmed this many times and then stops
// being enqueued.
export const rearmGenerations = 2;

export function readQueueSnapshot(ids: ReadonlyArray<JobStore.JobId>) {
  return Effect.gen(function* () {
    const db = yield* Database;

    const records = yield* db
      .select({
        id: jobs.id,
        state: jobs.state,
        attemptsMade: jobs.attemptsMade,
        attemptsMax: jobs.attemptsMax,
      })
      .from(jobs)
      .where(inArray(jobs.id, [...ids]))
      .pipe(Effect.mapError(databaseFailure));

    const recorded = yield* db
      .select({ id: jobAttempts.jobId, total: sql<number>`count(*)::integer` })
      .from(jobAttempts)
      .where(inArray(jobAttempts.jobId, [...ids]))
      .groupBy(jobAttempts.jobId)
      .pipe(Effect.mapError(databaseFailure));

    return {
      records: new Map(records.map((row) => [row.id, row])),
      recorded: new Map(recorded.map((row) => [row.id, row.total])),
    };
  });
}

export type DispatchContext = Database | RequestEnvironment | JobStore.JobStore;

type Unrearmable = Effect.Effect<
  unknown,
  JobStore.JobNotFoundError | JobStore.JobNotRetryableError,
  DispatchContext
>;

function deliveryDecision(record: QueueRecord | undefined, recorded: number) {
  // A cancelled record is an operator's decision and is never rearmed.
  if (record?.state === "cancelled") return "settle" as const;

  if (record === undefined) return "enqueue" as const;

  if (record.state !== "failed") return "enqueue" as const;

  if (record.attemptsMade < record.attemptsMax) return "settle" as const;

  return recorded >= record.attemptsMax * (1 + rearmGenerations)
    ? ("settle" as const)
    : ("rearm" as const);
}

// `retry` only accepts a terminally failed row and resets its attempt counter, so
// it is never called for another state: a waiting or running row would have its
// attempts cleared underneath its own handler. The row may also have been removed
// or rearmed by something else in between, which is not the dispatcher's error.
export function ignoreUnrearmable(effect: Unrearmable) {
  return effect.pipe(
    Effect.catchTags({
      JobNotFoundError: () => Effect.void,
      JobNotRetryableError: () => Effect.void,
    }),
  );
}

/**
 * The failure codes a retry provably cannot change.
 *
 * A job that is not retried still records its typed failure in its exit, so
 * skipping the remaining attempts discards no evidence; it only stops the
 * re-delivery of a request that will be refused the same way. Everything not
 * named here is retried, because the default cost of a wrong classification is
 * asymmetric: a needless retry costs a bounded wait, while a wrongly abandoned
 * attempt loses work that a human or a later state could still have completed.
 *
 * `Unavailable` and `InternalError` are transient by construction. `NotFound` can
 * be a claim race against a record that exists. `StaleDependency` and
 * `PeriodLocked` resolve on their own. `MissingEvidence` and `ApprovalRequired`
 * resolve when a human acts, and the same intent is still the right place to
 * notice. `AlreadyPosted` means the effect exists, so a retry has nothing to do
 * and is left to the budget rather than turned into a delivery failure.
 */
const terminalDeliveryFailures: ReadonlySet<Accounting.AccountingError["code"]> = new Set([
  // The same credential is refused again.
  "Unauthorized",
  // The same actor's authority for the same book and operation is refused again.
  "Forbidden",
  // This key already carries a different body, so the work is not this job's.
  "IdempotencyConflict",
  // Nothing in this repository can release the missing profile or rule at retry
  // time, so only a reviewed release can change the answer.
  "UnsupportedProfile",
]);

export function isTerminalDeliveryFailure(error: Accounting.AccountingError) {
  return terminalDeliveryFailures.has(error.code);
}

export function deliveryDispatch(
  recordId: JobStore.JobId,
  snapshot: QueueSnapshot,
  enqueue: Effect.Effect<unknown, never, DispatchContext>,
  rearm: Effect.Effect<unknown, never, DispatchContext>,
  settle: Effect.Effect<unknown, Accounting.AccountingError, DispatchContext>,
) {
  const decision = deliveryDecision(
    snapshot.records.get(recordId),
    snapshot.recorded.get(recordId) ?? 0,
  );

  if (decision === "enqueue") return enqueue.pipe(Effect.asVoid);

  if (decision === "rearm") return rearm;

  return settle;
}
