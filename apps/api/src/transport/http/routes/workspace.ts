import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { getBookContext } from "../../../application/agent/context";
import {
  captureAgentContext,
  getAgentContextPage,
  advanceAgentContext,
  getAgentContextDelta,
} from "../../../application/agent/continuation";
import * as Workspace from "../../../application/workspace";

export const WorkspaceHandlers = HttpApiBuilder.group(Api, "workspace", (handlers) =>
  handlers
    .handle("getAgentContextDelta", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        getAgentContextDelta(token, {
          scope: scopeFromPath(params),
          captureId: params.id,
          ...query,
        }),
      ),
    )
    .handle("captureAgentContext", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        captureAgentContext(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getAgentContextPage", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        getAgentContextPage(token, {
          scope: scopeFromPath(params),
          captureId: params.id,
          ...query,
        }),
      ),
    )
    .handle("advanceAgentContext", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        advanceAgentContext(token, {
          scope: scopeFromPath(params),
          captureId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("workspaceCoordination", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.coordination(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("agentBookContext", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        getBookContext(token, { scope: scopeFromPath(params), input: payload }),
      ),
    )
    .handle("saveWorkspaceView", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.saveView(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("deleteWorkspaceView", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.deleteView(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("assignWorkspaceWork", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.assignWork(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listAttention", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.listAttention(token, { scope: scopeFromPath(params), ...query }),
      ),
    )
    .handle("listWorkspaceWork", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.listWork(token, { scope: scopeFromPath(params), ...query }),
      ),
    ),
);
