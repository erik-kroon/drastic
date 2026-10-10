import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { acquireCloudIntake, acquireIntakeBatch, getIntakeDestination } from "../purchases/intake";
import {
  recordSupplierExtraction,
  registerSupplierInbox,
  reviewSupplierInbox,
} from "../purchases/inbox";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const SupplierInboxOperations = {
  reviewSupplierInbox: defineHttpOperation(
    Api.groups.supplierInbox.endpoints.reviewSupplierInbox,
    (token, { params, headers, payload }) =>
      reviewSupplierInbox(token, {
        scope: scopeFromPath(params),
        occurrenceId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recordSupplierExtraction: defineHttpOperation(
    Api.groups.supplierInbox.endpoints.recordSupplierExtraction,
    (token, { params, headers, payload }) =>
      recordSupplierExtraction(token, {
        scope: scopeFromPath(params),
        occurrenceId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getSupplierInbox: bindHttpOperation(
    Api.groups.supplierInbox.endpoints.getSupplierInbox,
    capabilities.supplier_inbox_get,
    ({ params }) => ({ scope: scopeFromPath(params), occurrenceId: params.id }),
  ),
  registerSupplierInbox: defineHttpOperation(
    Api.groups.supplierInbox.endpoints.registerSupplierInbox,
    (token, { params, headers, payload }) =>
      registerSupplierInbox(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listSupplierInboxes: bindHttpOperation(
    Api.groups.supplierInbox.endpoints.listSupplierInboxes,
    capabilities.supplier_inbox_list,
    ({ params, query: search }) => ({ scope: scopeFromPath(params), cursor: search.cursor }),
  ),
  acquireCloudIntake: defineHttpOperation(
    Api.groups.supplierInbox.endpoints.acquireCloudIntake,
    (token, { params, headers, payload }) =>
      acquireCloudIntake(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  acquireIntakeBatch: defineHttpOperation(
    Api.groups.supplierInbox.endpoints.acquireIntakeBatch,
    (token, { params, headers, payload }) =>
      acquireIntakeBatch(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getIntakeDestination: defineHttpOperation(
    Api.groups.supplierInbox.endpoints.getIntakeDestination,
    (token, { params }) => getIntakeDestination(token, scopeFromPath(params)),
  ),
};
