import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";

export const PostingRecoveryHandlers = HttpApiBuilder.group(Api, "postingRecovery", (handlers) =>
  handlers
    .handle("listPostingRecovery", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_list_recovery.execute(token, { scope: params, after: page.after }),
      ),
    )
    .handle("getPostingRecovery", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_get_recovery.execute(token, {
          scope: params,
          changeSetId: params.id,
          after: page.after,
        }),
      ),
    )
    .handle("recoverPostingRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_recover_request.execute(token, { scope: params, key: params.key }),
      ),
    ),
);
