import { Api } from "@open-erp/contracts/api";

import * as Owner from "../treasury/loans";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const TreasuryLoanOperations = {
  getLoanReview: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.getLoanReview,
    (token, { params }) => Owner.getReview(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getLoan: defineHttpOperation(Api.groups.treasuryLoan.endpoints.getLoan, (token, { params }) =>
    Owner.get(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeLoanReview: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.executeLoanReview,
    (token, { params, headers, payload }) =>
      Owner.execute(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveLoanReview: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.approveLoanReview,
    (token, { params, headers, payload }) =>
      Owner.approve(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareLoanReview: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.prepareLoanReview,
    (token, { params, headers, payload }) =>
      Owner.prepare(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recordLoanRate: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.recordLoanRate,
    (token, { params, headers, payload }) =>
      Owner.recordRate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  adoptLoan: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.adoptLoan,
    (token, { params, headers, payload }) =>
      Owner.adopt(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listLoanReviews: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.listLoanReviews,
    (token, { params, query }) =>
      Owner.listReviews(token, {
        scope: scopeFromPath(params),
        id: params.id,
        after: query.after,
      }),
  ),
  listLoans: defineHttpOperation(
    Api.groups.treasuryLoan.endpoints.listLoans,
    (token, { params, query }) =>
      Owner.list(token, { scope: scopeFromPath(params), after: query.after }),
  ),
};
