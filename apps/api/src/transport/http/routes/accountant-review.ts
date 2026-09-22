import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const AccountantReviewHandlers = HttpApiBuilder.group(Api, "accountantReview", (handlers) =>
  handlers
    .handle("prepareReviewPack", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.accountant_review_prepare.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listReviewPacks", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.accountant_review_list.execute(token, {
          scope: params,
          after: query.after,
        }),
      ),
    )
    .handle("getReviewPack", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.accountant_review_get.execute(token, {
          scope: params,
          packId: params.id,
        }),
      ),
    )
    .handle("reviewPackRows", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.accountant_review_rows.execute(token, {
          scope: params,
          packId: params.id,
          section: params.section,
          after: query.after,
        }),
      ),
    )
    .handle("reviewPackArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.accountant_review_artifact.execute(token, {
          scope: params,
          packId: params.id,
          format: params.format,
        }),
      ),
    ),
);
