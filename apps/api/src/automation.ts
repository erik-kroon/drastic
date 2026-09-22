import { Api } from "@open-erp/contracts/api";
import * as Automation from "@open-erp/contracts/automation";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";
import { query, scopeParameter } from "./database";

export const AutomationHandlers = HttpApiBuilder.group(Api, "automation", (handlers) =>
  handlers
    .handle("startPreparationJob", ({ params, headers }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_start_background.execute(token, {
          scope: params,
          runId: params.id,
          idempotencyKey: headers["idempotency-key"],
        }),
      ),
    )
    .handle("getPreparationJob", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_get_background.execute(token, { scope: params, runId: params.id }),
      ),
    )
    .handle("proposeRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.rules_propose.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getRecurringRule", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.rules_get.execute(token, { scope: params, ruleId: params.id }),
      ),
    )
    .handle("simulateRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.rules_simulate.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getRecurringSimulation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.rules_get_simulation.execute(token, {
          scope: params,
          simulationId: params.id,
        }),
      ),
    )
    .handle("createPreparationRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_create_preparation.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPreparationRun", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_get.execute(token, { scope: params, runId: params.id }),
      ),
    )
    .handle("advancePreparationRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.runs_advance.execute(token, {
          scope: params,
          runId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("activateRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "activateRecurringRule",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Automation.RuleActivation,
        ),
      ),
    )
    .handle("deactivateRecurringRule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "deactivateRecurringRule",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Automation.RuleDeactivation,
        ),
      ),
    ),
);
