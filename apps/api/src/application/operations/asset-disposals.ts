import { Api } from "@open-erp/contracts/api";

import * as Owner from "../subledger/disposals";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const AssetDisposalOperations = {
  getAssetProceedsDisposal: defineHttpOperation(
    Api.groups.assetDisposals.endpoints.getAssetProceedsDisposal,
    (token, { params }) => Owner.get(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeAssetProceedsDisposal: defineHttpOperation(
    Api.groups.assetDisposals.endpoints.executeAssetProceedsDisposal,
    (token, { params, headers, payload }) =>
      Owner.execute(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveAssetProceedsDisposal: defineHttpOperation(
    Api.groups.assetDisposals.endpoints.approveAssetProceedsDisposal,
    (token, { params, headers, payload }) =>
      Owner.approve(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareAssetProceedsDisposal: defineHttpOperation(
    Api.groups.assetDisposals.endpoints.prepareAssetProceedsDisposal,
    (token, { params, headers, payload }) =>
      Owner.prepare(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getAssetDisposalInvoiceSource: defineHttpOperation(
    Api.groups.assetDisposals.endpoints.getAssetDisposalInvoiceSource,
    (token, { params }) =>
      Owner.invoiceSource(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  listAssetProceedsDisposals: defineHttpOperation(
    Api.groups.assetDisposals.endpoints.listAssetProceedsDisposals,
    (token, { params, query }) =>
      Owner.list(token, { scope: scopeFromPath(params), id: params.id, after: query.after }),
  ),
};
