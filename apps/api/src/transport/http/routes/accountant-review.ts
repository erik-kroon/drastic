import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  getReviewPack,
  listReviewPacks,
  prepareReviewPack,
  reviewPackArtifact,
  reviewPackRows,
} from "../../../application/accountant-review";

export const AccountantReviewHandlers = HttpApiBuilder.group(Api, "accountantReview", (handlers) =>
  handlers
    .handle("prepareReviewPack", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareReviewPack(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listReviewPacks", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        listReviewPacks(token, {
          scope: scopeFromPath(params),
          after: query.after,
        }),
      ),
    )
    .handle("getReviewPack", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getReviewPack(token, {
          scope: scopeFromPath(params),
          packId: params.id,
        }),
      ),
    )
    .handle("reviewPackRows", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        reviewPackRows(token, {
          scope: scopeFromPath(params),
          packId: params.id,
          section: params.section,
          after: query.after,
        }),
      ),
    )
    .handle("reviewPackArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        reviewPackArtifact(token, {
          scope: scopeFromPath(params),
          packId: params.id,
          format: params.format,
        }),
      ),
    ),
);
