import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const WorkspaceHandlers = HttpApiBuilder.group(Api, "workspace", (handlers) =>
  handlers
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
