import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const WorkspaceHandlers = HttpApiBuilder.group(Api, "workspace", (handlers) =>
  handlers
    .handle("workspaceCoordination", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.workspace_coordination.execute(token, { scope: params }),
      ),
    )
    .handle("saveWorkspaceView", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.workspace_save_view.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("deleteWorkspaceView", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.workspace_delete_view.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("assignWorkspaceWork", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.workspace_assign_work.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listAttention", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.workspace_attention.execute(token, { scope: params, ...query }),
      ),
    )
    .handle("listWorkspaceWork", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.workspace_list_work.execute(token, { scope: params, ...query }),
      ),
    ),
);
