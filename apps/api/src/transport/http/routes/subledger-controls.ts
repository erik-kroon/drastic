import { Api } from "@open-erp/contracts/api";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SubledgerControlsHandlers = HttpApiBuilder.group(
  Api,
  "subledgerControls",
  (handlers) =>
    handlers
      .handle("prepareAssetDisposal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "prepareAssetDisposal",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Controls.AssetDisposalReview,
          ),
        ),
      )
      .handle("approveAssetDisposal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "approveAssetDisposal",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Controls.AssetDisposalApproval,
          ),
        ),
      )
      .handle("executeAssetDisposal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "executeAssetDisposal",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Controls.AssetDisposal,
          ),
        ),
      )
      .handle("getAssetDisposalReview", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getAssetDisposalReview",
            [token, scopeParameter(params), params.id],
            Controls.AssetDisposalReviewView,
          ),
        ),
      )
      .handle("listAssetDisposalReviews", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "listAssetDisposalReviews",
            [token, scopeParameter(params), params.id],
            Controls.AssetDisposalReviewList,
          ),
        ),
      )
      .handle("recordSubledgerBasis", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "recordSubledgerBasis",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Controls.SubledgerBasis,
          ),
        ),
      )
      .handle("getSubledgerBasis", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getSubledgerBasis",
            [token, scopeParameter(params), params.id],
            Controls.SubledgerBasis,
          ),
        ),
      )
      .handle("listSubledgerBases", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query("listSubledgerBases", [token, scopeParameter(params)], Controls.SubledgerBasisList),
        ),
      )
      .handle("createSubledgerControl", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "createSubledgerControl",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Controls.SubledgerControl,
          ),
        ),
      )
      .handle("getSubledgerControl", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getSubledgerControl",
            [token, scopeParameter(params), params.id],
            Controls.SubledgerControlView,
          ),
        ),
      )
      .handle("listSubledgerControls", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "listSubledgerControls",
            [token, scopeParameter(params)],
            Controls.SubledgerControlList,
          ),
        ),
      ),
);
