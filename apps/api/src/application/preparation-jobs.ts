import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { PreparationJob } from "@open-erp/contracts/automation";
import { failure } from "./failures";
import { query, scopeParameter } from "../db/query";
import { RequestEnvironment } from "../runtime/environment";

export const JobPayload = Schema.Struct({ jobId: Accounting.Identifier, scope: Accounting.Scope });

export const executePreparationJob = Effect.fn("Preparation.executeJob")(function* (
  payload: typeof JobPayload.Type,
  step: number,
) {
  const { bindings } = yield* RequestEnvironment;
  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  return yield* query(
    "executePreparationJob",
    [
      bindings.OPENERP_PREPARATION_TOKEN,
      scopeParameter(payload.scope),
      payload.jobId,
      String(step),
    ],
    PreparationJob,
  );
});

const dispatch = Effect.fn("Preparation.dispatch")(function* (job: typeof PreparationJob.Type) {
  const { bindings } = yield* RequestEnvironment;
  const workflow = bindings.PREPARATION_WORKFLOW;
  if (!workflow) return yield* failure("Unavailable");
  yield* Effect.tryPromise({
    try: async () => {
      try {
        await workflow.create({ id: job.id, params: { jobId: job.id, scope: job.scope } });
      } catch {
        // A lost create response or duplicate delivery converges on the same instance.
        const instance = await workflow.get(job.id);
        const status = await instance.status();
        if (["errored", "terminated", "complete"].includes(status.status)) await instance.restart();
      }
    },
    catch: () => failure("Unavailable"),
  });
});

export const startPreparationJob = Effect.fn("Preparation.startJob")(function* (
  token: string,
  input: { scope: typeof Accounting.Scope.Type; runId: string; idempotencyKey: string },
) {
  const { bindings } = yield* RequestEnvironment;
  if (!bindings.PREPARATION_WORKFLOW || !bindings.OPENERP_PREPARATION_TOKEN)
    return yield* failure("Unavailable");
  const job = yield* query(
    "admitPreparationJob",
    [
      token,
      scopeParameter(input.scope),
      input.runId,
      input.idempotencyKey,
      bindings.OPENERP_PREPARATION_TOKEN,
    ],
    PreparationJob,
  );
  if (job.state === "ready")
    yield* dispatch(job).pipe(
      Effect.catch(() =>
        Effect.logWarning(
          "Preparation dispatch deferred; PostgreSQL admission will be retried by the scheduler.",
        ),
      ),
    );
  return job;
});

export const dispatchPendingPreparations = Effect.gen(function* () {
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
      dispatch(job).pipe(
        Effect.catch(() =>
          Effect.logWarning(
            "Preparation dispatch failed; its PostgreSQL admission remains pending.",
          ),
        ),
      ),
    { concurrency: 5, discard: true },
  );
});
