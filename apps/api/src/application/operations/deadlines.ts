import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Deadlines from "../closing/deadlines";
import { linkFulfillment, reverifyFulfillment } from "../closing/fulfillment";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const DeadlineOperations = {
  revokeDeadlineFeed: defineHttpOperation(
    Api.groups.deadlines.endpoints.revokeDeadlineFeed,
    (token, { params, headers }) =>
      Deadlines.revokeFeed(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
      }),
  ),
  reverifyDeadlineFulfillment: defineHttpOperation(
    Api.groups.deadlines.endpoints.reverifyDeadlineFulfillment,
    (token, { params, headers, payload }) =>
      reverifyFulfillment(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  createDeadlineFeed: defineHttpOperation(
    Api.groups.deadlines.endpoints.createDeadlineFeed,
    (token, { params }) =>
      Deadlines.createFeed(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  linkDeadlineFulfillment: defineHttpOperation(
    Api.groups.deadlines.endpoints.linkDeadlineFulfillment,
    (token, { params, headers, payload }) =>
      linkFulfillment(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        reference: payload.reference,
      }),
  ),
  deadlineActivity: defineHttpOperation(
    Api.groups.deadlines.endpoints.deadlineActivity,
    (token, { params, headers, payload }) =>
      Deadlines.recordActivity(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        action: payload.action,
      }),
  ),
  saveDeadline: defineHttpOperation(
    Api.groups.deadlines.endpoints.saveDeadline,
    (token, { params, headers, payload }) =>
      Deadlines.saveObligation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        expectedRevision: payload.expectedRevision,
        input: payload.input,
      }),
  ),
  listDeadlineFulfillments: bindHttpOperation(
    Api.groups.deadlines.endpoints.listDeadlineFulfillments,
    capabilities.deadlines_fulfillment_list,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  listDeadlines: bindHttpOperation(
    Api.groups.deadlines.endpoints.listDeadlines,
    capabilities.deadlines_list,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
};
