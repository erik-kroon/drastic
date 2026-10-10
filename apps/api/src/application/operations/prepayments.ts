import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  linkExpenseCostBasis,
  recordAccruedCost,
  resolveAccruedCost,
} from "../subledger/prepayments";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const PrepaymentsOperations = {
  readAccruedCost: bindHttpOperation(
    Api.groups.prepayments.endpoints.readAccruedCost,
    capabilities.subledger_read_accrued_cost,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  resolveAccruedCost: defineHttpOperation(
    Api.groups.prepayments.endpoints.resolveAccruedCost,
    (token, { params, headers, payload }) =>
      resolveAccruedCost(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recordAccruedCost: defineHttpOperation(
    Api.groups.prepayments.endpoints.recordAccruedCost,
    (token, { params, headers, payload }) =>
      recordAccruedCost(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  linkExpenseCostBasis: defineHttpOperation(
    Api.groups.prepayments.endpoints.linkExpenseCostBasis,
    (token, { params, headers, payload }) =>
      linkExpenseCostBasis(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
