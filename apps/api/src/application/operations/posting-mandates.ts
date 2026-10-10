import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Mandates from "../purchases/posting-mandates";

import { defineHttpOperation } from "../capabilities/http-operation";

export const PostingMandateOperations = {
  executeSupplierAcceptanceUnderMandate: defineHttpOperation(
    Api.groups.postingMandates.endpoints.executeSupplierAcceptanceUnderMandate,
    (token, { params, headers, payload }) =>
      Mandates.executeSupplierAcceptanceUnderMandate(token, {
        scope: scopeFromPath(params),
        reviewId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listPostingMandates: defineHttpOperation(
    Api.groups.postingMandates.endpoints.listPostingMandates,
    (token, { params }) => Mandates.listPostingMandates(token, params),
  ),
  getPostingMandate: defineHttpOperation(
    Api.groups.postingMandates.endpoints.getPostingMandate,
    (token, { params }) =>
      Mandates.getPostingMandate(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  revokePostingMandate: defineHttpOperation(
    Api.groups.postingMandates.endpoints.revokePostingMandate,
    (token, { params, headers, payload }) =>
      Mandates.revokePostingMandate(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  grantPostingMandate: defineHttpOperation(
    Api.groups.postingMandates.endpoints.grantPostingMandate,
    (token, { params, headers, payload }) =>
      Mandates.grantPostingMandate(token, {
        scope: params,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
