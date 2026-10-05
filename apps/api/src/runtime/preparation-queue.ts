import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
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
  stopFailedExtractionDelivery,
} from "../application/purchases/extraction";
import {
  advancePeriodWork,
  claimOpenPeriodWorkRuns,
  stopFailedPeriodWorkDelivery,
} from "../application/period-work";
import { failure } from "../application/failures";
import {
  deliveryDispatch,
  ignoreUnrearmable,
  isTerminalDeliveryFailure,
  readQueueSnapshot,
  type QueueSnapshot,
} from "./delivery-dispatch";
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
  retryable: (error) => !isTerminalDeliveryFailure(error),
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
  retryable: (error) => !isTerminalDeliveryFailure(error),
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
    checkpoint: Accounting.MinorUnits,
  },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: periodWorkKey,
  retryable: (error) => !isTerminalDeliveryFailure(error),
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

type PeriodWorkPayload = {
  readonly manifestId: string;
  readonly scope: typeof Accounting.Scope.Type;
  readonly boundedCount: number;
  readonly checkpoint: string;
};

function periodWorkKey(payload: PeriodWorkPayload) {
  return `${payload.scope.bookId}/${payload.manifestId}/${payload.checkpoint}`;
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

function extractionRecordId(payload: ExtractionPayload) {
  return `${ExtractionQueue._tag}/${extractionKey(payload)}`;
}

function periodWorkRecordId(payload: PeriodWorkPayload) {
  return `${PeriodWorkQueue._tag}/${periodWorkKey(payload)}`;
}

function dispatchPreparation(job: typeof PreparationJob.Type, snapshot: QueueSnapshot) {
  const payload = { jobId: job.id, scope: job.scope, checkpoint: job.checkpoint };
  const id = JobStore.JobId(preparationRecordId(payload));

  return deliveryDispatch(
    id,
    snapshot,
    PreparationQueue.enqueue(payload),
    ignoreUnrearmable(PreparationQueue.retry(id)),
    stopFailedPreparationDelivery(payload),
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

  if (pending.length === 0) return;

  const payloads = pending.map((request) => ({
    requestId: request.requestId,
    scope: { entityId: request.entityId, bookId: request.bookId },
  })) satisfies ReadonlyArray<ExtractionPayload>;

  const snapshot = yield* readQueueSnapshot(
    payloads.map((payload) => JobStore.JobId(extractionRecordId(payload))),
  );

  yield* Effect.forEach(
    payloads,
    (payload) => {
      const id = JobStore.JobId(extractionRecordId(payload));
      const record = snapshot.records.get(id);

      // A failed job below its attempt limit was explicitly non-retryable.
      // Retrying it cannot change the result; completed jobs cannot be re-enqueued.
      if (
        record?.state === "completed" ||
        (record?.state === "failed" && record.attemptsMade < record.attemptsMax)
      )
        return stopFailedExtractionDelivery(payload);

      return deliveryDispatch(
        id,
        snapshot,
        ExtractionQueue.enqueue(payload),
        ignoreUnrearmable(ExtractionQueue.retry(id)),
        stopFailedExtractionDelivery(payload),
      ).pipe(
        // The store is reached through the defect channel, so one unreachable queue
        // row must not end the polling fiber. The admission stays durable either
        // way and the next poll picks the same request up again.
        Effect.catchDefect(() =>
          Effect.logWarning("Extraction enqueue failed; admission remains durable."),
        ),
      );
    },
    { concurrency: 5, discard: true },
  );
});

export const handleExtraction = Effect.fn("Extraction.handleQueueJob")(function* (payload: {
  requestId: string;
  scope: typeof Accounting.Scope.Type;
}) {
  const result = yield* runSupplierExtraction(payload.scope, payload.requestId);

  // Pending provider operations must use the queue's backoff, not become a
  // completed deterministic job that can never be enqueued again.
  if (result === "ready") return yield* failure("Unavailable");

  return result;
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

  if (pending.length === 0) return;

  const payloads = pending.map((run) => ({
    manifestId: run.manifestId,
    scope: { entityId: run.entityId, bookId: run.bookId },
    boundedCount: run.boundedCount,
    checkpoint: run.checkpoint,
  })) satisfies ReadonlyArray<PeriodWorkPayload>;

  const snapshot = yield* readQueueSnapshot(
    payloads.map((payload) => JobStore.JobId(periodWorkRecordId(payload))),
  );

  yield* Effect.forEach(
    payloads,
    (payload) => {
      const id = JobStore.JobId(periodWorkRecordId(payload));

      return deliveryDispatch(
        id,
        snapshot,
        PeriodWorkQueue.enqueue(payload),
        ignoreUnrearmable(PeriodWorkQueue.retry(id)),
        stopFailedPeriodWorkDelivery(payload),
      ).pipe(
        // The store is reached through the defect channel, so one unreachable queue
        // row must not end the polling fiber. The child fence keeps the
        // next poll from double-publishing either way.
        Effect.catchDefect(() =>
          Effect.logWarning("Period work enqueue failed; the run stays open."),
        ),
      );
    },
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
  checkpoint: string;
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
