import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import api from "../index";
import { type Bindings, RequestEnvironment } from "./environment";
import { databaseLayer } from "../db/connection";
import { databaseFailure } from "../db/transaction";
import { failure } from "../application/failures";
import {
  dispatchPendingPreparations,
  executePreparationJob,
  JobPayload,
} from "../application/preparation-jobs";

function withDatabase<A, E, R>(bindings: Bindings, effect: Effect.Effect<A, E, R>) {
  const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;
  if (!connectionString) return Effect.fail(failure("Unavailable"));
  return effect.pipe(
    Effect.provideService(RequestEnvironment, {
      bindings,
      url: new URL(bindings.BETTER_AUTH_URL ?? "https://preparation.invalid"),
    }),
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "open-erp-api",
        connectTimeoutMs: 5000,
        statementTimeoutMs: 15000,
      }),
    ),
    Effect.mapError(databaseFailure),
  );
}

export class PreparationWorkflow extends WorkflowEntrypoint<Bindings, typeof JobPayload.Type> {
  async run(event: WorkflowEvent<typeof JobPayload.Type>, step: WorkflowStep) {
    const payload = Schema.decodeSync(JobPayload)(event.payload);
    for (let checkpoint = 0; checkpoint < 50; checkpoint++) {
      const result = await step.do(
        `prepare-${checkpoint}`,
        {
          retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
          timeout: "1 minute",
        },
        () => Effect.runPromise(withDatabase(this.env, executePreparationJob(payload, checkpoint))),
      );
      if (result.state !== "ready") return { jobId: result.id, state: result.state };
    }
    throw new Error("Preparation exceeded its bounded checkpoint count.");
  }
}

export default {
  ...api,
  async scheduled(_controller: ScheduledController, bindings: Bindings) {
    await Effect.runPromise(withDatabase(bindings, dispatchPendingPreparations));
  },
};
