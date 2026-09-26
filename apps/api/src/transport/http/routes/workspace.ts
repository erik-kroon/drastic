import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Workspace from "../../../application/workspace";

export const WorkspaceHandlers = HttpApiBuilder.group(Api, "workspace", (handlers) =>
  handlers
    .handle("workspaceCoordination", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Workspace.coordination(token, { scope: scopeFromPath(params) }),
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
