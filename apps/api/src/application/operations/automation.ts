import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as EvidenceWork from "../evidence-work";

import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const AutomationOperations = {
  deactivateRecurringRule: defineHttpOperation(
    Api.groups.automation.endpoints.deactivateRecurringRule,
    (token, { params, headers, payload }) =>
      EvidenceWork.deactivateRecurringRule(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  activateRecurringRule: defineHttpOperation(
    Api.groups.automation.endpoints.activateRecurringRule,
    (token, { params, headers, payload }) =>
      EvidenceWork.activateRecurringRule(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  advancePreparationRun: bindHttpOperation(
    Api.groups.automation.endpoints.advancePreparationRun,
    capabilities.runs_advance,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      runId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getPreparationRun: bindHttpOperation(
    Api.groups.automation.endpoints.getPreparationRun,
    capabilities.runs_get,
    ({ params }) => ({ scope: scopeFromPath(params), runId: params.id }),
  ),
  createPreparationRun: bindHttpOperation(
    Api.groups.automation.endpoints.createPreparationRun,
    capabilities.runs_create_preparation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getRecurringSimulation: bindHttpOperation(
    Api.groups.automation.endpoints.getRecurringSimulation,
    capabilities.rules_get_simulation,
    ({ params }) => ({ scope: scopeFromPath(params), simulationId: params.id }),
  ),
  simulateRecurringRule: bindHttpOperation(
    Api.groups.automation.endpoints.simulateRecurringRule,
    capabilities.rules_simulate,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getRecurringRule: bindHttpOperation(
    Api.groups.automation.endpoints.getRecurringRule,
    capabilities.rules_get,
    ({ params }) => ({ scope: scopeFromPath(params), ruleId: params.id }),
  ),
  proposeRecurringRule: bindHttpOperation(
    Api.groups.automation.endpoints.proposeRecurringRule,
    capabilities.rules_propose,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getPreparationJob: bindHttpOperation(
    Api.groups.automation.endpoints.getPreparationJob,
    capabilities.runs_get_background,
    ({ params }) => ({
      scope: scopeFromPath(params),
      runId: params.id,
    }),
  ),
  startPreparationJob: bindHttpOperation(
    Api.groups.automation.endpoints.startPreparationJob,
    capabilities.runs_start_background,
    ({ params, headers }) => ({
      scope: scopeFromPath(params),
      runId: params.id,
      idempotencyKey: headers["idempotency-key"],
    }),
  ),
  stopPreparationJob: bindHttpOperation(
    Api.groups.automation.endpoints.stopPreparationJob,
    capabilities.runs_stop_background,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      jobId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
