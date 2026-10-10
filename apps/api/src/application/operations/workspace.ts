import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Questions from "../work-questions";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const WorkspaceOperations = {
  listWorkspaceWork: bindHttpOperation(
    Api.groups.workspace.endpoints.listWorkspaceWork,
    capabilities.workspace_list_work,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
  listAttention: bindHttpOperation(
    Api.groups.workspace.endpoints.listAttention,
    capabilities.workspace_attention,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
  assignWorkspaceWork: bindHttpOperation(
    Api.groups.workspace.endpoints.assignWorkspaceWork,
    capabilities.workspace_assign_work,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  deleteWorkspaceView: bindHttpOperation(
    Api.groups.workspace.endpoints.deleteWorkspaceView,
    capabilities.workspace_delete_view,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  saveWorkspaceView: bindHttpOperation(
    Api.groups.workspace.endpoints.saveWorkspaceView,
    capabilities.workspace_save_view,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  agentBookContext: bindHttpOperation(
    Api.groups.workspace.endpoints.agentBookContext,
    capabilities.workspace_agent_context,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
  workspaceCoordination: bindHttpOperation(
    Api.groups.workspace.endpoints.workspaceCoordination,
    capabilities.workspace_coordination,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  closeWorkQuestion: defineHttpOperation(
    Api.groups.workspace.endpoints.closeWorkQuestion,
    (token, { params, headers, payload }) =>
      Questions.closeWorkQuestion(token, {
        scope: scopeFromPath(params),
        questionId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  answerWorkQuestion: defineHttpOperation(
    Api.groups.workspace.endpoints.answerWorkQuestion,
    (token, { params, headers, payload }) =>
      Questions.answerWorkQuestion(token, {
        scope: scopeFromPath(params),
        questionId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  askWorkQuestion: defineHttpOperation(
    Api.groups.workspace.endpoints.askWorkQuestion,
    (token, { params, headers, payload }) =>
      Questions.askWorkQuestion(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  readWorkQuestions: defineHttpOperation(
    Api.groups.workspace.endpoints.readWorkQuestions,
    (token, { params, payload }) =>
      Questions.readWorkQuestions(token, {
        scope: scopeFromPath(params),
        target: payload,
      }),
  ),
  advanceAgentContext: bindHttpOperation(
    Api.groups.workspace.endpoints.advanceAgentContext,
    capabilities.workspace_advance_context,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      captureId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getAgentContextPage: bindHttpOperation(
    Api.groups.workspace.endpoints.getAgentContextPage,
    capabilities.workspace_get_context_page,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      captureId: params.id,
      ...query,
    }),
  ),
  captureAgentContext: bindHttpOperation(
    Api.groups.workspace.endpoints.captureAgentContext,
    capabilities.workspace_capture_context,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getAgentContextDelta: bindHttpOperation(
    Api.groups.workspace.endpoints.getAgentContextDelta,
    capabilities.workspace_context_delta,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      captureId: params.id,
      ...query,
    }),
  ),
};
