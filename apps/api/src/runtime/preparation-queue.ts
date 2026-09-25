import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
import { Job } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { executePreparationJob } from "../application/preparation-jobs";
import { failure } from "../application/failures";
import { query } from "../db/query";
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
  idempotencyKey: ({ jobId, scope, checkpoint }) => `${scope.bookId}/${jobId}/${checkpoint}`,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

export const dispatchPendingPreparations = Effect.fn("Preparation.dispatchPending")(function* () {
  const { bindings } = yield* RequestEnvironment;
  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  const jobs = yield* query(
    "pendingPreparationJobs",
    [bindings.OPENERP_PREPARATION_TOKEN],
    Schema.Array(PreparationJob),
  );
  yield* Effect.forEach(
    jobs,
    (job) =>
      PreparationQueue.enqueue({ jobId: job.id, scope: job.scope, checkpoint: job.checkpoint }),
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
