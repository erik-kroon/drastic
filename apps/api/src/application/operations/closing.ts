import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Inventories from "../closing/inventories";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const ClosingOperations = {
  getClosingCertificate: bindHttpOperation(
    Api.groups.closing.endpoints.getClosingCertificate,
    capabilities.periods_get_closing_certificate,
    ({ params }) => ({
      scope: scopeFromPath(params),
      certificateId: params.id,
    }),
  ),
  closingHistory: bindHttpOperation(
    Api.groups.closing.endpoints.closingHistory,
    capabilities.periods_closing_history,
    ({ params, query: cursor }) => ({
      scope: scopeFromPath(params),
      periodId: params.periodId,
      after: cursor.after,
    }),
  ),
  executeClosing: bindHttpOperation(
    Api.groups.closing.endpoints.executeClosing,
    capabilities.periods_execute_closing,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      proposalId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  approveClosing: defineHttpOperation(
    Api.groups.closing.endpoints.approveClosing,
    (token, { params, headers, payload }) =>
      Inventories.approveProposal(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getClosingProposal: bindHttpOperation(
    Api.groups.closing.endpoints.getClosingProposal,
    capabilities.periods_get_closing_proposal,
    ({ params }) => ({
      scope: scopeFromPath(params),
      proposalId: params.id,
    }),
  ),
  prepareClosing: bindHttpOperation(
    Api.groups.closing.endpoints.prepareClosing,
    capabilities.periods_prepare_closing,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      periodId: params.periodId,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  closingReadiness: bindHttpOperation(
    Api.groups.closing.endpoints.closingReadiness,
    capabilities.periods_closing_readiness,
    ({ params }) => ({
      scope: scopeFromPath(params),
      periodId: params.periodId,
    }),
  ),
  declareClosingInventory: defineHttpOperation(
    Api.groups.closing.endpoints.declareClosingInventory,
    (token, { params, headers, payload }) =>
      Inventories.declareInventory(token, {
        scope: scopeFromPath(params),
        periodId: params.periodId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listClosingProposals: bindHttpOperation(
    Api.groups.closing.endpoints.listClosingProposals,
    capabilities.periods_list_closing_proposals,
    ({ params, query: cursor }) => ({
      scope: scopeFromPath(params),
      periodId: params.periodId,
      after: cursor.after,
    }),
  ),
};
