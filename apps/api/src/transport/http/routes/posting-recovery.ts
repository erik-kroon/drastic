import * as Recovery from "@open-erp/contracts/posting-recovery";
import { query, scopeParameter } from "../../../db/query";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const PostingRecoveryHandlers = HttpApiBuilder.group(Api, "postingRecovery", (handlers) =>
  handlers
    .handle("savePostingRequest", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_save_request.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          command: payload,
        }),
      ),
    )
    .handle("runPostingRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_run_request.execute(token, { scope: params, key: params.key }),
      ),
    )
    .handle("getSavedPostingRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_get_saved_request.execute(token, { scope: params, key: params.key }),
      ),
    )
    .handle("listSavedPostingRequests", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.posting_list_saved_requests.execute(token, {
          scope: params,
          after: page.after,
        }),
      ),
    )
    // Human-only operations intentionally have no ordinary MCP capability.
    .handle("savePostingAuthorityRequest", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "savePostingAuthorityRequest",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Recovery.SavedPostingRequest,
        ),
      ),
    )
    .handle("runPostingAuthorityRequest", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "runPostingAuthorityRequest",
          [token, scopeParameter(params), params.key],
          Recovery.SavedPostingRequest,
        ),
      ),
    )
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
