import { Api } from "@open-erp/contracts/api";

import * as Owner from "../banking/processor-clearing";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const ProcessorClearingOperations = {
  reconcileProcessorClearing: defineHttpOperation(
    Api.groups.processorClearing.endpoints.reconcileProcessorClearing,
    (token, { params }) =>
      Owner.reconcileProcessorClearing(token, scopeFromPath(params), params.id, params.fetchId),
  ),
  executeProcessorClearing: defineHttpOperation(
    Api.groups.processorClearing.endpoints.executeProcessorClearing,
    (token, { params, headers, payload }) =>
      Owner.executeProcessorClearing(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  approveProcessorClearing: defineHttpOperation(
    Api.groups.processorClearing.endpoints.approveProcessorClearing,
    (token, { params, headers, payload }) =>
      Owner.approveProcessorClearing(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  getProcessorReview: defineHttpOperation(
    Api.groups.processorClearing.endpoints.getProcessorReview,
    (token, { params }) => Owner.getProcessorReview(token, scopeFromPath(params), params.id),
  ),
  prepareProcessorClearing: defineHttpOperation(
    Api.groups.processorClearing.endpoints.prepareProcessorClearing,
    (token, { params, headers, payload }) =>
      Owner.prepareProcessorClearing(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getProcessorFetch: defineHttpOperation(
    Api.groups.processorClearing.endpoints.getProcessorFetch,
    (token, { params }) => Owner.getProcessorFetch(token, scopeFromPath(params), params.id),
  ),
  fetchProcessorObservations: defineHttpOperation(
    Api.groups.processorClearing.endpoints.fetchProcessorObservations,
    (token, { params, headers, payload }) =>
      Owner.fetchProcessorObservations(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        accountId: params.id,
        input: payload,
      }),
  ),
  getProcessorAccount: defineHttpOperation(
    Api.groups.processorClearing.endpoints.getProcessorAccount,
    (token, { params }) => Owner.getProcessorAccount(token, scopeFromPath(params), params.id),
  ),
  registerProcessorAccount: defineHttpOperation(
    Api.groups.processorClearing.endpoints.registerProcessorAccount,
    (token, { params, headers, payload }) =>
      Owner.registerProcessorAccount(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  registerProcessorNativeCredit: defineHttpOperation(
    Api.groups.processorClearing.endpoints.registerProcessorNativeCredit,
    (token, { params, headers, payload }) =>
      Owner.registerProcessorNativeCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  returnProcessorReview: defineHttpOperation(
    Api.groups.processorClearing.endpoints.returnProcessorReview,
    (token, { params, headers, payload }) =>
      Owner.returnProcessorReview(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  listProcessorBankCandidates: defineHttpOperation(
    Api.groups.processorClearing.endpoints.listProcessorBankCandidates,
    (token, { params, query }) =>
      Owner.listProcessorBankCandidates(token, scopeFromPath(params), params.id, query),
  ),
  getProcessorPayoutReview: defineHttpOperation(
    Api.groups.processorClearing.endpoints.getProcessorPayoutReview,
    (token, { params }) => Owner.getProcessorPayoutReview(token, scopeFromPath(params), params.id),
  ),
  listProcessorReviews: defineHttpOperation(
    Api.groups.processorClearing.endpoints.listProcessorReviews,
    (token, { params, query }) =>
      Owner.listProcessorReviews(token, scopeFromPath(params), params.id, query),
  ),
  listProcessorAccounts: defineHttpOperation(
    Api.groups.processorClearing.endpoints.listProcessorAccounts,
    (token, { params, query }) => Owner.listProcessorAccounts(token, scopeFromPath(params), query),
  ),
};
