import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
import { inArray, sql } from "drizzle-orm";
import { Job, JobStore } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  claimPendingPreparationJobs,
  executePreparationJob,
  stopFailedPreparationDelivery,
} from "../application/preparation-jobs";
import {
  claimPendingSupplierExtractions,
  runSupplierExtraction,
} from "../application/purchases/extraction";
import { advancePeriodWork, claimOpenPeriodWorkRuns } from "../application/period-work";
import { failure } from "../application/failures";
import { Database } from "../db/connection";
import { jobAttempts, jobs } from "../db/schema";
import { databaseFailure } from "../db/transaction";
import { RequestEnvironment } from "./environment";

export class PreparationQueue extends Job.make("preparation", {
  payload: {
    jobId: Accounting.Identifier,
    scope: Accounting.Scope,
    checkpoint: Schema.Int,
  },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: preparationKey,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

// Supplier extraction reuses the selected effect-mq runner rather than a second
// queue runtime. The admitted request row is the application-owned intent; this
// queue owns scheduling, claims and retries, and the handler converges on the one
// recorded result identity per request.
export class ExtractionQueue extends Job.make("supplier-extraction", {
  payload: {
    requestId: Accounting.Identifier,
    scope: Accounting.Scope,
  },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: extractionKey,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

type ExtractionPayload = {
  readonly requestId: string;
  readonly scope: typeof Accounting.Scope.Type;
};

function extractionKey(payload: ExtractionPayload) {
  return `${payload.scope.bookId}/${payload.requestId}`;
}

// Period-work advance reuses the same selected effect-mq runner and the same
// queue. effect-mq owns the claim, the retry and the lease; the child revision
// fence in the application owns the domain result, so a redelivered handler
// cannot publish twice.
export class PeriodWorkQueue extends Job.make("period-work", {
  payload: {
    manifestId: Accounting.Identifier,
    scope: Accounting.Scope,
    boundedCount: Schema.Int,
  },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: periodWorkKey,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

type PeriodWorkPayload = {
  readonly manifestId: string;
  readonly scope: typeof Accounting.Scope.Type;
  readonly boundedCount: number;
};

function periodWorkKey(payload: PeriodWorkPayload) {
  return `${payload.scope.bookId}/${payload.manifestId}/${payload.boundedCount}`;
}

type PreparationPayload = {
  readonly jobId: string;
  readonly scope: typeof Accounting.Scope.Type;
  readonly checkpoint: number;
};

function preparationKey(payload: PreparationPayload) {
  return `${payload.scope.bookId}/${payload.jobId}/${payload.checkpoint}`;
}

// effect-mq prefixes the idempotency key with the job name.
function preparationRecordId(payload: PreparationPayload) {
  return `${PreparationQueue._tag}/${preparationKey(payload)}`;
}

// Attempt history survives retries and bounds automatic rearming.
const rearmGenerations = 2;

type QueueRecord = {
  readonly state: string;
  readonly attemptsMade: number;
  readonly attemptsMax: number;
};

type QueueSnapshot = {
  readonly records: ReadonlyMap<JobStore.JobId, QueueRecord>;
  readonly recorded: ReadonlyMap<JobStore.JobId, number>;
};

function readQueueSnapshot(ids: ReadonlyArray<JobStore.JobId>) {
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

function dispatchPreparation(
  job: typeof PreparationJob.Type,
  snapshot: QueueSnapshot,
): Effect.Effect<
  unknown,
  Accounting.AccountingError,
  Database | RequestEnvironment | JobStore.JobStore
> {
  const payload = { jobId: job.id, scope: job.scope, checkpoint: job.checkpoint };
  const id = JobStore.JobId(preparationRecordId(payload));
  const record = snapshot.records.get(id);

  if (record?.state === "cancelled") return stopFailedPreparationDelivery(payload);

  if (
    record === undefined ||
    record.state !== "failed" ||
    record.attemptsMade < record.attemptsMax
  ) {
    return PreparationQueue.enqueue(payload).pipe(Effect.asVoid);
  }

  const recorded = snapshot.recorded.get(id) ?? 0;

  if (recorded >= record.attemptsMax * (1 + rearmGenerations)) {
    return stopFailedPreparationDelivery(payload);
  }

  // Retrying preserves the checkpoint; application receipts prevent duplicate work.
  return PreparationQueue.retry(id).pipe(
    Effect.catchTags({
      JobNotFoundError: () => Effect.void,
      JobNotRetryableError: () => Effect.void,
    }),
  );
}

export const dispatchPendingPreparations = Effect.fn("Preparation.dispatchPending")(function* () {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  const pending = yield* claimPendingPreparationJobs(bindings.OPENERP_PREPARATION_TOKEN);

  if (pending.length === 0) return;

  const snapshot = yield* readQueueSnapshot(
    pending.map((job) =>
      JobStore.JobId(
        preparationRecordId({ jobId: job.id, scope: job.scope, checkpoint: job.checkpoint }),
      ),
    ),
  );

  yield* Effect.forEach(
    pending,
    (job) =>
      dispatchPreparation(job, snapshot).pipe(
        // The store is reached through the defect channel, so one unreachable
        // queue row must not end the polling fiber. The admission stays durable
        // either way and the next poll picks the same job up again.
        Effect.catchDefect(() =>
          Effect.logWarning("Preparation enqueue failed; admission remains durable."),
        ),
      ),
    { concurrency: 5, discard: true },
  );
});

export const dispatchPendingExtractions = Effect.fn("Extraction.dispatchPending")(function* () {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  const pending = yield* claimPendingSupplierExtractions(bindings.OPENERP_PREPARATION_TOKEN);

  yield* Effect.forEach(
    pending,
    (request) =>
      ExtractionQueue.enqueue({
        requestId: request.requestId,
        scope: { entityId: request.entityId, bookId: request.bookId },
      }).pipe(
        // The store is reached through the defect channel, so one unreachable queue
        // row must not end the polling fiber. The admission stays durable either
        // way and the next poll picks the same request up again.
        Effect.catchDefect(() =>
          Effect.logWarning("Extraction enqueue failed; admission remains durable."),
        ),
      ),
    { concurrency: 5, discard: true },
  );
});

export const handleExtraction = Effect.fn("Extraction.handleQueueJob")(function* (payload: {
  requestId: string;
  scope: typeof Accounting.Scope.Type;
}) {
  return yield* runSupplierExtraction(payload.scope, payload.requestId);
});

const periodWorkRunBound = 20;

// The bounded count one queued pass visits. It bounds work per turn; it is never
// the size of a manifest.
const periodWorkBoundedCount = 20;

export const dispatchPendingPeriodWork = Effect.fn("PeriodWork.dispatchPending")(function* () {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");

  const pending = yield* claimOpenPeriodWorkRuns(
    bindings.OPENERP_PREPARATION_TOKEN,
    periodWorkRunBound,
    periodWorkBoundedCount,
  );

  yield* Effect.forEach(
    pending,
    (run) =>
      PeriodWorkQueue.enqueue({
        manifestId: run.manifestId,
        scope: { entityId: run.entityId, bookId: run.bookId },
        boundedCount: run.boundedCount,
      }).pipe(
        // The store is reached through the defect channel, so one unreachable
        // queue row must not end the polling fiber. The child fence keeps the
        // next poll from double-publishing either way.
        Effect.catchDefect(() =>
          Effect.logWarning("Period work enqueue failed; the run stays open."),
        ),
      ),
    { concurrency: 5, discard: true },
  );
});

export const handlePreparation = Effect.fn("Preparation.handleQueueJob")(function* (payload: {
  jobId: string;
  scope: typeof Accounting.Scope.Type;
  checkpoint: number;
}) {
  let checkpoint = payload.checkpoint;

  for (let count = 0; count < 50; count++) {
    const result = yield* executePreparationJob(payload, checkpoint);

    if (result.state !== "ready") return result.state;
    checkpoint = result.checkpoint;
  }

  return "ready";
});

/**
 * The period-work handler.
 *
 * It calls one bounded advance with the runner's own token and reports what is
 * left, so the queue's retry and the application's child fence each do their own
 * job. The result is the honest progress projection: it never claims the period
 * is reconciled, because only the separate source and control inventory can.
 */
export const handlePeriodWork = Effect.fn("PeriodWork.handleQueueJob")(function* (payload: {
  manifestId: string;
  scope: typeof Accounting.Scope.Type;
  boundedCount: number;
}) {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");

  const progress = yield* advancePeriodWork(bindings.OPENERP_PREPARATION_TOKEN, {
    scope: { entityId: payload.scope.entityId, bookId: payload.scope.bookId },
    manifestId: payload.manifestId,
    // The queue's own identity is the stable key here: the same manifest at the
    // same bounded count is the same command, so a redelivery recovers rather
    // than re-deciding.
    idempotencyKey: periodWorkKey(payload),
    input: { boundedCount: payload.boundedCount },
  });

  return progress.counts.pending === 0 ? "settled" : "ready";
});
