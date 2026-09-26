import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Controls from "../../../application/subledger/controls";

export const SubledgerControlsHandlers = HttpApiBuilder.group(
  Api,
  "subledgerControls",
  (handlers) =>
    handlers
      .handle("prepareAssetImpairment", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.prepareImpairment(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("approveAssetImpairment", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.approveImpairment(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeAssetImpairment", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.executeImpairment(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getAssetImpairmentReview", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.getImpairmentReview(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("listAssetImpairmentReviews", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.listImpairmentReviews(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("prepareAssetDisposal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.prepareDisposal(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("approveAssetDisposal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.approveDisposal(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeAssetDisposal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.executeDisposal(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getAssetDisposalReview", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.getDisposalReview(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("listAssetDisposalReviews", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.listDisposalReviews(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("recordSubledgerBasis", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.recordBasis(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSubledgerBasis", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.getBasis(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("listSubledgerBases", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.listBases(token, { scope: scopeFromPath(params) }),
        ),
      )
      .handle("createSubledgerControl", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.createControl(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSubledgerControl", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.getControl(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("listSubledgerControls", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Controls.listControls(token, { scope: scopeFromPath(params) }),
        ),
      ),
);
