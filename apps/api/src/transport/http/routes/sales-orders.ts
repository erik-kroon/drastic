import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/sales-orders";

export const SalesOrderHandlers = HttpApiBuilder.group(Api, "salesOrders", (handlers) =>
  handlers
    .handle("createSalesDocument", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.createSalesDocument(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listSalesDocuments", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.listSalesDocuments(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("getSalesDocument", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.getSalesDocument(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("reviseSalesDocument", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.reviseSalesDocument(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("transitionSalesDocument", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.transitionSalesDocument(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("convertSalesOrder", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.convertSalesOrder(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
