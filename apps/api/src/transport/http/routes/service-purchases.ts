import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  approveServicePurchase,
  executeServicePurchase,
  getServicePurchaseRecognition,
  getServicePurchaseReview,
  prepareServicePurchase,
  servicePurchaseHistory,
} from "../../../application/purchases/service-purchases";

export const ServicePurchaseHandlers = HttpApiBuilder.group(Api, "servicePurchases", (handlers) =>
  handlers
    .handle("prepareServicePurchase", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareServicePurchase(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveServicePurchase", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveServicePurchase(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeServicePurchase", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeServicePurchase(token, {
          scope: scopeFromPath(params),
          reviewId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getServicePurchaseReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getServicePurchaseReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
      ),
    )
    .handle("servicePurchaseHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        servicePurchaseHistory(token, { scope: scopeFromPath(params), draftId: params.id }),
      ),
    )
    .handle("getServicePurchaseRecognition", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getServicePurchaseRecognition(token, {
          scope: scopeFromPath(params),
          recognitionId: params.id,
        }),
      ),
    ),
);
