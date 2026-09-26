import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as EvidenceWork from "../../../application/evidence-work";
import * as Recurring from "../../../application/recurring-rules";

export const AutomationHandlers = HttpApiBuilder.group(Api, "automation", (handlers) =>
  handlers
    .handle("stopPreparationJob", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_stop_background.execute(token, {
          scope: scopeFromPath(params),
          jobId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("startPreparationJob", ({ params, headers }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_start_background.execute(token, {
          scope: scopeFromPath(params),
          runId: params.id,
          idempotencyKey: headers["idempotency-key"],
        }),
      ),
    )
    .handle("getPreparationJob", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_get_background.execute(token, {
          scope: scopeFromPath(params),
          runId: params.id,
        }),
      ),
    )
    .handle("proposeRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.proposeRule(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getRecurringRule", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.getRule(token, { scope: scopeFromPath(params), ruleId: params.id }),
      ),
    )
    .handle("simulateRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.simulateRule(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getRecurringSimulation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.getSimulation(token, { scope: scopeFromPath(params), simulationId: params.id }),
      ),
    )
    .handle("createPreparationRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_create_preparation.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPreparationRun", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_get.execute(token, { scope: scopeFromPath(params), runId: params.id }),
      ),
    )
    .handle("advancePreparationRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_advance.execute(token, {
          scope: scopeFromPath(params),
          runId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("activateRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.activateRecurringRule(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("deactivateRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.deactivateRecurringRule(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
