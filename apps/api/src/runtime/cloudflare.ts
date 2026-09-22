import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import api from "../index";
import { type Bindings, RequestEnvironment } from "./environment";
import {
  dispatchPendingPreparations,
  executePreparationJob,
  JobPayload,
} from "../application/preparation-jobs";

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
        () =>
          Effect.runPromise(
            executePreparationJob(payload, checkpoint).pipe(
              Effect.provideService(RequestEnvironment, {
                bindings: this.env,
                url: new URL(this.env.BETTER_AUTH_URL ?? "https://preparation.invalid"),
              }),
            ),
          ),
      );
      if (result.state !== "ready") return { jobId: result.id, state: result.state };
    }
    throw new Error("Preparation exceeded its bounded checkpoint count.");
  }
}

export default {
  ...api,
  async scheduled(_controller: ScheduledController, bindings: Bindings) {
    await Effect.runPromise(
      dispatchPendingPreparations.pipe(
        Effect.provideService(RequestEnvironment, {
          bindings,
          url: new URL(bindings.BETTER_AUTH_URL ?? "https://preparation.invalid"),
        }),
      ),
    );
  },
};
