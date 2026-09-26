import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as CommerceFx from "../../../application/commerce-fx";

export const CommerceFxHandlers = HttpApiBuilder.group(Api, "commerceFx", (handlers) =>
  handlers
    .handle("prepareCommerceFxRecognition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.prepareRecognition(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCommerceFxRecognition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.approveRecognition(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCommerceFxRecognition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.executeRecognition(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCommerceFxSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.prepareSettlement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCommerceFxSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.approveSettlement(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCommerceFxSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.executeSettlement(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCommerceFxPartialSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.preparePartialSettlement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCommerceFxPartialSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.approvePartialSettlement(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCommerceFxPartialSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.executePartialSettlement(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCommerceFxSettlementCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.prepareSettlementCorrection(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCommerceFxSettlementCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.approveSettlementCorrection(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCommerceFxSettlementCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.executeSettlementCorrection(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCommerceFxItem", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.getItem(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("recoverCommerceFxCommand", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        CommerceFx.recoverCommand(token, { scope: scopeFromPath(params), key: params.key }),
      ),
    ),
);
