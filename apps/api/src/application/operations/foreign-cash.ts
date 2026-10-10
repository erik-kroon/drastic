import { Api } from "@open-erp/contracts/api";

import * as Owner from "../banking/foreign-cash";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const ForeignCashOperations = {
  reconcileForeignCash: defineHttpOperation(
    Api.groups.foreignCash.endpoints.reconcileForeignCash,
    (token, { params }) =>
      Owner.reconcileForeignCash(token, {
        scope: scopeFromPath(params),
        accountId: params.id,
        statementId: params.statementId,
      }),
  ),
  getForeignCashReview: defineHttpOperation(
    Api.groups.foreignCash.endpoints.getForeignCashReview,
    (token, { params }) =>
      Owner.getForeignCashReview(token, { scope: scopeFromPath(params), reviewId: params.id }),
  ),
  getForeignCashHolding: defineHttpOperation(
    Api.groups.foreignCash.endpoints.getForeignCashHolding,
    (token, { params }) =>
      Owner.getForeignCashHolding(token, { scope: scopeFromPath(params), accountId: params.id }),
  ),
  executeForeignCash: defineHttpOperation(
    Api.groups.foreignCash.endpoints.executeForeignCash,
    (token, { params, headers, payload }) =>
      Owner.executeForeignCash(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveForeignCash: defineHttpOperation(
    Api.groups.foreignCash.endpoints.approveForeignCash,
    (token, { params, headers, payload }) =>
      Owner.approveForeignCash(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareForeignCash: defineHttpOperation(
    Api.groups.foreignCash.endpoints.prepareForeignCash,
    (token, { params, headers, payload }) =>
      Owner.prepareForeignCash(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getForeignCashExchange: defineHttpOperation(
    Api.groups.foreignCash.endpoints.getForeignCashExchange,
    (token, { params }) =>
      Owner.getForeignCashExchange(token, { scope: scopeFromPath(params), reviewId: params.id }),
  ),
  listForeignCashReviews: defineHttpOperation(
    Api.groups.foreignCash.endpoints.listForeignCashReviews,
    (token, { params, query }) =>
      Owner.listForeignCashReviews(token, {
        scope: scopeFromPath(params),
        accountId: params.id,
        ...query,
      }),
  ),
  listForeignCashHoldings: defineHttpOperation(
    Api.groups.foreignCash.endpoints.listForeignCashHoldings,
    (token, { params, query }) =>
      Owner.listForeignCashHoldings(token, { scope: scopeFromPath(params), ...query }),
  ),
};
