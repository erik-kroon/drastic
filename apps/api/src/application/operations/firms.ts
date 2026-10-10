import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import * as Firms from "../firms";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const FirmOperations = {
  saveFirmAccessRequest: bindHttpOperation(
    Api.groups.firms.endpoints.saveFirmAccessRequest,
    capabilities.firm_save_access_request,
    ({ params, headers, payload }) => ({
      firmId: params.firmId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  saveFirmMember: bindHttpOperation(
    Api.groups.firms.endpoints.saveFirmMember,
    capabilities.firm_save_member,
    ({ params, headers, payload }) => ({
      firmId: params.firmId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  removeFirmClient: bindHttpOperation(
    Api.groups.firms.endpoints.removeFirmClient,
    capabilities.firm_remove_client,
    ({ params, headers, payload }) => ({
      firmId: params.firmId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  saveFirmClient: bindHttpOperation(
    Api.groups.firms.endpoints.saveFirmClient,
    capabilities.firm_save_client,
    ({ params, headers, payload }) => ({
      firmId: params.firmId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  createFirm: bindHttpOperation(
    Api.groups.firms.endpoints.createFirm,
    capabilities.firm_create,
    ({ headers, payload }) => ({
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getFirmPortfolio: bindHttpOperation(
    Api.groups.firms.endpoints.getFirmPortfolio,
    capabilities.firm_get_portfolio,
    ({ params }) => params,
  ),
  getFirm: bindHttpOperation(
    Api.groups.firms.endpoints.getFirm,
    capabilities.firm_get,
    ({ params }) => ({ firmId: params.firmId }),
  ),
  listFirms: defineHttpOperation(Api.groups.firms.endpoints.listFirms, (token, _request) =>
    Firms.listFirms(token),
  ),
};
