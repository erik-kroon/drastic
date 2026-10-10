import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  approveCustomerCredit,
  executeCustomerCredit,
  prepareCustomerCredit,
} from "../commerce/credit-notes";
import {
  applyCustomerCredit,
  executeCustomerReceipt,
  getCustomerCreditOrigin,
  prepareCustomerReceipt,
  refundCustomerCredit,
} from "../commerce/customer-receipts";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CustomerCreditOperations = {
  getCustomerCreditDocument: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.getCustomerCreditDocument,
    capabilities.commerce_get_customer_credit,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  customerCreditHistory: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.customerCreditHistory,
    capabilities.commerce_customer_credit_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getCustomerCreditCapacity: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.getCustomerCreditCapacity,
    capabilities.commerce_get_customer_credit_capacity,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      accountingProfileId: query.accountingProfileId,
      accountingPeriodId: query.accountingPeriodId,
      creditDate: query.creditDate,
    }),
  ),
  getCustomerCreditReview: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.getCustomerCreditReview,
    capabilities.commerce_get_customer_credit_review,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  executeCustomerCredit: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.executeCustomerCredit,
    (token, { params, headers, payload }) =>
      executeCustomerCredit(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCustomerCredit: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.approveCustomerCredit,
    (token, { params, headers, payload }) =>
      approveCustomerCredit(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCustomerCredit: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.prepareCustomerCredit,
    (token, { params, headers, payload }) =>
      prepareCustomerCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  renderCustomerCreditArtifact: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.renderCustomerCreditArtifact,
    capabilities.commerce_render_customer_credit_artifact,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      id: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getCustomerCreditArtifact: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.getCustomerCreditArtifact,
    capabilities.commerce_get_customer_credit_artifact,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getCustomerCreditArtifactState: bindHttpOperation(
    Api.groups.customerCreditNotes.endpoints.getCustomerCreditArtifactState,
    capabilities.commerce_get_customer_credit_artifact_state,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getCustomerCreditOrigin: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.getCustomerCreditOrigin,
    (token, { params }) =>
      getCustomerCreditOrigin(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  refundCustomerCredit: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.refundCustomerCredit,
    (token, { params, headers, payload }) =>
      refundCustomerCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        originId: params.id,
        input: payload,
      }),
  ),
  applyCustomerCredit: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.applyCustomerCredit,
    (token, { params, headers, payload }) =>
      applyCustomerCredit(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        originId: params.id,
        input: payload,
      }),
  ),
  executeCustomerReceipt: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.executeCustomerReceipt,
    (token, { params, headers, payload }) =>
      executeCustomerReceipt(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCustomerReceipt: defineHttpOperation(
    Api.groups.customerCreditNotes.endpoints.prepareCustomerReceipt,
    (token, { params, headers, payload }) =>
      prepareCustomerReceipt(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
