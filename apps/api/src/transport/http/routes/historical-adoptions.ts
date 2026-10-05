import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Adoptions from "../../../application/sie/adoptions";
import * as Settlements from "../../../application/commerce/historical-settlements";
import * as Obligations from "../../../application/commerce/historical-obligations";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const HistoricalAdoptionsHandlers = HttpApiBuilder.group(
  Api,
  "historicalAdoptions",
  (handlers) =>
    handlers
      .handle("createHistoricalPool", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Adoptions.createHistoricalPool(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getHistoricalPool", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Adoptions.getHistoricalPool(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("prepareHistoricalAdoption", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Adoptions.prepareHistoricalAdoption(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getHistoricalAdoptionPlan", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Adoptions.getHistoricalAdoptionPlan(token, {
            scope: scopeFromPath(params),
            id: params.id,
          }),
        ),
      )
      .handle("approveHistoricalAdoption", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Adoptions.approveHistoricalAdoption(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeHistoricalAdoption", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Adoptions.executeHistoricalAdoption(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getHistoricalObligation", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Obligations.getHistoricalObligation(token, {
            scope: scopeFromPath(params),
            id: params.id,
          }),
        ),
      )
      .handle("prepareHistoricalSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Settlements.prepareHistoricalSettlement(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getHistoricalSettlementPlan", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Settlements.getHistoricalSettlementPlan(token, {
            scope: scopeFromPath(params),
            id: params.id,
          }),
        ),
      )
      .handle("approveHistoricalSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Settlements.approveHistoricalSettlement(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeHistoricalSettlement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Settlements.executeHistoricalSettlement(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("prepareHistoricalCredit", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Obligations.prepareHistoricalCredit(token, {
            scope: scopeFromPath(params),
            id: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);
